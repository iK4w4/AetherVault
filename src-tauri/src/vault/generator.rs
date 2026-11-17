//! Smart password generator — three modes:
//! 1. **Cryptographic random** — CSPRNG characters with class toggles
//!    and an unambiguous-only filter (no `0/O`, `1/l/I`, …).
//! 2. **Diceware passphrase** — words drawn uniformly from an embedded
//!    256-word list (exactly 8 bits of entropy per word), custom
//!    separator, optional capitalization and trailing digit.
//! 3. **Recovery key** — 120-bit key (24 random bytes, 5 bits per
//!    character) rendered as grouped characters for the
//!    Emergency Recovery Sheet.
//!
//! All randomness comes from `rand::rngs::OsRng`. No `thread_rng`, no
//! seeded PRNG, no modulo bias in word/char selection (rejection
//! sampling via `gen_range`).

use rand::rngs::OsRng;
use rand::Rng;

use crate::errors::{Result, VaultError};

const LOWER: &str = "abcdefghijklmnopqrstuvwxyz";
const UPPER: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &str = "0123456789";
const SYMBOLS: &str = "!@#$%^&*()-_=+[]{};:,.<>?";
const UNAMBIGUOUS_DROP: &[char] = &['0', 'O', '1', 'l', 'I', '|', '`', '\''];

/// Size of the character pool `generate_random` draws from for
/// these options (after the unambiguous filter). The `generate_password`
/// command reports entropy as `length * log2(pool size)` from this.
pub fn random_charset_size(opts: &RandomOptions) -> usize {
    let mut size = 0usize;
    let class = |set: &str| -> usize {
        set.chars()
            .filter(|c| !opts.unambiguous_only || !UNAMBIGUOUS_DROP.contains(c))
            .count()
    };
    if opts.lowercase {
        size += class(LOWER);
    }
    if opts.uppercase {
        size += class(UPPER);
    }
    if opts.digits {
        size += class(DIGITS);
    }
    if opts.symbols {
        size += class(SYMBOLS);
    }
    size
}

#[derive(Debug, Clone)]
pub struct RandomOptions {
    pub length: usize,
    pub lowercase: bool,
    pub uppercase: bool,
    pub digits: bool,
    pub symbols: bool,
    pub unambiguous_only: bool,
}

impl Default for RandomOptions {
    fn default() -> Self {
        Self {
            length: 20,
            lowercase: true,
            uppercase: true,
            digits: true,
            symbols: true,
            unambiguous_only: false,
        }
    }
}

pub fn generate_random(opts: &RandomOptions) -> Result<String> {
    if opts.length == 0 || opts.length > 256 {
        return Err(VaultError::Validation(
            "Password length must be between 1 and 256.".into(),
        ));
    }
    let mut pool = String::new();
    if opts.lowercase {
        pool.push_str(LOWER);
    }
    if opts.uppercase {
        pool.push_str(UPPER);
    }
    if opts.digits {
        pool.push_str(DIGITS);
    }
    if opts.symbols {
        pool.push_str(SYMBOLS);
    }
    if pool.is_empty() {
        return Err(VaultError::Validation(
            "Enable at least one character class.".into(),
        ));
    }
    if opts.unambiguous_only {
        pool.retain(|c| !UNAMBIGUOUS_DROP.contains(&c));
    }
    let chars: Vec<char> = pool.chars().collect();
    let mut rng = OsRng;
    let mut out = String::with_capacity(opts.length);
    // Guarantee at least one character from each enabled class, then
    // fill the rest from the full pool and Fisher–Yates shuffle so the
    // guaranteed characters are not predictably positioned.
    let mut required: Vec<char> = Vec::new();
    let class_sets: Vec<&str> = [
        (opts.lowercase, LOWER),
        (opts.uppercase, UPPER),
        (opts.digits, DIGITS),
        (opts.symbols, SYMBOLS),
    ]
    .iter()
    .filter(|(on, _)| *on)
    .map(|(_, s)| *s)
    .collect();
    for set in &class_sets {
        let filtered: Vec<char> = set
            .chars()
            .filter(|c| !opts.unambiguous_only || !UNAMBIGUOUS_DROP.contains(c))
            .collect();
        if !filtered.is_empty() {
            required.push(filtered[rng.gen_range(0..filtered.len())]);
        }
    }
    // A length shorter than the enabled class count is an
    // honest validation error, not a quietly dropped guarantee:
    // length 2 with all four classes would otherwise keep only
    // the first two.
    if opts.length < required.len() {
        return Err(VaultError::Validation(
            "Password length is shorter than the number of enabled character classes — each enabled class needs at least one character.".into(),
        ));
    }
    for c in required.iter().take(opts.length) {
        out.push(*c);
    }
    while out.chars().count() < opts.length {
        out.push(chars[rng.gen_range(0..chars.len())]);
    }
    let mut v: Vec<char> = out.chars().collect();
    for i in (1..v.len()).rev() {
        let j = rng.gen_range(0..=i);
        v.swap(i, j);
    }
    Ok(v.into_iter().collect())
}

