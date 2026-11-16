//! AetherVault cryptographic engine.
//!
//! Standards, benchmarked against Bitwarden / KeePassXC (KDBX4):
//! * KDF: **Argon2id** — 64 MiB memory, 3 iterations, parallelism 4
//!   (OWASP / KDBX4-hardened profile), 32-byte output key, 32-byte salt.
//! * AEAD: **XChaCha20-Poly1305** — 24-byte random nonce per encryption,
//!   128-bit Poly1305 tag. No nonce is ever reused: every vault write and
//!   every key-wrap generates a fresh nonce from the OS CSPRNG.
//! * Key hierarchy: a random 32-byte **master key (MK)** encrypts the vault
//!   payload. The MK itself is *wrapped* (encrypted) by a key-encryption
//!   key (KEK) derived from the master password, and optionally by a
//!   second KEK derived from the recovery key. Changing the password or
//!   rotating the recovery key only re-wraps the MK — the payload is
//!   never re-encrypted and the old password learns nothing.
//! * Memory hygiene: every key, KEK and intermediate buffer lives in a
//!   `Zeroizing` / `secrecy::SecretBox` container and is wiped on drop.
//!   Plaintext passwords never touch disk, logs, or swap-intent paths.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, RngCore};
use secrecy::{ExposeSecret, SecretBox};
use zeroize::Zeroizing;

use crate::errors::{Result, VaultError};

/// Argon2id memory cost in KiB (64 MiB).
pub const ARGON2_M_COST_KIB: u32 = 65_536;
/// Argon2id time cost (iterations).
pub const ARGON2_T_COST: u32 = 3;
/// Argon2id parallelism lanes.
pub const ARGON2_P_COST: u32 = 4;
/// Salt length in bytes.
pub const SALT_LEN: usize = 32;
/// XChaCha20-Poly1305 nonce length in bytes.
pub const NONCE_LEN: usize = 24;
/// Master / derived key length in bytes.
pub const KEY_LEN: usize = 32;
/// Wrapped master key length: 32-byte key + 16-byte Poly1305 tag.
pub const WRAPPED_KEY_LEN: usize = KEY_LEN + 16;

/// The unlocked master key. Held in a `SecretBox` so it is zeroized when
/// the session locks or the app exits. Never cloned as plaintext.
pub struct MasterKey(pub SecretBox<[u8; KEY_LEN]>);

impl MasterKey {
    pub fn expose(&self) -> &[u8; KEY_LEN] {
        self.0.expose_secret()
    }
}

impl std::fmt::Debug for MasterKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "MasterKey([redacted])")
    }
}

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    OsRng.fill_bytes(&mut b);
    b
}

/// Derive a 32-byte KEK from a password (or recovery key) + salt using
/// Argon2id with the hardened parameter profile above.
pub fn derive_kek(secret: &str, salt: &[u8; SALT_LEN]) -> Result<Zeroizing<[u8; KEY_LEN]>> {
    let params = Params::new(
        ARGON2_M_COST_KIB,
        ARGON2_T_COST,
        ARGON2_P_COST,
        Some(KEY_LEN),
    )
    .map_err(|e| VaultError::KdfFailed(e.to_string()))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = Zeroizing::new([0u8; KEY_LEN]);
    argon
        .hash_password_into(secret.as_bytes(), salt, &mut *out)
        .map_err(|e| VaultError::KdfFailed(e.to_string()))?;
    Ok(out)
}

/// AEAD-encrypt `plaintext` under `key` with a fresh random nonce.
/// Returns `(nonce, ciphertext||tag)`.
pub fn encrypt(
    key: &[u8; KEY_LEN],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<([u8; NONCE_LEN], Vec<u8>)> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let nonce_bytes = random_bytes::<NONCE_LEN>();
    let nonce = XNonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| VaultError::EncryptionFailed)?;
    Ok((nonce_bytes, ct))
}

/// AEAD-decrypt `ciphertext` under `key`. Any failure (wrong key, tampered
/// bytes, wrong AAD) is reported as `DecryptionFailed`; unlock paths map
/// it to `InvalidCredentials` so no oracle distinguishes the cases.
pub fn decrypt(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Zeroizing<Vec<u8>>> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let nonce = XNonce::from_slice(nonce);
    let pt = cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| VaultError::DecryptionFailed)?;
    Ok(Zeroizing::new(pt))
}

