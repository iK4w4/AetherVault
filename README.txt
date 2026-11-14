AetherVault — Windows app (single file, no installer)
============================================================

Run it: double-click AetherVault.exe. That's it.

What it is: a local-first, offline password manager. A Rust vault
(Argon2id + XChaCha20-Poly1305 encryption) under a neumorphic
interface. No account, no cloud, no network — fully offline.

Requirements: Windows 10 or 11, 64-bit. Uses WebView2, the browser
engine already built into Windows 11 and current Windows 10. If the
window ever opens blank, install the free "Microsoft Edge WebView2
Runtime" once and reopen the app.

First run: create a master password. Your recovery key is shown
exactly once — write it down somewhere safe. It is the only way
back in if you forget your master password.

Your vault file (vault.dat) lives next to the exe. Keep the exe in
a folder you can write to (Desktop, Documents, USB stick). Back up
vault.dat — there is no cloud copy and no password reset.

Closing the window quits the app. "Hide to Tray" in the sidebar
sends it to the real Windows system tray instead: right-click the
tray icon for Show / Lock Vault / Quit, left-click to bring the
window back. No installer.

One file, ~4.8 MB. No extra DLLs, no admin rights, no network,
no account. Fonts included.

Created by iK4w4
GitHub: github.com/iK4w4
YouTube: youtube.com/@iK4w4