#[derive(Debug, Clone)]
pub struct PassphraseOptions {
    pub words: usize,
    pub separator: String,
    pub capitalize: bool,
    pub append_digit: bool,
}

impl Default for PassphraseOptions {
    fn default() -> Self {
        Self {
            // 8 words by default (64 bits from the words
            // alone, ~67.3 with the digit).
            words: 8,
            separator: "-".to_string(),
            capitalize: false,
            append_digit: true,
        }
    }
}

pub fn generate_passphrase(opts: &PassphraseOptions) -> Result<String> {
    if opts.words == 0 || opts.words > 20 {
        return Err(VaultError::Validation(
            "Passphrase must have between 1 and 20 words.".into(),
        ));
    }
    let mut rng = OsRng;
    let mut parts: Vec<String> = Vec::with_capacity(opts.words);
    for _ in 0..opts.words {
        let mut w = WORDLIST[rng.gen_range(0..WORDLIST.len())].to_string();
        if opts.capitalize {
            let mut cs = w.chars();
            if let Some(first) = cs.next() {
                w = first.to_uppercase().collect::<String>() + cs.as_str();
            }
        }
        parts.push(w);
    }
    let mut out = parts.join(&opts.separator);
    if opts.append_digit {
        out.push_str(&opts.separator);
        out.push_str(&rng.gen_range(0..10).to_string());
    }
    Ok(out)
}

/// Exact entropy of a passphrase under this generator:
/// `words * log2(256)` plus the optional digit.
pub fn passphrase_entropy_bits(opts: &PassphraseOptions) -> f64 {
    let mut bits = opts.words as f64 * (WORDLIST.len() as f64).log2();
    if opts.append_digit {
        bits += (10f64).log2();
    }
    bits
}

/// Recovery key: `AEV-` + 6 groups of 4 chars drawn from the
/// 32-char alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/1/I/O),
/// 24 random bytes mapped `byte % 32`.
pub const RECOVERY_ALPHABET: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/// Canonical grouped form: `AEV-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` (33 chars).
pub fn generate_recovery_key() -> String {
    let bytes = crate::crypto::random_bytes::<24>();
    let alpha: Vec<char> = RECOVERY_ALPHABET.chars().collect();
    let body: String = bytes
        .iter()
        .map(|b| alpha[(*b as usize) % alpha.len()])
        .collect();
    regroup_recovery(&body)
}

fn regroup_recovery(body: &str) -> String {
    let mut out = String::with_capacity(33);
    out.push_str("AEV");
    for chunk in body.as_bytes().chunks(4) {
        out.push('-');
        out.push_str(std::str::from_utf8(chunk).unwrap_or(""));
    }
    out
}

