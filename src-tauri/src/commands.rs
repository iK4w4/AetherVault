//! Tauri commands — the entire backend surface the WebView2
//! frontend invokes. Every command returns `Result<T, String>`
//! with user-readable messages; no master key, DEK, or KEK ever
//! crosses into the frontend (there is no such parameter
//! anywhere). The live session is held in a
//! `Mutex<Option<Session>>` in managed state; locking drops it
//! (the `SecretBox` master key and the cached payload zeroize).

use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use tauri::State;
use zeroize::Zeroizing;

use crate::vault::{
    audit, backup, clipboard, generator, totp, vault_path, Session, VaultStore,
};

pub struct AppState {
    pub store: VaultStore,
    pub session: Mutex<Option<Session>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            store: VaultStore::new(vault_path()),
            session: Mutex::new(None),
        }
    }
}

fn lock_session<'a>(state: &'a State<'_, AppState>) -> std::sync::MutexGuard<'a, Option<Session>> {
    state.session.lock().unwrap_or_else(|e| e.into_inner())
}

fn err<T>(e: impl std::fmt::Display) -> Result<T, String> {
    Err(e.to_string())
}

#[tauri::command]
pub fn vault_exists(state: State<AppState>) -> bool {
    state.store.exists()
}

#[tauri::command]
pub fn create_vault(
    state: State<AppState>,
    password: String,
) -> Result<serde_json::Value, String> {
    // Zeroizing at the command boundary: the owned IPC String
    // would otherwise linger in freed heap after the call.
    // (Tauri hands us a String, so this narrows the window
    // rather than eliminating it.)
    let password = Zeroizing::new(password);
    let (session, recovery_key) = state.store.create(&password).map_err(|e| e.to_string())?;
    *lock_session(&state) = Some(session);
    Ok(serde_json::json!({ "recovery_key": recovery_key }))
}

fn payload_of(session: &Session) -> Result<serde_json::Value, String> {
    serde_json::from_str(&session.last_payload)
        .map_err(|e| format!("Stored payload is not valid JSON: {e}"))
}

#[tauri::command]
pub fn unlock_vault(
    state: State<AppState>,
    password: String,
) -> Result<serde_json::Value, String> {
    let password = Zeroizing::new(password);
    let session = state
        .store
        .unlock_password(&password)
        .map_err(|e| e.to_string())?;
    let payload = payload_of(&session)?;
    *lock_session(&state) = Some(session);
    Ok(payload)
}

#[tauri::command]
pub fn unlock_with_recovery_key(
    state: State<AppState>,
    key: String,
) -> Result<serde_json::Value, String> {
    let key = Zeroizing::new(key);
    let session = state
        .store
        .unlock_recovery(&key)
        .map_err(|e| e.to_string())?;
    let payload = payload_of(&session)?;
    *lock_session(&state) = Some(session);
    Ok(payload)
}

#[tauri::command]
pub fn verify_master_password(state: State<AppState>, password: String) -> bool {
    // Throttled: the unthrottled probe was a password oracle
    // that defeated the unlock lockout.
    let password = Zeroizing::new(password);
    state.store.verify_password_throttled(&password)
}

#[tauri::command]
pub fn verify_recovery_key(state: State<AppState>, key: String) -> bool {
    let key = Zeroizing::new(key);
    state.store.verify_recovery_throttled(&key)
}

