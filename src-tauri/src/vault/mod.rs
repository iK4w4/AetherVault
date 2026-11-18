//! Vault envelope, persistence, session, and key slots.
//!
//! On-disk envelope (`vault.dat`, always next to the executable):
//!
//! ```text
//! offset  size  field
//! 0       4     magic "AVLT"
//! 4       1     format version (= 2)
//! 5       24    payload nonce (XChaCha20-Poly1305, fresh per write)
//! 29      1     slot flags: bit0 = password slot present (always),
//!               bit1 = recovery slot present
//! 30      32    password-slot KDF salt
//! 62      24    password-slot wrap nonce
//! 86      48    password-slot wrapped master key
//! [134    32    recovery-slot KDF salt ]   (if bit1)
//! [166    24    recovery-slot wrap nonce ]
//! [190    48    recovery-slot wrapped master key ]
//! ..      ..    ciphertext || Poly1305 tag (JSON payload, key = MK,
//!               AAD = "aethervault-payload-v2")
//! ```
//!
//! Design notes:
//!
//! * The payload is the frontend's `VaultPayload` JSON, treated as
//!   an opaque value — the entry schema has card/identity fields,
//!   `trashedAt`, `customFields`, …. Before encryption the payload
//!   is wrapped as
//!   `{"canary": "aethervault-canary-v2", "payload": <payload JSON>}`.
//! * The unlock throttle is persisted (`vault.throttle.json`
//!   sidecar — see `throttle.rs`), not in-memory only.
//! * Master-password rule is min 8 chars, no strength gate
//!   (matching the UI contract "at least 8 characters").
//! * The session caches the last plaintext payload JSON
//!   (`last_payload`, zeroized on lock) so `export_backup` can
//!   encrypt it without the frontend re-supplying it.
//!
//! Writes are atomic: serialize → encrypt → write a per-target
//! temp in the same directory → flush + fsync → rename over
//! `vault.dat`. A crash leaves either the old or the new vault,
//! never a torn one. Every save first rotates the current vault
//! into `vault.dat.bak` (one generation back); a corrupt primary
//! unlock falls back to the backup.

pub mod audit;
pub mod backup;
pub mod clipboard;
pub mod generator;
pub mod throttle;
pub mod totp;

use std::path::{Path, PathBuf};

use serde_json::Value;
use zeroize::Zeroizing;

use crate::crypto::{self, MasterKey, KEY_LEN, NONCE_LEN, SALT_LEN, WRAPPED_KEY_LEN};
use crate::errors::{io_at, Result, VaultError};

pub use throttle::ThrottleStore;

pub const MAGIC: &[u8; 4] = b"AVLT";
pub const FORMAT_VERSION: u8 = 2;
pub const PAYLOAD_AAD: &[u8] = b"aethervault-payload-v2";
pub const SLOT_PASSWORD_AAD: &[u8] = b"aethervault-slot-password-v2";
pub const SLOT_RECOVERY_AAD: &[u8] = b"aethervault-slot-recovery-v2";
/// Canary inside the encrypted payload: a second line of defence
/// that detects a payload decrypted under the wrong key even if the
/// format ever changes.
pub const CANARY: &str = "aethervault-canary-v2";

pub fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// The initial payload `create_vault` writes. The frontend
/// immediately overwrites it with its own payload via
/// `save_vault` after onboarding.
pub fn default_payload() -> Value {
    serde_json::json!({
        "entries": [],
        "settings": {
            "theme": "light",
            "zoom": 1,
            "autoLockMinutes": 5,
            "clipboardClearSeconds": 20
        }
    })
}

