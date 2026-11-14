//! Exhaustive error type for the whole crate. Every fallible operation in
//! AetherVault returns `Result<T, VaultError>` — no panics, no silent drops.

use std::fmt;

#[derive(Debug)]
pub enum VaultError {
    /// File / IO failure (path included, never any secret material).
    Io {
        path: String,
        source: std::io::Error,
    },
    /// Vault file is missing.
    VaultNotFound(String),
    /// Vault file exists but is not a valid AetherVault envelope.
    CorruptVault(String),
    /// Wrong master password or wrong recovery key (AEAD tag mismatch).
    /// Deliberately indistinguishable — no oracle.
    InvalidCredentials,
    /// AEAD encryption failed.
    EncryptionFailed,
    /// AEAD decryption failed for a reason other than credentials.
    /// Kept separate internally: key-slot failures surface as
    /// InvalidCredentials (the real password check), while
    /// payload failures after a proven credential surface as
    /// CorruptVault — never "incorrect password" for a
    /// corrupt file.
    DecryptionFailed,
    /// Argon2id key derivation failed / invalid parameters.
    KdfFailed(String),
    /// JSON (de)serialization of the vault payload failed.
    Serialization(String),
    /// TOTP secret could not be parsed (bad base32 / bad otpauth URI).
    InvalidTotpSecret(String),
    /// Clipboard unavailable or rejected the write.
    Clipboard(String),
    /// A user-facing validation problem (empty title, mismatched
    /// confirmation password, weak master password, …).
    Validation(String),
}

pub type Result<T> = std::result::Result<T, VaultError>;

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VaultError::Io { path, source } => write!(f, "I/O error at {path}: {source}"),
            VaultError::VaultNotFound(p) => write!(f, "No vault file found at {p}"),
            VaultError::CorruptVault(why) => write!(f, "Vault file is corrupt: {why}"),
            VaultError::InvalidCredentials => {
                write!(f, "Incorrect master password or recovery key.")
            }
            VaultError::EncryptionFailed => write!(f, "Encryption failed."),
            VaultError::DecryptionFailed => write!(f, "Decryption failed."),
            VaultError::KdfFailed(why) => write!(f, "Key derivation failed: {why}"),
            VaultError::Serialization(why) => write!(f, "Serialization failed: {why}"),
            VaultError::InvalidTotpSecret(why) => write!(f, "Invalid TOTP secret: {why}"),
            VaultError::Clipboard(why) => write!(f, "Clipboard: {why}"),
            VaultError::Validation(why) => write!(f, "{why}"),
        }
    }
}

impl std::error::Error for VaultError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            VaultError::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

impl From<std::io::Error> for VaultError {
    fn from(source: std::io::Error) -> Self {
        VaultError::Io {
            path: "<unknown io>".to_string(),
            source,
        }
    }
}

impl From<serde_json::Error> for VaultError {
    fn from(e: serde_json::Error) -> Self {
        VaultError::Serialization(e.to_string())
    }
}

/// Convenience: build an `Io` error that carries the path it happened on.
pub fn io_at(path: &std::path::Path, source: std::io::Error) -> VaultError {
    VaultError::Io {
        path: path.display().to_string(),
        source,
    }
}