/// Wrap (encrypt) the master key under a KEK. Fresh nonce per wrap.
pub fn wrap_master_key(
    kek: &[u8; KEY_LEN],
    mk: &[u8; KEY_LEN],
    aad: &[u8],
) -> Result<([u8; NONCE_LEN], [u8; WRAPPED_KEY_LEN])> {
    let (nonce, ct) = encrypt(kek, mk, aad)?;
    let mut wrapped = [0u8; WRAPPED_KEY_LEN];
    if ct.len() != WRAPPED_KEY_LEN {
        return Err(VaultError::EncryptionFailed);
    }
    wrapped.copy_from_slice(&ct);
    Ok((nonce, wrapped))
}

/// Unwrap the master key with a KEK.
pub fn unwrap_master_key(
    kek: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    wrapped: &[u8; WRAPPED_KEY_LEN],
    aad: &[u8],
) -> Result<MasterKey> {
    let pt = decrypt(kek, nonce, wrapped, aad)?;
    if pt.len() != KEY_LEN {
        return Err(VaultError::DecryptionFailed);
    }
    // Copy the plaintext straight into its heap box: copying
    // through a stack array first would leave a live master-key
    // copy in stack residue past the return.
    let mut boxed = Box::new([0u8; KEY_LEN]);
    boxed.copy_from_slice(&pt);
    Ok(MasterKey(SecretBox::new(boxed)))
}

/// Shannon entropy of a candidate password, in bits, using the
/// character-class pool model: `len * log2(pool)`.
pub fn shannon_entropy_bits(password: &str) -> f64 {
    if password.is_empty() {
        return 0.0;
    }
    let mut pool: u32 = 0;
    let (mut lo, mut up, mut dig, mut sym, mut other) = (false, false, false, false, false);
    for c in password.chars() {
        match c {
            'a'..='z' => lo = true,
            'A'..='Z' => up = true,
            '0'..='9' => dig = true,
            c if c.is_ascii_punctuation() => sym = true,
            _ => other = true,
        }
    }
    if lo {
        pool += 26;
    }
    if up {
        pool += 26;
    }
    if dig {
        pool += 10;
    }
    if sym {
        pool += 33;
    }
    if other {
        pool += 100;
    }
    if pool == 0 {
        return 0.0;
    }
    password.chars().count() as f64 * (pool as f64).log2()
}

/// Strength bands: thresholds 36/56/80, labels
/// Empty/Breached/Weak/Fair/Strong/Excellent. The bits math is
/// `shannon_entropy_bits`; the pattern penalty is a bits
/// multiplier (52%, floor 10) instead of score deductions — so
/// score 0 (active) means exactly "in the common-password list".
pub struct StrengthEval {
    /// 0–4 band.
    pub score: u8,
    /// Effective bits (pattern-discounted; capped at 22 when breached).
    pub bits: f64,
    /// In the embedded common-password list.
    pub breached: bool,
}

/// Stripped-common rule: a trailing 19xx/20xx year
/// (+ symbols), then trailing digits/symbols, are removed
/// before the list lookup — so "password123" and
/// "password2024!" still match "password", while "dragonfly"
/// does not match "dragon". Byte-level (no slicing) so
/// non-ASCII tails cannot panic.
fn strip_common_suffix(lower: &str) -> &str {
    let b = lower.as_bytes();
    let mut end = b.len();
    // (1) trailing year 19xx/20xx + optional [!@#$%^&*].
    let mut sym_end = end;
    while sym_end > 0 && b"!@#$%^&*".contains(&b[sym_end - 1]) {
        sym_end -= 1;
    }
    if sym_end >= 4 {
        let y = &b[sym_end - 4..sym_end];
        if y.iter().all(|c| c.is_ascii_digit())
            && (y.starts_with(b"19") || y.starts_with(b"20"))
        {
            end = sym_end - 4;
        }
    }
    // (2) trailing digits/symbols.
    while end > 0 && (b[end - 1].is_ascii_digit() || b"!@#$%^&*".contains(&b[end - 1])) {
        end -= 1;
    }
    &lower[..end]
}

/// Exact-or-stripped membership in the common-password list.
fn is_common_word(lower: &str) -> bool {
    COMMON_PASSWORDS.contains(&lower) || {
        let stripped = strip_common_suffix(lower);
        stripped.len() >= 4 && COMMON_PASSWORDS.contains(&stripped)
    }
}

