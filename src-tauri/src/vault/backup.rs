//! Encrypted JSON backup.
//!
//! Format:
//!
//! ```json
//! {"app": "AetherVault", "format": "aev-backup-v1",
//!  "exportedAt": "<ISO-8601 UTC>", "salt": "<base64 32B>",
//!  "iv": "<base64 24B nonce>", "ciphertext": "<base64>"}
//! ```
//!
//! Primitives: Argon2id (64 MiB/3/4) KDF
//! over the backup password + fresh 32-byte salt, XChaCha20-Poly1305
//! with AAD `aethervault-export-v1` over the plaintext payload JSON.
//! The payload is the frontend's `VaultPayload` JSON (opaque here),
//! validated on import to be an object with an `entries` array.
//! No canary field is stored in the payload — the AEAD tag is the
//! integrity check; a wrong password and a corrupt file are
//! cryptographically indistinguishable, so both report the same
//! message: "Incorrect backup password or corrupted backup file."

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::crypto;
use crate::errors::{Result, VaultError};

pub const BACKUP_APP: &str = "AetherVault";
pub const BACKUP_FORMAT: &str = "aev-backup-v1";
const EXPORT_AAD: &[u8] = b"aethervault-export-v1";

#[derive(Serialize, Deserialize)]
struct BackupDoc {
    app: String,
    format: String,
    #[serde(rename = "exportedAt")]
    exported_at: String,
    salt: String,
    iv: String,
    ciphertext: String,
}

