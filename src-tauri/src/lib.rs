//! AetherVault 1.0.7 — Tauri backend (Rust vault engine, WebView2 UI).
//!
//! The vault engine lives in `vault` (envelope, key slots, session,
//! TOTP, generator, audit, backup, clipboard, persisted throttle)
//! on top of the crypto engine in `crypto`. The frontend
//! talks to it only through the Tauri commands in `commands`.

pub mod commands;
pub mod crypto;
pub mod errors;
pub mod tray;
pub mod vault;

pub use commands::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .manage(tray::TrayState::default())
        .invoke_handler(tauri::generate_handler![
            commands::vault_exists,
            commands::create_vault,
            commands::unlock_vault,
            commands::unlock_with_recovery_key,
            commands::verify_master_password,
            commands::verify_recovery_key,
            commands::save_vault,
            commands::lock_vault,
            commands::change_password,
            commands::regenerate_recovery_key,
            commands::export_backup,
            commands::import_backup,
            commands::erase_vault,
            commands::totp_code,
            commands::generate_password,
            commands::generate_passphrase,
            commands::audit_vault,
            commands::copy_secret,
            commands::copy_persistent,
            commands::clear_clipboard,
            commands::read_clipboard,
            tray::hide_to_tray,
        ])
        // Closing the main window exits the app; the clipboard reaper
        // thread dies with the process, so a copied secret could
        // outlive the app past its TTL. Sweep the tracked secret
        // (never a persistent copy) before the window goes away.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    crate::vault::clipboard::clear_tracked_secret();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