/// Strict recovery-key normalisation: after stripping
/// non-alphanumerics and uppercasing, the input MUST be the 24-char
/// body (with `AEV` prepended) or the 27-char `AEV` + 24-char body,
/// and every body char must be in the recovery alphabet. Anything
/// else is a typo or a wrong key, not a recovery key — reject it
/// instead of silently accepting a truncated key that can never
/// unlock anything.
pub fn try_normalize_recovery_key(input: &str) -> Result<String> {
    let clean: String = input
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase();
    // A 24-char input starting with AEV is a TRUNCATED full key
    // (the first 24 chars of AEV + 24), not a bare body — treating
    // it as a body would silently regroup it into a different key
    // and report a misleading "wrong key" at unlock.
    if clean.len() == 24 && clean.starts_with("AEV") {
        return Err(VaultError::Validation(
            "That recovery key looks incomplete — the full key is AEV plus 24 characters. Check for a truncated copy.".into(),
        ));
    }
    let body = match clean.len() {
        24 => clean.as_str(),
        27 if clean.starts_with("AEV") => &clean[3..],
        _ => {
            return Err(VaultError::Validation(format!(
                "Recovery key must be 24 characters (optionally prefixed with AEV); got {} after ignoring spaces and dashes.",
                clean.len()
            )))
        }
    };
    if !body.chars().all(|c| RECOVERY_ALPHABET.contains(c)) {
        return Err(VaultError::Validation(
            "Recovery key contains characters outside the recovery alphabet (A–Z except I/O, digits 2–9).".into(),
        ));
    }
    Ok(regroup_recovery(body))
}