/// ISO-8601 UTC timestamp (`2023-11-14T22:13:20Z`) from unix
/// seconds. Hand-rolled civil-from-days (Howard Hinnant's
/// algorithm) — no `chrono` in the dep tree.
pub fn iso8601_utc(unix_secs: i64) -> String {
    let days = unix_secs.div_euclid(86_400);
    let secs = unix_secs.rem_euclid(86_400);
    let (h, m, s) = (secs / 3600, (secs % 3600) / 60, secs % 60);
    // Civil from days, epoch 1970-01-01.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let yr = if mo <= 2 { y + 1 } else { y };
    format!("{yr:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/// Encrypt the plaintext payload JSON under the backup password.
/// Returns the backup document as a JSON string.
pub fn export_backup(payload_json: &str, password: &str) -> Result<String> {
    // Same gate as the master password: 8-character floor, no
    // breached passwords, minimum strength score. The backup file
    // is self-contained and attacked offline at Argon2id speed, so
    // a common password the vault would reject must not protect it.
    if password.chars().count() < 8 {
        return Err(VaultError::Validation(
            "Backup password must be at least 8 characters.".into(),
        ));
    }
    let eval = crate::crypto::evaluate_strength(password);
    if eval.breached {
        return Err(VaultError::Validation(
            "That backup password is in a list of commonly breached passwords — pick a different one.".into(),
        ));
    }
    if eval.score < 2 {
        return Err(VaultError::Validation(
            "That backup password is too weak — use a longer password with mixed letters, numbers, and symbols.".into(),
        ));
    }
    let salt = crypto::random_bytes::<{ crypto::SALT_LEN }>();
    let kek = crypto::derive_kek(password, &salt)?;
    let json = Zeroizing::new(payload_json.as_bytes().to_vec());
    let (nonce, ct) = crypto::encrypt(&kek, &json, EXPORT_AAD)?;
    let doc = BackupDoc {
        app: BACKUP_APP.to_string(),
        format: BACKUP_FORMAT.to_string(),
        exported_at: iso8601_utc(crate::vault::now_unix()),
        salt: STANDARD.encode(salt),
        iv: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ct),
    };
    serde_json::to_string_pretty(&doc).map_err(|e| VaultError::Serialization(e.to_string()))
}

/// Decrypt a backup document and return the payload JSON string.
/// Validates `app`/`format` and that the payload is an object with
/// an `entries` array. Wrong password and corrupt file share one
/// message (they are indistinguishable at the AEAD layer).
pub fn import_backup(backup_json: &str, password: &str) -> Result<String> {
    let wrong_or_corrupt = || {
        VaultError::Validation(
            "Incorrect backup password or corrupted backup file.".into(),
        )
    };
    // Untrusted input: cap the sizes before any parse/decode/
    // decrypt allocates, or a pasted multi-hundred-MB backup
    // OOMs the process.
    const MAX_BACKUP_BYTES: usize = 10 * 1024 * 1024;
    if backup_json.len() > MAX_BACKUP_BYTES {
        return Err(wrong_or_corrupt());
    }
    let doc: BackupDoc = serde_json::from_str(backup_json).map_err(|_| wrong_or_corrupt())?;
    if doc.app != BACKUP_APP || doc.format != BACKUP_FORMAT {
        return Err(wrong_or_corrupt());
    }
    let salt_b = STANDARD.decode(&doc.salt).map_err(|_| wrong_or_corrupt())?;
    let nonce_b = STANDARD.decode(&doc.iv).map_err(|_| wrong_or_corrupt())?;
    let ct = STANDARD
        .decode(&doc.ciphertext)
        .map_err(|_| wrong_or_corrupt())?;
    if ct.len() > MAX_BACKUP_BYTES {
        return Err(wrong_or_corrupt());
    }
    if salt_b.len() != crypto::SALT_LEN || nonce_b.len() != crypto::NONCE_LEN {
        return Err(wrong_or_corrupt());
    }
    let mut salt = [0u8; crypto::SALT_LEN];
    salt.copy_from_slice(&salt_b);
    let mut nonce = [0u8; crypto::NONCE_LEN];
    nonce.copy_from_slice(&nonce_b);
    let kek = crypto::derive_kek(password, &salt).map_err(|_| wrong_or_corrupt())?;
    let pt = crypto::decrypt(&kek, &nonce, &ct, EXPORT_AAD).map_err(|_| wrong_or_corrupt())?;
    let payload: serde_json::Value =
        serde_json::from_slice(&pt).map_err(|_| wrong_or_corrupt())?;
    if !payload.is_object() || !payload.get("entries").map(|e| e.is_array()).unwrap_or(false) {
        return Err(wrong_or_corrupt());
    }
    serde_json::to_string(&payload).map_err(|_| wrong_or_corrupt())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso8601_known_dates() {
        assert_eq!(iso8601_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601_utc(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(iso8601_utc(1_791_000_000), "2026-10-03T04:00:00Z");
    }

    #[test]
    fn backup_round_trip_and_wrong_password() {
        let payload = r#"{"entries":[{"id":"1","category":"login","title":"Example","password":"hunter2-but-better-99!"}],"settings":{"theme":"light","zoom":1,"autoLockMinutes":5,"clipboardClearSeconds":20}}"#;
        let doc = export_backup(payload, "export passphrase 42!").expect("export");
        assert!(!doc.contains("hunter2"));
        let parsed: serde_json::Value = serde_json::from_str(&doc).expect("doc json");
        assert_eq!(parsed["app"], "AetherVault");
        assert_eq!(parsed["format"], "aev-backup-v1");
        assert!(parsed["exportedAt"].as_str().unwrap().ends_with('Z'));
        let back = import_backup(&doc, "export passphrase 42!").expect("import");
        let back_v: serde_json::Value = serde_json::from_str(&back).expect("payload json");
        assert_eq!(back_v["entries"][0]["password"], "hunter2-but-better-99!");
        // Wrong password / corrupt file share one message.
        let err = import_backup(&doc, "wrong export passphrase").expect_err("wrong pw");
        assert_eq!(
            err.to_string(),
            "Incorrect backup password or corrupted backup file."
        );
        let err2 = import_backup("{\"app\":\"Other\"}", "export passphrase 42!").expect_err("bad doc");
        assert_eq!(
            err2.to_string(),
            "Incorrect backup password or corrupted backup file."
        );
        // Payload without an entries array is rejected.
        let bad_payload = export_backup(r#"{"nope":true}"#, "export passphrase 42!").expect("export bad");
        assert!(import_backup(&bad_payload, "export passphrase 42!").is_err());
    }
}
