//! Real Windows system-tray support for AetherVault 1.0.7.
//!
//! The tray icon is built once (lazily, on the first "Hide to Tray") and
//! kept in managed state. Hiding shows the icon and hides the window;
//! restoring hides the icon again and shows the window. Menu: Show /
//! Lock Vault / Quit. Left-clicking the tray icon restores the window;
//! right-click opens the menu.

use std::sync::Mutex;

use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};

pub const TRAY_ID: &str = "aethervault-tray";
const EVENT_TRAY_LOCK: &str = "aethervault://tray-lock";

/// Holds the tray icon once built, so hide/restore can toggle its visibility.
#[derive(Default)]
pub struct TrayState(pub Mutex<Option<TrayIcon<Wry>>>);

fn tray_icon(app: &AppHandle) -> Image<'_> {
    if let Some(icon) = app.default_window_icon() {
        return icon.clone();
    }
    Image::from_bytes(include_bytes!("../icons/icon.png"))
        .expect("bundled tray icon is a valid image")
}

fn restore(app: &AppHandle) {
    let state = app.state::<TrayState>();
    if let Ok(guard) = state.0.lock() {
        if let Some(tray) = guard.as_ref() {
            let _ = tray.set_visible(false);
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Build the tray icon (first hide only), show it, and hide the main window.
pub fn hide_window_to_tray(app: &AppHandle) -> Result<(), String> {
    {
        let state = app.state::<TrayState>();
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            let show = MenuItemBuilder::with_id("show", "Show AetherVault")
                .build(app)
                .map_err(|e| e.to_string())?;
            let lock = MenuItemBuilder::with_id("lock", "Lock Vault")
                .build(app)
                .map_err(|e| e.to_string())?;
            let quit = MenuItemBuilder::with_id("quit", "Quit")
                .build(app)
                .map_err(|e| e.to_string())?;
            let menu = MenuBuilder::new(app)
                .items(&[&show, &lock])
                .separator()
                .items(&[&quit])
                .build()
                .map_err(|e| e.to_string())?;
            let tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(tray_icon(app))
                .tooltip("AetherVault — click to restore")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => restore(app),
                    "lock" => {
                        let _ = app.emit(EVENT_TRAY_LOCK, ());
                        restore(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        restore(tray.app_handle());
                    }
                })
                .build(app)
                .map_err(|e| e.to_string())?;
            *guard = Some(tray);
        }
        if let Some(tray) = guard.as_ref() {
            tray.set_visible(true).map_err(|e| e.to_string())?;
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Tauri command invoked by the frontend "Hide to Tray" button.
#[tauri::command]
pub fn hide_to_tray(app: AppHandle) -> Result<(), String> {
    hide_window_to_tray(&app)
}