/// Embedded 256-word Diceware-style list (8.00 bits/word). Short,
/// common, unambiguous English words; no duplicates.
pub const WORDLIST: &[&str] = &[
    "apple",
    "anchor",
    "arrow",
    "artist",
    "autumn",
    "bacon",
    "badge",
    "balloon",
    "banana",
    "basket",
    "battery",
    "beach",
    "beaver",
    "bicycle",
    "bishop",
    "blanket",
    "blossom",
    "breeze",
    "bridge",
    "bronze",
    "bubble",
    "bucket",
    "butter",
    "cabin",
    "cactus",
    "camera",
    "candle",
    "canyon",
    "carpet",
    "castle",
    "cattle",
    "cedar",
    "celery",
    "cement",
    "chapel",
    "cherry",
    "chess",
    "chimney",
    "cider",
    "cinnamon",
    "circle",
    "citrus",
    "cliff",
    "clock",
    "cloud",
    "clover",
    "coast",
    "coffee",
    "coin",
    "comet",
    "compass",
    "copper",
    "coral",
    "cotton",
    "couch",
    "cougar",
    "coyote",
    "cradle",
    "crane",
    "crayon",
    "creek",
    "cricket",
    "crown",
    "crystal",
    "cupboard",
    "curtain",
    "cushion",
    "dagger",
    "daisy",
    "dancer",
    "dandelion",
    "desert",
    "diamond",
    "dolphin",
    "donkey",
    "dove",
    "dragon",
    "drawer",
    "dream",
    "drizzle",
    "drum",
    "dune",
    "dust",
    "eagle",
    "ember",
    "emerald",
    "engine",
    "falcon",
    "feather",
    "fennel",
    "fern",
    "ferry",
    "fig",
    "finch",
    "fjord",
    "flame",
    "flannel",
    "flask",
    "flint",
    "flute",
    "foam",
    "fog",
    "foil",
    "forest",
    "fork",
    "fossil",
    "fountain",
    "fox",
    "frost",
    "garlic",
    "garnet",
    "gate",
    "gecko",
    "gem",
    "ginger",
    "giraffe",
    "glacier",
    "glade",
    "glass",
    "globe",
    "glove",
    "glow",
    "goat",
    "gold",
    "goose",
    "gorilla",
    "granite",
    "grape",
    "grass",
    "gravel",
    "grove",
    "guitar",
    "gull",
    "hammer",
    "hamster",
    "harbor",
    "harvest",
    "hat",
    "haven",
    "hawk",
    "hazel",
    "heather",
    "hedge",
    "helm",
    "heron",
    "hill",
    "hippo",
    "hive",
    "holly",
    "honey",
    "hood",
    "hoof",
    "horizon",
    "horn",
    "horse",
    "hotel",
    "hound",
    "house",
    "huckle",
    "iceberg",
    "icicle",
    "icon",
    "igloo",
    "ink",
    "inn",
    "iris",
    "iron",
    "island",
    "ivory",
    "jacket",
    "jade",
    "jaguar",
    "jam",
    "jasmine",
    "jasper",
    "jazz",
    "jelly",
    "jet",
    "jewel",
    "jigsaw",
    "jungle",
    "juniper",
    "kayak",
    "kettle",
    "key",
    "kick",
    "kidney",
    "kite",
    "kitten",
    "kiwi",
    "knight",
    "knot",
    "koala",
    "ladder",
    "lagoon",
    "lake",
    "lamp",
    "lantern",
    "larch",
    "lark",
    "laser",
    "latch",
    "laurel",
    "lava",
    "lawn",
    "leaf",
    "leather",
    "ledger",
    "leek",
    "lemon",
    "lens",
    "leopard",
    "letter",
    "lettuce",
    "level",
    "lever",
    "liberty",
    "lilac",
    "lily",
    "lime",
    "linen",
    "lion",
    "lizard",
    "llama",
    "lobster",
    "locket",
    "lodge",
    "loft",
    "logic",
    "lonely",
    "lotus",
    "lounge",
    "lucky",
    "lunar",
    "lunch",
    "lute",
    "lynx",
    "lyric",
    "magnet",
    "maiden",
    "mallard",
    "mallow",
    "mango",
    "manor",
    "maple",
    "marble",
    "march",
    "marina",
    "marlin",
    "marrow",
    "marsh",
    "mason",
    "meadow",
    "melon",
    "mesa",
    "meteor",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wordlist_is_256_unique() {
        assert_eq!(WORDLIST.len(), 256);
        let mut sorted = WORDLIST.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), 256);
    }

    #[test]
    fn random_respects_length_and_classes() {
        let opts = RandomOptions {
            length: 32,
            ..Default::default()
        };
        let pw = generate_random(&opts).expect("gen");
        assert_eq!(pw.chars().count(), 32);
        assert!(pw.chars().any(|c| c.is_ascii_lowercase()));
        assert!(pw.chars().any(|c| c.is_ascii_uppercase()));
        assert!(pw.chars().any(|c| c.is_ascii_digit()));
        assert!(pw.chars().any(|c| c.is_ascii_punctuation()));
    }

    // A length shorter than the enabled class count
    // is an error, not a silently dropped guarantee.
    #[test]
    fn random_short_length_is_validation_error() {
        let opts = RandomOptions {
            length: 2,
            ..Default::default()
        };
        assert!(matches!(
            generate_random(&opts),
            Err(VaultError::Validation(_))
        ));
    }

    #[test]
    fn unambiguous_filter_applies() {
        let opts = RandomOptions {
            length: 64,
            unambiguous_only: true,
            ..Default::default()
        };
        let pw = generate_random(&opts).expect("gen");
        assert!(!pw.chars().any(|c| UNAMBIGUOUS_DROP.contains(&c)));
    }

    #[test]
    fn passphrase_shape_and_entropy() {
        let opts = PassphraseOptions::default();
        let pp = generate_passphrase(&opts).expect("gen");
        assert_eq!(pp.split('-').count(), 9); // 8 words + digit
        assert!((passphrase_entropy_bits(&opts) - 67.32).abs() < 0.1);
    }

    #[test]
    fn recovery_key_strict_normalisation() {
        let key = generate_recovery_key();
        // Format: AEV- + 6 groups of 4 (33 chars total).
        assert_eq!(key.len(), 33);
        assert!(key.starts_with("AEV-"));
        assert!(key[4..]
            .chars()
            .all(|c| c == '-' || RECOVERY_ALPHABET.contains(c)));
        assert_eq!(try_normalize_recovery_key(&key).expect("full key"), key);
        // Sloppy-but-complete input still normalizes.
        let messy = key.to_lowercase().replace('-', " ");
        assert_eq!(try_normalize_recovery_key(&messy).expect("messy"), key);
        // Bare 24-char body works.
        let bare: String = key.chars().filter(|c| *c != '-').collect();
        assert_eq!(bare.len(), 27); // AEV + 24
        let body_only = &bare[3..];
        assert_eq!(
            try_normalize_recovery_key(body_only).expect("bare body"),
            key
        );
        // Anything that is not exactly 24 body chars is rejected.
        assert!(try_normalize_recovery_key("ABCD-1234").is_err());
        assert!(try_normalize_recovery_key("").is_err());
        assert!(try_normalize_recovery_key(&format!("{key}-ABCD")).is_err());
        // Characters outside the alphabet (0/1/I/O) are rejected.
        assert!(try_normalize_recovery_key("AEV-0000-0000-0000-0000-0000-0000").is_err());
        assert!(try_normalize_recovery_key("AEV-IIII-IIII-IIII-IIII-IIII-IIII").is_err());
    }
}