/// Master-password rule: at least 8 characters, matching the
/// UI contract. No strength gate here.
pub fn validate_master_password(pw: &str) -> Result<()> {
    if pw.chars().count() < 8 {
        return Err(VaultError::Validation(
            "Master password must be at least 8 characters.".into(),
        ));
    }
    // Argon2id does not save a password that is in every wordlist:
    // reject breached passwords and anything under 36 effective bits.
    let eval = crate::crypto::evaluate_strength(pw);
    if eval.breached {
        return Err(VaultError::Validation(
            "That password is in a list of commonly breached passwords — pick a different one.".into(),
        ));
    }
    if eval.score < 2 {
        return Err(VaultError::Validation(
            "That password is too weak — use a longer password with mixed letters, numbers, and symbols.".into(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Key slots
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct KeySlot {
    pub salt: [u8; SALT_LEN],
    pub wrap_nonce: [u8; NONCE_LEN],
    pub wrapped: [u8; WRAPPED_KEY_LEN],
}

impl KeySlot {
    /// Build a slot from a plaintext secret: fresh salt → Argon2id
    /// KEK → wrap the master key.
    fn create(secret: &str, mk: &[u8; KEY_LEN], aad: &[u8]) -> Result<KeySlot> {
        let salt = crypto::random_bytes::<SALT_LEN>();
        let kek = crypto::derive_kek(secret, &salt)?;
        let (wrap_nonce, wrapped) = crypto::wrap_master_key(&kek, mk, aad)?;
        Ok(KeySlot {
            salt,
            wrap_nonce,
            wrapped,
        })
    }

    fn unlock(&self, secret: &str, aad: &[u8]) -> Result<MasterKey> {
        let kek = crypto::derive_kek(secret, &self.salt)?;
        crypto::unwrap_master_key(&kek, &self.wrap_nonce, &self.wrapped, aad)
            .map_err(|_| VaultError::InvalidCredentials)
    }

    /// Pure probe: does this secret unwrap the slot? No session
    /// change, no throttle recording — for `verify_*` commands.
    fn probes(&self, secret: &str, aad: &[u8]) -> bool {
        self.unlock(secret, aad).is_ok()
    }
}

// ---------------------------------------------------------------------------
// Envelope read/write
// ---------------------------------------------------------------------------

struct Envelope {
    payload_nonce: [u8; NONCE_LEN],
    password_slot: KeySlot,
    recovery_slot: Option<KeySlot>,
    ciphertext: Vec<u8>,
}

fn serialize_envelope(env: &Envelope) -> Vec<u8> {
    let mut out = Vec::with_capacity(256 + env.ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.push(FORMAT_VERSION);
    out.extend_from_slice(&env.payload_nonce);
    let mut flags = 0b0000_0001u8;
    if env.recovery_slot.is_some() {
        flags |= 0b0000_0010;
    }
    out.push(flags);
    let write_slot = |out: &mut Vec<u8>, s: &KeySlot| {
        out.extend_from_slice(&s.salt);
        out.extend_from_slice(&s.wrap_nonce);
        out.extend_from_slice(&s.wrapped);
    };
    write_slot(&mut out, &env.password_slot);
    if let Some(r) = &env.recovery_slot {
        write_slot(&mut out, r);
    }
    out.extend_from_slice(&env.ciphertext);
    out
}

fn parse_envelope(bytes: &[u8]) -> Result<Envelope> {
    let corrupt = |why: &str| VaultError::CorruptVault(why.to_string());
    if bytes.len() < 5 {
        return Err(corrupt("file too short"));
    }
    if &bytes[0..4] != MAGIC {
        return Err(corrupt("bad magic — not an AetherVault file"));
    }
    if bytes[4] != FORMAT_VERSION {
        return Err(corrupt("unsupported format version"));
    }
    let mut cur = 5usize;
    let take = |bytes: &[u8], cur: &mut usize, n: usize| -> Result<Vec<u8>> {
        if bytes.len() < *cur + n {
            return Err(corrupt("truncated header"));
        }
        let v = bytes[*cur..*cur + n].to_vec();
        *cur += n;
        Ok(v)
    };
    let payload_nonce_v = take(bytes, &mut cur, NONCE_LEN)?;
    let flags = take(bytes, &mut cur, 1)?[0];
    if flags & !0b11 != 0 {
        return Err(corrupt(
            "unknown envelope flags — file may be from a newer version",
        ));
    }
    let read_slot = |bytes: &[u8], cur: &mut usize| -> Result<KeySlot> {
        let salt = take(bytes, cur, SALT_LEN)?;
        let nonce = take(bytes, cur, NONCE_LEN)?;
        let wrapped = take(bytes, cur, WRAPPED_KEY_LEN)?;
        let mut s = [0u8; SALT_LEN];
        s.copy_from_slice(&salt);
        let mut n = [0u8; NONCE_LEN];
        n.copy_from_slice(&nonce);
        let mut w = [0u8; WRAPPED_KEY_LEN];
        w.copy_from_slice(&wrapped);
        Ok(KeySlot {
            salt: s,
            wrap_nonce: n,
            wrapped: w,
        })
    };
    let password_slot = read_slot(bytes, &mut cur)?;
    let recovery_slot = if flags & 0b10 != 0 {
        Some(read_slot(bytes, &mut cur)?)
    } else {
        None
    };
    if bytes.len() <= cur {
        return Err(corrupt("missing payload"));
    }
    let mut payload_nonce = [0u8; NONCE_LEN];
    payload_nonce.copy_from_slice(&payload_nonce_v);
    Ok(Envelope {
        payload_nonce,
        password_slot,
        recovery_slot,
        ciphertext: bytes[cur..].to_vec(),
    })
}

/// Wrap the opaque frontend payload as
/// `{"canary": ..., "payload": ...}` and serialize to bytes.
fn wrap_payload(payload: &Value) -> Result<Vec<u8>> {
    let wrapped = serde_json::json!({ "canary": CANARY, "payload": payload });
    serde_json::to_vec(&wrapped).map_err(|e| VaultError::Serialization(e.to_string()))
}

/// Decrypt + unwrap a payload. Returns the payload JSON and its
/// canonical re-serialized string (cached in the session for
/// `export_backup`). Payload failures after a proven credential are
/// CORRUPTION, never wrong credentials.
fn decrypt_payload(env: &Envelope, mk: &MasterKey) -> Result<(Value, String)> {
    let pt = Zeroizing::new(
        crypto::decrypt(mk.expose(), &env.payload_nonce, &env.ciphertext, PAYLOAD_AAD).map_err(
            |_| {
                VaultError::CorruptVault(
                    "payload decryption failed — the vault file may be corrupt or tampered; restore from backup"
                        .into(),
                )
            },
        )?,
    );
    let wrapped: Value = serde_json::from_slice(&pt)
        .map_err(|e| VaultError::Serialization(e.to_string()))?;
    if wrapped.get("canary").and_then(|c| c.as_str()) != Some(CANARY) {
        return Err(VaultError::CorruptVault(
            "payload canary mismatch — the vault file may be corrupt or tampered; restore from backup"
                .into(),
        ));
    }
    let payload = wrapped
        .get("payload")
        .cloned()
        .ok_or_else(|| VaultError::CorruptVault("payload wrapper has no payload".into()))?;
    let payload_str =
        serde_json::to_string(&payload).map_err(|e| VaultError::Serialization(e.to_string()))?;
    Ok((payload, payload_str))
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/// The live unlocked session. The master key lives in a `SecretBox`
/// (zeroized on drop); `last_payload` is the plaintext payload JSON
/// cached for `export_backup`, zeroized on lock.
pub struct Session {
    pub master_key: MasterKey,
    pub unlocked_via_recovery: bool,
    pub password_slot: KeySlot,
    pub recovery_slot: Option<KeySlot>,
    pub last_payload: Zeroizing<String>,
    /// Set when the last `save()` failed to reach disk: the frontend
    /// already applied the edit, so `last_payload` is stale and
    /// `export_backup` must refuse until the vault is re-synced.
    pub save_failed: bool,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("master_key", &self.master_key)
            .field("unlocked_via_recovery", &self.unlocked_via_recovery)
            .field("password_slot", &"[present]")
            .field("recovery_slot_present", &self.recovery_slot.is_some())
            .field("last_payload_len", &self.last_payload.len())
            .finish()
    }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

pub struct VaultStore {
    pub path: PathBuf,
    throttle: ThrottleStore,
    /// Serializes check → attempt → record for unlock/verify/create
    /// so concurrent guesses can't all pass the throttle check
    /// before any failure is recorded (and two concurrent creates
    /// can't both pass the exists-check).
    attempt_lock: std::sync::Mutex<()>,
}

impl VaultStore {
    pub fn new(path: PathBuf) -> Self {
        Self::with_lockout(path, throttle::DEFAULT_LOCKOUT_SECS)
    }

    /// Test seam: short lockout so tests never sleep 30 s.
    pub fn with_lockout(path: PathBuf, lockout_secs: u64) -> Self {
        let throttle = ThrottleStore::with_lockout(&path, lockout_secs);
        Self {
            path,
            throttle,
            attempt_lock: std::sync::Mutex::new(()),
        }
    }

    pub fn exists(&self) -> bool {
        self.path.exists()
    }

    /// `vault.dat.bak` — the previous good vault, one generation back.
    pub fn backup_path(&self) -> PathBuf {
        let mut s = self.path.clone().into_os_string();
        s.push(".bak");
        PathBuf::from(s)
    }

    pub fn throttle_path(&self) -> PathBuf {
        self.throttle.path().to_path_buf()
    }

    /// (failed_attempts, locked_until_unix) — effective values
    /// (expired lockout reads as 0/0). `locked_until_unix` is 0
    /// when not locked out.
    pub fn throttle_status(&self) -> (u32, i64) {
        let state = self.throttle.effective(now_unix());
        if state.is_locked_out(now_unix()) {
            (state.failed_attempts, state.locked_until_unix)
        } else {
            (state.failed_attempts, 0)
        }
    }

    fn read_envelope_from(&self, path: &Path) -> Result<Envelope> {
        if let Some(dir) = path.parent() {
            sweep_stale_temps(dir);
        }
        if !path.exists() {
            return Err(VaultError::VaultNotFound(path.display().to_string()));
        }
        // A bloated vault file must not OOM the process: a real vault
        // is far below this (entries are small JSON).
        const MAX_VAULT_BYTES: u64 = 64 * 1024 * 1024;
        if let Ok(meta) = std::fs::metadata(path) {
            if meta.len() > MAX_VAULT_BYTES {
                return Err(VaultError::CorruptVault(format!(
                    "Vault file is {} bytes, over the {} byte limit.",
                    meta.len(),
                    MAX_VAULT_BYTES
                )));
            }
        }
        let bytes = std::fs::read(path).map_err(|e| io_at(path, e))?;
        parse_envelope(&bytes)
    }

    /// Read the primary envelope; on a PARSE-level `CorruptVault`
    /// only, retry once against `vault.dat.bak`. Used for
    /// header-only reads (verify probes, password/recovery
    /// rotation) where no payload decryption happens. Full unlock
    /// attempts use `unlock_with_backup` instead, which retries
    /// decrypt failures too.
    fn read_envelope_with_backup(&self) -> Result<Envelope> {
        Ok(self.read_envelope_with_backup_flagged()?.0)
    }

    /// Same read, but also reports whether the envelope came
    /// from `vault.dat.bak` because the primary failed to parse.
    /// Mutation paths (password / recovery rotation) need this:
    /// building a new envelope on the backup generation is a
    /// legitimate repair, but persisting it must NOT rotate the
    /// corrupt primary over the good `.bak` (that would destroy
    /// the only other copy and silently roll the vault back).
    fn read_envelope_with_backup_flagged(&self) -> Result<(Envelope, bool)> {
        match self.read_envelope_from(&self.path) {
            Ok(env) => Ok((env, false)),
            Err(VaultError::CorruptVault(primary)) => {
                let bak = self.backup_path();
                if !bak.exists() {
                    return Err(VaultError::CorruptVault(primary));
                }
                match self.read_envelope_from(&bak) {
                    Ok(env) => Ok((env, true)),
                    Err(_) => Err(VaultError::CorruptVault(primary)),
                }
            }
            Err(e) => Err(e),
        }
    }

    /// Run `attempt` against the primary vault; on `CorruptVault`
    /// only — whether the envelope fails to parse OR the payload
    /// fails to decrypt — retry once against `vault.dat.bak`. Any
    /// other error, including a wrong password, is returned as-is:
    /// a corrupt primary is never allowed to mask, or be masked
    /// by, a credential failure. If the backup attempt reaches a
    /// credential verdict (`InvalidCredentials`), that verdict is
    /// passed through so the unlock throttle records it; any
    /// other backup failure reports the PRIMARY corruption error
    /// (it is the real problem).
    fn unlock_with_backup(
        &self,
        attempt: impl Fn(&Path) -> Result<Session>,
    ) -> Result<Session> {
        match attempt(&self.path) {
            Ok(s) => Ok(s),
            Err(VaultError::CorruptVault(primary)) => {
                let bak = self.backup_path();
                if !bak.exists() {
                    return Err(VaultError::CorruptVault(primary));
                }
                match attempt(&bak) {
                    Ok(s) => Ok(s),
                    // A credential verdict from the backup is a
                    // real verdict: pass it through so the unlock
                    // throttle records the failure. Masking it as
                    // CorruptVault (as before) meant wrong guesses
                    // against the .bak were never counted and the
                    // lockout never engaged.
                    Err(VaultError::InvalidCredentials) => {
                        Err(VaultError::InvalidCredentials)
                    }
                    Err(_) => Err(VaultError::CorruptVault(primary)),
                }
            }
            Err(e) => Err(e),
        }
    }

    /// Rotate the current vault into `vault.dat.bak` (fsynced)
    /// before the new vault is written. NEVER fails the save:
    /// on failure (locked/read-only .bak on Windows) the write
    /// carries on with the previous backup intact.
    fn rotate_backup(&self) {
        if !self.exists() {
            return;
        }
        let bak = self.backup_path();
        // Hidden `.*.tmp` name so `sweep_stale_temps` cleans up the
        // temp if this rotation is interrupted or fails. The suffix
        // is 64 random bits — a predictable name would let a
        // pre-planted symlink receive the vault bytes.
        let dir = self.path.parent().map(|d| d.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
        let rand = crate::crypto::random_bytes::<8>();
        let suffix: String = rand.iter().map(|b| format!("{b:02x}")).collect();
        let tmp = dir.join(format!(".vault.dat.bak.{}.{suffix}.tmp", std::process::id()));
        let attempt = |tmp: &Path, bak: &Path| -> std::io::Result<()> {
            std::fs::copy(&self.path, tmp)?;
            if let Ok(f) = std::fs::File::open(tmp) {
                let _ = f.sync_all();
            }
            let _ = std::fs::remove_file(bak);
            std::fs::rename(tmp, bak)?;
            Ok(())
        };
        if attempt(&tmp, &bak).is_err() {
            std::thread::sleep(std::time::Duration::from_millis(100));
            let _ = attempt(&tmp, &bak);
        }
        let _ = std::fs::remove_file(&tmp);
    }

    /// Persist a fully-built envelope: rotate backup, atomic write.
    fn persist_envelope(&self, env: &Envelope) -> Result<()> {
        self.persist_envelope_inner(env, true)
    }

    /// Persist WITHOUT rotating the current primary into
    /// `vault.dat.bak`. Used when the new envelope was built from
    /// the backup generation because the primary is corrupt:
    /// rotating would overwrite the good `.bak` with the corrupt
    /// bytes.
    fn persist_envelope_keep_backup(&self, env: &Envelope) -> Result<()> {
        self.persist_envelope_inner(env, false)
    }

    fn persist_envelope_inner(&self, env: &Envelope, rotate: bool) -> Result<()> {
        if let Some(dir) = self.path.parent() {
            sweep_stale_temps(dir);
        }
        if rotate {
            self.rotate_backup();
        }
        atomic_write(&self.path, &serialize_envelope(env))
    }

    /// Encrypt a payload under the session MK with a fresh nonce
    /// and persist it with the session's slots.
    fn persist_payload(&self, session: &Session, payload: &Value) -> Result<()> {
        let json = Zeroizing::new(wrap_payload(payload)?);
        let (payload_nonce, ciphertext) =
            crypto::encrypt(session.master_key.expose(), &json, PAYLOAD_AAD)?;
        let env = Envelope {
            payload_nonce,
            password_slot: session.password_slot.clone(),
            recovery_slot: session.recovery_slot.clone(),
            ciphertext,
        };
        self.persist_envelope(&env)
    }

    /// Create a brand-new vault AND persist it. Returns the session
    /// plus the recovery key (shown exactly once, on the Emergency
    /// Recovery Sheet). Starts unlocked (`via_recovery = false`).
    pub fn create(&self, master_password: &str) -> Result<(Session, String)> {
        // Serialized: two concurrent creates must not both pass the
        // exists-check (the loser would orphan the winner's session
        // and show the user a recovery key for a vault that no
        // longer exists on disk).
        let _guard = self.attempt_lock.lock().unwrap_or_else(|e| e.into_inner());
        if self.exists() {
            return Err(VaultError::Validation(
                "A vault already exists next to the executable.".into(),
            ));
        }
        validate_master_password(master_password)?;
        let mk_bytes = Zeroizing::new(crypto::random_bytes::<KEY_LEN>());
        // Copy the master key straight into its heap box: copying
        // through a stack array first would leave a live key copy
        // in stack residue.
        let mut boxed = Box::new([0u8; KEY_LEN]);
        boxed.copy_from_slice(&mk_bytes[..]);
        let master_key = MasterKey(secrecy::SecretBox::new(boxed));
        let password_slot = KeySlot::create(master_password, &mk_bytes, SLOT_PASSWORD_AAD)?;
        let recovery_key = generator::generate_recovery_key();
        let recovery_slot = KeySlot::create(&recovery_key, &mk_bytes, SLOT_RECOVERY_AAD)?;
        let payload = default_payload();
        let payload_str =
            serde_json::to_string(&payload).map_err(|e| VaultError::Serialization(e.to_string()))?;
        let session = Session {
            master_key,
            unlocked_via_recovery: false,
            password_slot,
            recovery_slot: Some(recovery_slot),
            last_payload: Zeroizing::new(payload_str),
            save_failed: false,
        };
        // Persist with the fresh session; on failure the caller
        // gets the error and no session (nothing half-written —
        // atomic_write either lands the whole envelope or not).
        self.persist_payload(&session, &payload)?;
        Ok((session, recovery_key))
    }

    /// Unlock with the master password. Throttled (5 failures →
    /// lockout, persisted in the sidecar); on a corrupt primary
    /// vault, retried once against `vault.dat.bak`. The whole
    /// check → attempt → record sequence runs under the attempt
    /// lock so concurrent guesses can't slip past the throttle.
    pub fn unlock_password(&self, password: &str) -> Result<Session> {
        let _guard = self.attempt_lock.lock().unwrap_or_else(|e| e.into_inner());
        let now = now_unix();
        self.throttle.check(now)?;
        let result = self.unlock_with_backup(|path| self.unlock_password_from(password, path));
        match &result {
            Ok(_) => self.throttle.reset(),
            Err(VaultError::InvalidCredentials) => self.throttle.record_failure(now),
            _ => {}
        }
        result
    }

    fn unlock_password_from(&self, password: &str, path: &Path) -> Result<Session> {
        let env = self.read_envelope_from(path)?;
        let mk = env.password_slot.unlock(password, SLOT_PASSWORD_AAD)?;
        let (_payload, payload_str) = decrypt_payload(&env, &mk)?;
        Ok(Session {
            master_key: mk,
            unlocked_via_recovery: false,
            password_slot: env.password_slot,
            recovery_slot: env.recovery_slot,
            last_payload: Zeroizing::new(payload_str),
            save_failed: false,
        })
    }

    /// Unlock with the recovery key. Same throttle bucket as the
    /// password path (alternating methods cannot bypass it).
    /// Check → attempt → record runs under the attempt lock.
    pub fn unlock_recovery(&self, recovery_key: &str) -> Result<Session> {
        let _guard = self.attempt_lock.lock().unwrap_or_else(|e| e.into_inner());
        let normalized = generator::try_normalize_recovery_key(recovery_key)?;
        let now = now_unix();
        self.throttle.check(now)?;
        let result = self.unlock_with_backup(|path| self.unlock_recovery_from(&normalized, path));
        match &result {
            Ok(_) => self.throttle.reset(),
            Err(VaultError::InvalidCredentials) => self.throttle.record_failure(now),
            _ => {}
        }
        result
    }

    fn unlock_recovery_from(&self, normalized: &str, path: &Path) -> Result<Session> {
        let env = self.read_envelope_from(path)?;
        let slot = env
            .recovery_slot
            .as_ref()
            .ok_or_else(|| VaultError::Validation("This vault has no recovery slot.".into()))?;
        let mk = slot.unlock(normalized, SLOT_RECOVERY_AAD)?;
        let (_payload, payload_str) = decrypt_payload(&env, &mk)?;
        Ok(Session {
            master_key: mk,
            unlocked_via_recovery: true,
            password_slot: env.password_slot,
            recovery_slot: env.recovery_slot,
            last_payload: Zeroizing::new(payload_str),
            save_failed: false,
        })
    }

    /// Pure KEK-unwrap probe for the password slot: no session
    /// change, no throttle recording.
    pub fn verify_password(&self, password: &str) -> bool {
        match self.read_envelope_with_backup() {
            Ok(env) => env.password_slot.probes(password, SLOT_PASSWORD_AAD),
            Err(_) => false,
        }
    }

    /// Throttled probe for the password slot. `verify_password` on
    /// its own is an unthrottled password oracle: any caller could
    /// guess through it forever and never trip the unlock lockout.
    /// This variant records failures in the same bucket as unlock,
    /// so the lock-screen reset dialog (which is built on this
    /// probe) can't be used to brute-force the master password.
    pub fn verify_password_throttled(&self, password: &str) -> bool {
        let _guard = self.attempt_lock.lock().unwrap_or_else(|e| e.into_inner());
        let now = now_unix();
        if self.throttle.check(now).is_err() {
            return false;
        }
        let ok = self.verify_password(password);
        if !ok {
            self.throttle.record_failure(now);
        }
        ok
    }

    /// Pure KEK-unwrap probe for the recovery slot. A malformed
    /// key is simply "does not verify" (false), not an error.
    pub fn verify_recovery(&self, key: &str) -> bool {
        let Ok(normalized) = generator::try_normalize_recovery_key(key) else {
            return false;
        };
        match self.read_envelope_with_backup() {
            Ok(env) => match &env.recovery_slot {
                Some(slot) => slot.probes(&normalized, SLOT_RECOVERY_AAD),
                None => false,
            },
            Err(_) => false,
        }
    }

    /// Throttled probe for the recovery slot — same bucket as
    /// unlock, for the same reason as `verify_password_throttled`.
    /// (The 120-bit recovery key isn't brute-forceable, but there
    /// is no reason to leave the probe open.)
    pub fn verify_recovery_throttled(&self, key: &str) -> bool {
        let _guard = self.attempt_lock.lock().unwrap_or_else(|e| e.into_inner());
        let now = now_unix();
        if self.throttle.check(now).is_err() {
            return false;
        }
        let ok = self.verify_recovery(key);
        if !ok {
            self.throttle.record_failure(now);
        }
        ok
    }

    /// Save the (frontend-supplied) payload with a fresh payload
    /// nonce. Updates the session's cached plaintext payload.
    /// On a write failure the session is marked `save_failed` so
    /// `export_backup` refuses to hand out the stale on-disk
    /// payload as if it were current.
    pub fn save(&self, session: &mut Session, payload: &Value) -> Result<()> {
        if let Err(e) = self.persist_payload(session, payload) {
            session.save_failed = true;
            return Err(e);
        }
        session.save_failed = false;
        let payload_str =
            serde_json::to_string(payload).map_err(|e| VaultError::Serialization(e.to_string()))?;
        session.last_payload = Zeroizing::new(payload_str);
        Ok(())
    }

    /// Change the master password: re-wrap the MK under a new KEK.
    /// The payload ciphertext is NEVER re-encrypted — the current
    /// envelope's ciphertext + payload nonce are reused verbatim.
    /// `current` is verified by unwrapping the password slot,
    /// unless `via_recovery` (allowed only when the session was
    /// unlocked via the recovery key). On success the session is
    /// no longer "via recovery".
    pub fn change_password(
        &self,
        session: &mut Session,
        current: &str,
        new_password: &str,
        via_recovery: bool,
    ) -> Result<()> {
        validate_master_password(new_password)?;
        if via_recovery {
            if !session.unlocked_via_recovery {
                return Err(VaultError::Validation(
                    "Password change via recovery requires unlocking with the recovery key first.".into(),
                ));
            }
        } else if !session.password_slot.probes(current, SLOT_PASSWORD_AAD) {
            return Err(VaultError::InvalidCredentials);
        }
        let new_slot = KeySlot::create(
            new_password,
            session.master_key.expose(),
            SLOT_PASSWORD_AAD,
        )?;
        let (env, from_backup) = self.read_envelope_with_backup_flagged()?;
        let new_env = Envelope {
            payload_nonce: env.payload_nonce,
            password_slot: new_slot,
            recovery_slot: env.recovery_slot,
            ciphertext: env.ciphertext,
        };
        // Commit to disk FIRST; only then swap the in-memory slot,
        // so memory and disk never disagree after a failed write.
        // When the envelope came from the backup (corrupt primary),
        // keep the good .bak instead of rotating the corrupt
        // primary over it.
        if from_backup {
            self.persist_envelope_keep_backup(&new_env)?;
        } else {
            self.persist_envelope(&new_env)?;
        }
        session.password_slot = new_env.password_slot;
        session.recovery_slot = new_env.recovery_slot;
        session.unlocked_via_recovery = false;
        Ok(())
    }

    /// Rotate the recovery key: returns the new key (shown once).
    /// Re-wraps the MK under a new recovery KEK with a fresh salt;
    /// the payload ciphertext is untouched and the old recovery
    /// key stops working as soon as the write lands.
    pub fn rotate_recovery_key(&self, session: &mut Session) -> Result<String> {
        let recovery_key = generator::generate_recovery_key();
        let new_slot = KeySlot::create(
            &recovery_key,
            session.master_key.expose(),
            SLOT_RECOVERY_AAD,
        )?;
        let (env, from_backup) = self.read_envelope_with_backup_flagged()?;
        let new_env = Envelope {
            payload_nonce: env.payload_nonce,
            password_slot: env.password_slot,
            recovery_slot: Some(new_slot),
            ciphertext: env.ciphertext,
        };
        if from_backup {
            self.persist_envelope_keep_backup(&new_env)?;
        } else {
            self.persist_envelope(&new_env)?;
        }
        session.password_slot = new_env.password_slot;
        session.recovery_slot = new_env.recovery_slot;
        Ok(recovery_key)
    }

    /// Delete `vault.dat` + `vault.dat.bak` + the throttle sidecar.
    pub fn erase(&self) {
        let _ = std::fs::remove_file(&self.path);
        let _ = std::fs::remove_file(self.backup_path());
        self.throttle.reset();
    }
}

/// Delete stranded `.*.tmp` temp files left in `dir` by crashed
/// writes. Only this app's own temp shape is removed
/// (`.vault.*.tmp` — vault, backup and throttle temps); anything
/// else in the folder is left alone.
pub fn sweep_stale_temps(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(s) = name.to_str() else {
            continue;
        };
        if s.starts_with(".vault.") && s.ends_with(".tmp") {
            // Never sweep a fresh temp: a write in flight right
            // now (this process's thread pool, or a second
            // instance) holds one, and deleting it between create
            // and rename silently loses that write — including
            // throttle sidecar writes, which swallowed the error
            // and dropped the recorded failure. Crash leftovers
            // are old by definition; 60 s is generous.
            let fresh = entry
                .metadata()
                .and_then(|m| m.modified())
                .map(|t| {
                    t.elapsed()
                        .map(|age| age < std::time::Duration::from_secs(60))
                        .unwrap_or(true)
                })
                .unwrap_or(true);
            if !fresh {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

/// Atomic write: a unique temp in the same directory → flush →
/// fsync → rename over the target → fsync the parent directory.
/// Same-directory rename is atomic on NTFS and POSIX alike.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("write");
    let mut tmp = PathBuf::new();
    let mut file = None;
    for _ in 0..16 {
        let rand = crypto::random_bytes::<8>();
        let suffix: String = rand.iter().map(|b| format!("{b:02x}")).collect();
        let candidate = dir.join(format!(".{stem}.{}.{suffix}.tmp", std::process::id()));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(f) => {
                tmp = candidate;
                file = Some(f);
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(io_at(&candidate, e)),
        }
    }
    let mut f = match file {
        Some(f) => f,
        None => {
            return Err(VaultError::Io {
                path: path.display().to_string(),
                source: std::io::Error::new(
                    std::io::ErrorKind::AlreadyExists,
                    "could not allocate a unique temp file after 16 attempts",
                ),
            })
        }
    };
    {
        use std::io::Write;
        if let Err(e) = f.write_all(bytes).and_then(|()| f.sync_all()) {
            let e = io_at(&tmp, e);
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
    }
    drop(f);
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(io_at(path, e));
    }
    #[cfg(unix)]
    {
        if let Ok(d) = std::fs::File::open(dir) {
            let _ = d.sync_all();
        }
    }
    Ok(())
}

/// Resolve the portable data directory: the folder containing the
/// running executable. Vault, temp files and the throttle sidecar
/// all live there — nothing is written to AppData, the registry, or
/// the home directory.
pub fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn vault_path() -> PathBuf {
    exe_dir().join("vault.dat")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str) -> VaultStore {
        temp_store_with_lockout(name, 30)
    }

    fn temp_store_with_lockout(name: &str, lockout_secs: u64) -> VaultStore {
        let dir = std::env::temp_dir().join(format!(
            "aethervault-test-{}-store-{name}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("vault.dat");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(dir.join("vault.dat.bak"));
        let _ = std::fs::remove_file(dir.join("vault.throttle.json"));
        VaultStore::with_lockout(path, lockout_secs)
    }

    fn payload_with_title(title: &str) -> Value {
        serde_json::json!({
            "entries": [{"id": "1", "category": "login", "title": title, "password": "x"}],
            "settings": {"theme": "light", "zoom": 1, "autoLockMinutes": 5, "clipboardClearSeconds": 20}
        })
    }

    #[test]
    fn create_unlock_round_trip_and_short_password_rejected() {
        let store = temp_store("roundtrip");
        // Min 8 chars: 7 fails, 8 passes.
        assert!(store.create("short7!").is_err());
        let (mut session, recovery) = store
            .create("correct horse battery staple 9!")
            .expect("create");
        assert!(store.exists());
        assert_eq!(recovery.len(), 33);
        assert!(recovery.starts_with("AEV-"));
        let payload = payload_with_title("First");
        store.save(&mut session, &payload).expect("save");
        drop(session);
        let s = store
            .unlock_password("correct horse battery staple 9!")
            .expect("unlock");
        let back: Value = serde_json::from_str(&s.last_payload).expect("payload json");
        assert_eq!(back["entries"][0]["title"], "First");
    }

    #[test]
    fn weak_and_breached_master_passwords_rejected() {
        let store = temp_store("weak-pw");
        // Breached (in the common-password list) — 8 chars, but rejected.
        assert!(store.create("password").is_err());
        // Too weak: 8 chars of one class, under 36 effective bits.
        assert!(store.create("aaaaaaaa").is_err());
        // A strong passphrase still passes.
        assert!(store
            .create("correct horse battery staple 9!")
            .is_ok());
    }

    #[test]
    fn wrong_password_rejected_and_tamper_detected() {
        let store = temp_store("tamper");
        let (session, _) = store.create("correct horse battery staple 9!").expect("create");
        drop(session);
        assert!(store.unlock_password("wrong password here").is_err());
        // Flip a payload byte: AEAD tag must fail. (CorruptVault,
        // not InvalidCredentials — the credential was proven by
        // the slot unwrap, so this is corruption.)
        let mut bytes = std::fs::read(&store.path).expect("read");
        let last = bytes.len() - 1;
        bytes[last] ^= 0xFF;
        std::fs::write(&store.path, &bytes).expect("corrupt");
        let err = store.unlock_password("correct horse battery staple 9!");
        assert!(matches!(err, Err(VaultError::CorruptVault(_))));
    }

    #[test]
    fn recovery_key_unlock() {
        let store = temp_store("recovery");
        let (session, recovery) = store.create("correct horse battery staple 9!").expect("create");
        drop(session);
        let s = store.unlock_recovery(&recovery).expect("recovery unlock");
        assert!(s.unlocked_via_recovery);
        // Sloppy form (lowercase, spaces) also works.
        drop(s);
        let messy = recovery.to_lowercase().replace('-', " ");
        assert!(store.unlock_recovery(&messy).is_ok());
        // A wrong key fails.
        assert!(store.unlock_recovery("AEV-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA").is_err());
    }

    #[test]
    fn password_change_rewrap_only() {
        let store = temp_store("changepw");
        let (mut session, recovery) = store.create("correct horse battery staple 9!").expect("create");
        let payload = payload_with_title("Keep me");
        store.save(&mut session, &payload).expect("save");
        let before = std::fs::read(&store.path).expect("read before");
        store
            .change_password(&mut session, "correct horse battery staple 9!", "brand new passphrase 42!", false)
            .expect("change");
        // Payload ciphertext untouched (same tail bytes), only the
        // header slots changed — re-wrap only, no re-encrypt.
        // Ciphertext starts at offset 238 with a recovery slot
        // present (5 + 24 + 1 + 2×(32 + 24 + 48)).
        let after = std::fs::read(&store.path).expect("read after");
        assert_eq!(before[238..], after[238..]);
        drop(session);
        assert!(store.unlock_password("correct horse battery staple 9!").is_err());
        let s = store.unlock_password("brand new passphrase 42!").expect("unlock new");
        let back: Value = serde_json::from_str(&s.last_payload).expect("payload");
        assert_eq!(back["entries"][0]["title"], "Keep me");
        drop(s);
        // Recovery key still works after a password change.
        assert!(store.unlock_recovery(&recovery).is_ok());
        // via_recovery change without a recovery session is refused.
        let mut s2 = store.unlock_password("brand new passphrase 42!").expect("unlock2");
        let err = store.change_password(&mut s2, "", "another passphrase 43!", true);
        assert!(err.is_err());
    }

    #[test]
    fn regenerate_recovery_key_rotates() {
        let store = temp_store("regen");
        let (mut session, old_key) = store.create("correct horse battery staple 9!").expect("create");
        let new_key = store.rotate_recovery_key(&mut session).expect("rotate");
        assert_ne!(new_key, old_key);
        drop(session);
        assert!(store.unlock_recovery(&old_key).is_err());
        assert!(store.unlock_recovery(&new_key).is_ok());
        // Password still works too.
        assert!(store.unlock_password("correct horse battery staple 9!").is_ok());
    }

    #[test]
    fn bak_fallback_on_corrupt_primary() {
        let store = temp_store("bak");
        let (mut session, _) = store.create("correct horse battery staple 9!").expect("create");
        store.save(&mut session, &payload_with_title("First")).expect("save v1");
        let v1 = std::fs::read(&store.path).expect("read v1");
        store.save(&mut session, &payload_with_title("Second")).expect("save v2");
        assert!(store.backup_path().exists());
        assert_eq!(std::fs::read(store.backup_path()).expect("read bak"), v1);
        let mut v2 = std::fs::read(&store.path).expect("read v2");
        let last = v2.len() - 1;
        v2[last] ^= 0xFF;
        std::fs::write(&store.path, &v2).expect("corrupt primary");
        let s = store.unlock_password("correct horse battery staple 9!").expect("fallback unlock");
        let back: Value = serde_json::from_str(&s.last_payload).expect("payload");
        assert_eq!(back["entries"][0]["title"], "First");
    }

    #[test]
    fn wrong_password_against_backup_still_counts_for_throttle() {
        let store = temp_store_with_lockout("bak-throttle", 30);
        let (mut session, _) = store.create("correct horse battery staple 9!").expect("create");
        store.save(&mut session, &payload_with_title("First")).expect("save v1");
        store.save(&mut session, &payload_with_title("Second")).expect("save v2");
        assert!(store.backup_path().exists());
        // Parse-level corruption of the primary (magic byte):
        // every unlock attempt now runs against vault.dat.bak.
        let mut bytes = std::fs::read(&store.path).expect("read primary");
        bytes[0] ^= 0xFF;
        std::fs::write(&store.path, &bytes).expect("corrupt primary");
        // A wrong guess against the backup is a credential
        // verdict — it must surface as InvalidCredentials (not be
        // masked as CorruptVault) and it must be recorded.
        for _ in 0..5 {
            let err = store.unlock_password("wrong password here").expect_err("wrong pw");
            assert!(matches!(err, VaultError::InvalidCredentials), "got: {err}");
        }
        let (attempts, locked_until) = store.throttle_status();
        assert_eq!(attempts, 5);
        assert!(locked_until > now_unix());
        // Even the correct password is now refused by the throttle.
        let err = store
            .unlock_password("correct horse battery staple 9!")
            .expect_err("locked out");
        assert!(err.to_string().contains("try again in"));
    }

    #[test]
    fn atomic_write_leaves_no_stray_temps() {
        let store = temp_store("atomic");
        let (mut session, _) = store.create("correct horse battery staple 9!").expect("create");
        store.save(&mut session, &payload_with_title("T")).expect("save");
        let dir = store.path.parent().unwrap().to_path_buf();
        let strays: Vec<_> = std::fs::read_dir(&dir)
            .expect("readdir")
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map(|n| n.starts_with('.') && n.ends_with(".tmp"))
                    .unwrap_or(false)
            })
            .collect();
        assert!(strays.is_empty(), "stray temps: {strays:?}");
    }

    #[test]
    fn throttle_five_fails_lock_out_and_status_shows_it() {
        let store = temp_store_with_lockout("throttle", 30);
        let (_session, _) = store.create("correct horse battery staple 9!").expect("create");
        for _ in 0..5 {
            assert!(store.unlock_password("wrong password here").is_err());
        }
        let (attempts, locked_until) = store.throttle_status();
        assert_eq!(attempts, 5);
        assert!(locked_until > now_unix());
        // 6th attempt is refused by the throttle, not by Argon2.
        let err = store.unlock_password("correct horse battery staple 9!").expect_err("locked");
        assert!(err.to_string().contains("try again in"));
        // Sidecar file exists on disk and survives a fresh store.
        assert!(store.throttle_path().exists());
        let fresh = VaultStore::with_lockout(store.path.clone(), 30);
        let (attempts2, locked_until2) = fresh.throttle_status();
        assert_eq!(attempts2, 5);
        assert_eq!(locked_until2, locked_until);
        // Expired lockout (sidecar rewritten with a past deadline)
        // reads as unlocked with a fresh count.
        std::fs::write(
            store.throttle_path(),
            format!(
                "{{\"failed_attempts\":5,\"locked_until_unix\":{}}}",
                now_unix() - 10
            ),
        )
        .expect("write expired sidecar");
        let (attempts3, locked_until3) = fresh.throttle_status();
        assert_eq!(attempts3, 0);
        assert_eq!(locked_until3, 0);
        // And the correct password works again.
        assert!(store.unlock_password("correct horse battery staple 9!").is_ok());
        // Success reset the sidecar.
        assert!(!store.throttle_path().exists());
    }

    #[test]
    fn verify_probes_do_not_record_throttle() {
        let store = temp_store("verify");
        let (_s, recovery) = store.create("correct horse battery staple 9!").expect("create");
        assert!(store.verify_password("correct horse battery staple 9!"));
        assert!(!store.verify_password("nope nope nope"));
        assert!(store.verify_recovery(&recovery));
        assert!(!store.verify_recovery("AEV-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA"));
        assert!(!store.verify_recovery("garbage"));
        let (attempts, locked_until) = store.throttle_status();
        assert_eq!(attempts, 0);
        assert_eq!(locked_until, 0);
    }

    #[test]
    fn erase_removes_vault_backup_and_throttle() {
        let store = temp_store("erase");
        let (mut session, _) = store.create("correct horse battery staple 9!").expect("create");
        store.save(&mut session, &payload_with_title("T")).expect("save v1");
        store.save(&mut session, &payload_with_title("T2")).expect("save v2");
        assert!(store.backup_path().exists());
        store.erase();
        assert!(!store.exists());
        assert!(!store.backup_path().exists());
        assert!(!store.throttle_path().exists());
    }
}