/// Repeating a breached password does not make it strong:
/// "passwordpassword" is "password" x2, "qwertyqwerty" is
/// "qwerty" x2. A generated 6-word passphrase is never a
/// repetition of one unit, so this never fires on it.
fn is_repeated_common(lower: &str) -> bool {
    let b = lower.as_bytes();
    let n = b.len();
    for unit_len in 1..=n / 2 {
        if !n.is_multiple_of(unit_len) {
            continue;
        }
        let unit = &b[..unit_len];
        if !b.chunks(unit_len).all(|c| c == unit) {
            continue;
        }
        // Slicing is safe here: chunk 1 starts at unit_len
        // with the same leading byte as chunk 0, so unit_len
        // is a char boundary whenever the chunks are equal.
        let unit_str = &lower[..unit_len];
        if is_common_word(unit_str) {
            return true;
        }
    }
    false
}

pub fn evaluate_strength(password: &str) -> StrengthEval {
    if password.is_empty() {
        return StrengthEval {
            score: 0,
            bits: 0.0,
            breached: false,
        };
    }
    let lower = password.to_lowercase();
    // EXACT match (whole password, or the stripped form) —
    // NOT a substring match. The Diceware list contains
    // "dragon"/"shadow"/"monkey"/"ninja", so a substring rule
    // would flag every generated passphrase containing one of
    // those words as breached (score 0), which would make
    // master-password validation reject the app's own generated
    // passphrases. Repeating a breached word
    // ("passwordpassword") is still breached — see
    // is_repeated_common.
    let breached = is_common_word(&lower) || is_repeated_common(&lower);
    let mut bits = shannon_entropy_bits(password);
    // Repeated runs / sequences / all-same-char discount
    // the effective bits instead of deducting score points.
    if has_repeat_run(password, 3) || has_sequence(password, 4) {
        bits = (bits * 0.52).max(10.0);
    }
    if breached {
        return StrengthEval {
            score: 0,
            bits: bits.min(22.0),
            breached: true,
        };
    }
    let len = password.chars().count();
    let score = if len < 8 || bits < 36.0 {
        1
    } else if bits < 56.0 {
        2
    } else if bits < 80.0 {
        3
    } else {
        4
    };
    StrengthEval {
        score,
        bits,
        breached: false,
    }
}

fn has_sequence(s: &str, n: usize) -> bool {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() < n {
        return false;
    }
    for w in chars.windows(n) {
        let asc = w.windows(2).all(|p| p[1] as i32 - p[0] as i32 == 1);
        let desc = w.windows(2).all(|p| p[0] as i32 - p[1] as i32 == 1);
        if asc || desc {
            return true;
        }
    }
    false
}

fn has_repeat_run(s: &str, n: usize) -> bool {
    let mut run = 1usize;
    let mut prev: Option<char> = None;
    for c in s.chars() {
        if Some(c) == prev {
            run += 1;
            if run >= n {
                return true;
            }
        } else {
            run = 1;
            prev = Some(c);
        }
    }
    false
}