#[tauri::command]
pub fn save_vault(state: State<AppState>, payload: serde_json::Value) -> Result<(), String> {
    if !payload.is_object() || !payload.get("entries").map(|e| e.is_array()).unwrap_or(false) {
        return err("Payload must be an object with an entries array.");
    }
    // Untrusted size: a bloated payload must not OOM the process
    // during encryption.
    if serde_json::to_string(&payload).map(|s| s.len()).unwrap_or(0) > 10 * 1024 * 1024 {
        return err("Payload is too large.");
    }
    let mut guard = lock_session(&state);
    let Some(session) = guard.as_mut() else {
        return err("Vault is locked.");
    };
    state
        .store
        .save(session, &payload)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lock_vault(state: State<AppState>) {
    // Dropping the session zeroizes the master key (SecretBox)
    // and the cached payload. The clipboard is swept
    // conditionally: only if it still holds the last copied
    // clearable secret (a reaper thread can't be trusted to
    // outlive the lock). Persistent copies — recovery keys —
    // are never touched here.
    *lock_session(&state) = None;
    clipboard::clear_tracked_secret();
}

#[tauri::command]
pub fn change_password(
    state: State<AppState>,
    current: String,
    new_password: String,
    via_recovery: bool,
) -> Result<(), String> {
    let current = Zeroizing::new(current);
    let new_password = Zeroizing::new(new_password);
    let mut guard = lock_session(&state);
    let Some(session) = guard.as_mut() else {
        return err("Vault is locked.");
    };
    state
        .store
        .change_password(session, &current, &new_password, via_recovery)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn regenerate_recovery_key(state: State<AppState>) -> Result<String, String> {
    let mut guard = lock_session(&state);
    let Some(session) = guard.as_mut() else {
        return err("Vault is locked.");
    };
    state
        .store
        .rotate_recovery_key(session)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_backup(state: State<AppState>, password: String) -> Result<String, String> {
    let password = Zeroizing::new(password);
    let guard = lock_session(&state);
    let Some(session) = guard.as_ref() else {
        return err("Vault is locked.");
    };
    if session.save_failed {
        return err("The last save failed, so the vault on disk is out of date. Lock and unlock the vault to re-sync before exporting.");
    }
    backup::export_backup(&session.last_payload, &password).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_backup(backup_json: String, password: String) -> Result<serde_json::Value, String> {
    let password = Zeroizing::new(password);
    let payload_str = backup::import_backup(&backup_json, &password).map_err(|e| e.to_string())?;
    serde_json::from_str(&payload_str).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn erase_vault(state: State<AppState>) {
    *lock_session(&state) = None;
    state.store.erase();
}

#[tauri::command]
pub fn totp_code(
    secret: String,
    period: u32,
    digits: u32,
    algorithm: String,
) -> Result<serde_json::Value, String> {
    let secret = Zeroizing::new(secret);
    let (code, remaining_secs) = totp::code_with_params(&secret, period, digits, &algorithm)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "code": code, "remaining_secs": remaining_secs }))
}

#[derive(Debug, Deserialize)]
pub struct GeneratePasswordOpts {
    pub length: u32,
    pub uppercase: bool,
    pub lowercase: bool,
    pub digits: bool,
    pub symbols: bool,
    pub exclude_ambiguous: bool,
}

#[tauri::command]
pub fn generate_password(opts: GeneratePasswordOpts) -> Result<serde_json::Value, String> {
    let random_opts = generator::RandomOptions {
        length: opts.length as usize,
        lowercase: opts.lowercase,
        uppercase: opts.uppercase,
        digits: opts.digits,
        symbols: opts.symbols,
        unambiguous_only: opts.exclude_ambiguous,
    };
    let password = generator::generate_random(&random_opts).map_err(|e| e.to_string())?;
    let pool = generator::random_charset_size(&random_opts) as f64;
    let entropy_bits = opts.length as f64 * pool.log2();
    Ok(serde_json::json!({ "password": password, "entropy_bits": entropy_bits }))
}

#[tauri::command]
pub fn generate_passphrase(word_count: u32) -> Result<serde_json::Value, String> {
    let opts = generator::PassphraseOptions {
        words: word_count as usize,
        ..Default::default()
    };
    let passphrase = generator::generate_passphrase(&opts).map_err(|e| e.to_string())?;
    let entropy_bits = generator::passphrase_entropy_bits(&opts);
    Ok(serde_json::json!({ "passphrase": passphrase, "entropy_bits": entropy_bits }))
}

#[tauri::command]
pub fn audit_vault(entries: Vec<serde_json::Value>) -> serde_json::Value {
    audit::audit_vault(&entries)
}

#[tauri::command]
pub fn copy_secret(text: String, ttl_secs: u64) -> Result<(), String> {
    let text = Zeroizing::new(text);
    let ttl = if ttl_secs == 0 { 20 } else { ttl_secs };
    clipboard::copy_secret(&text, Duration::from_secs(ttl)).map_err(|e| e.to_string())
}

/// Persistent copy for the master password and the recovery key ONLY
/// (no TTL, no lock/exit sweep, stays in Windows clipboard history
/// until something else is copied). Never call for entry data.
#[tauri::command]
pub fn copy_persistent(text: String) -> Result<(), String> {
    let text = Zeroizing::new(text);
    clipboard::copy_persistent(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_clipboard() {
    clipboard::clear_clipboard();
}

/// Read the current clipboard text — backs the context menu's
/// Paste action. Reads only; never tracks, never clears.
#[tauri::command]
pub fn read_clipboard() -> Result<String, String> {
    clipboard::read_clipboard_text().map_err(|e| e.to_string())
}