const COMMON_PASSWORDS: &[&str] = &[
    "123456", "123456789", "12345678", "12345", "1234567", "1234567890", "password", "password1", "password123",
    "qwerty", "qwerty123", "abc123", "111111", "123123", "admin", "letmein", "welcome", "monkey",
    "dragon", "baseball", "football", "iloveyou", "trustno1", "sunshine", "princess", "master", "hello",
    "freedom", "whatever", "qazwsx", "1q2w3e4r", "1qaz2wsx", "zaq12wsx", "passw0rd", "p@ssword", "p@ssw0rd",
    "charlie", "michael", "shadow", "ashley", "bailey", "superman", "batman", "hunter2", "correcthorsebatterystaple",
    "summer", "winter", "spring", "autumn", "welcome123", "changeme", "secret", "test1234", "root",
    "toor", "default", "qwertyuiop", "asdfghjkl", "654321", "000000", "987654321", "chocolate", "cookie",
    "starwars", "pokemon", "minecraft", "roblox", "liverpool", "arsenal", "admin123", "pass1234", "qwerty1",
    "jordan", "harley", "ranger", "buster",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kdf_is_deterministic_per_salt() {
        let salt = [7u8; SALT_LEN];
        let a = derive_kek("correct horse battery staple", &salt).expect("kdf a");
        let b = derive_kek("correct horse battery staple", &salt).expect("kdf b");
        assert_eq!(&*a, &*b);
        let c = derive_kek("wrong horse", &salt).expect("kdf c");
        assert_ne!(&*a, &*c);
    }

    #[test]
    fn aead_round_trip_and_tamper_detection() {
        let key = random_bytes::<KEY_LEN>();
        let (nonce, ct) = encrypt(&key, b"top secret", b"aad").expect("encrypt");
        let pt = decrypt(&key, &nonce, &ct, b"aad").expect("decrypt");
        assert_eq!(&*pt, b"top secret");
        let mut bad = ct.clone();
        bad[0] ^= 1;
        assert!(decrypt(&key, &nonce, &bad, b"aad").is_err());
        assert!(decrypt(&key, &nonce, &ct, b"other-aad").is_err());
    }

    #[test]
    fn wrap_unwrap_round_trip() {
        let salt = random_bytes::<SALT_LEN>();
        let kek = derive_kek("hunter2-but-longer", &salt).expect("kdf");
        let mk = random_bytes::<KEY_LEN>();
        let (nonce, wrapped) = wrap_master_key(&kek, &mk, b"slot-password").expect("wrap");
        let back = unwrap_master_key(&kek, &nonce, &wrapped, b"slot-password").expect("unwrap");
        assert_eq!(back.expose(), &mk);
    }

    #[test]
    fn strength_scores() {
        assert_eq!(evaluate_strength("password").score, 0);
        assert!(evaluate_strength("X9$kQ!2mZp#8vL4n").score >= 3);
        assert!(evaluate_strength("abc").score <= 1);
    }

    // Bands: thresholds 36/56/80; score 0 (active) means
    // exactly "in the common list"; pattern passwords discount
    // bits instead of deducting score.
    #[test]
    fn strength_bands() {
        let empty = evaluate_strength("");
        assert_eq!(empty.score, 0);
        assert_eq!(empty.bits, 0.0);
        assert!(!empty.breached);

        let breached = evaluate_strength("password");
        assert!(breached.breached);
        assert_eq!(breached.score, 0);
        assert!(breached.bits <= 22.0);

        // 8 chars, no pattern, 41 bits -> Fair. (Not "hello123":
        // "hello" is in the common list, so that one is breached.)
        assert_eq!(evaluate_strength("zelda123").score, 2);
        // Sequence discounts bits below the Fair floor -> Weak.
        assert_eq!(evaluate_strength("abcdefgh").score, 1);
        // 77 bits -> Strong.
        assert_eq!(evaluate_strength("CorrectHorse1").score, 3);
        // 118 bits -> Excellent.
        assert_eq!(evaluate_strength("X9$kQ!2mZp#8vL4n").score, 4);
    }

    // The breach rule is exact-match (+ the stripped
    // suffix), never substring — the Diceware list contains
    // "dragon"/"shadow"/"monkey"/"ninja", so a substring rule
    // would flag generated passphrases built from those words
    // as breached, and master-password validation would reject
    // the app's own generated passphrases.
    #[test]
    fn breach_rule_is_exact_not_substring() {
        // Whole-word common passwords and their suffixed
        // forms are still breached.
        assert!(evaluate_strength("password").breached);
        assert!(evaluate_strength("password123").breached);
        assert!(evaluate_strength("password2024!").breached);
        assert!(evaluate_strength("qwerty").breached);
        assert_eq!(evaluate_strength("password123").score, 0);
        // A longer password merely CONTAINING one is not.
        assert!(!evaluate_strength("dragonfly").breached);
        assert!(!evaluate_strength("mydragonpass1").breached);
        // ...but repeating one is: "passwordpassword" is just
        // "password" twice, and export validation rejects it.
        assert!(evaluate_strength("passwordpassword").breached);
        assert_eq!(evaluate_strength("passwordpassword").score, 0);
        assert!(evaluate_strength("qwertyqwerty").breached);
        // A generated-style passphrase built from list words
        // (incl. "dragon"/"shadow"/"monkey"/"ninja") is not
        // breached and scores high enough to be a master
        // password.
        let pp = evaluate_strength("dragon-shadow-monkey-ninja-castle-river-7");
        assert!(!pp.breached);
        assert!(pp.score >= 2);
    }
}
