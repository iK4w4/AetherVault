//! Ephemeral clipboard with a self-clearing daemon — and
//! persistent copies that never clear.
//!
//! Two classes of copy:
//!
//! * Clearable secrets (`copy_secret`): entry passwords,
//!   usernames, TOTP codes, generated passwords. Written
//!   excluded from Windows clipboard history + cloud sync,
//!   tracked in `LAST_SECRET`, and swept after the TTL by a
//!   reaper thread — and immediately on lock/exit by
//!   `clear_tracked_secret`. The reaper clears only if the
//!   clipboard still holds exactly that secret, so a
//!   clipboard that now holds something else is never wiped.
//! * Persistent copies (`copy_persistent`): the master
//!   password and the recovery key ONLY. No reaper, no
//!   tracking, no lock/exit sweep — and written WITHOUT the
//!   history/cloud exclusion, so they stay in Windows
//!   clipboard history until something else is copied.
//!   They can still be cleared deliberately via the
//!   unconditional `clear_clipboard` command.
//!
//! The reaper thread dies with the process, so the last
//! copied clearable secret is also tracked in `LAST_SECRET`:
//! `clear_tracked_secret` (called on lock and on the main
//! window's close event, see `lib.rs`) clears the clipboard
//! immediately when it still holds exactly that secret,
//! instead of relying on the TTL thread. Persistent copies
//! are never tracked, so the lock/exit sweep cannot touch
//! them.
//!
//! The comparison buffer is zeroized after the check.

use std::sync::Mutex;
use std::time::Duration;
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

use crate::errors::{Result, VaultError};

/// Constant-time byte equality, via `subtle`.
/// The reaper and lock/exit sweeps compare with `ct_eq`, not
/// `==`: `==` short-circuits on the first differing byte and
/// leaks (via timing) how much of the secret the clipboard still
/// holds. `ct_eq` touches every byte of the longer input's
/// length class — the only leak left is the length itself, which
/// is not a secret the comparison is guarding here.
fn clipboard_eq(a: &[u8], b: &[u8]) -> bool {
    a.ct_eq(b).into()
}

/// The most recent CLEARABLE secret handed to the clipboard,
/// kept so lock/exit can clear it even though the reaper
/// thread won't survive them. Persistent copies are never
/// stored here.
static LAST_SECRET: Mutex<Option<Zeroizing<String>>> = Mutex::new(None);

/// Generation counter for the reaper. Every copy bumps it;
/// a reaper only clears when its own generation is still
/// current. Without it, copy A, copy B, copy A again let the
/// FIRST A's reaper wipe the second A's clipboard early
/// (same value, unexpired TTL).
static LAST_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Test seam: production talks to the OS clipboard; tests
/// use an in-memory clipboard.
#[cfg(test)]
static TEST_CLIPBOARD: Mutex<Option<String>> = Mutex::new(None);

/// Plain write — visible in Windows clipboard history.
/// Production no longer calls it directly (clearable copies use
/// `clip_set_excluding`, persistent copies use `clip_set_no_cloud`);
/// the test seams still share it, so the dead-code lint is
/// silenced in production builds.
#[cfg_attr(not(test), allow(dead_code))]
fn clip_set(text: &str) -> Result<()> {
    #[cfg(test)]
    {
        *TEST_CLIPBOARD.lock().unwrap() = Some(text.to_string());
        Ok(())
    }
    #[cfg(not(test))]
    {
        let mut cb = arboard::Clipboard::new().map_err(|e| VaultError::Clipboard(e.to_string()))?;
        cb.set_text(text.to_string())
            .map_err(|e| VaultError::Clipboard(e.to_string()))?;
        Ok(())
    }
}

/// Write excluding the text from Windows clipboard history
/// + cloud sync (clearable secrets only).
fn clip_set_excluding(text: &str) -> Result<()> {
    #[cfg(test)]
    {
        // The exclusion is a Windows-side flag; the bytes
        // are identical, so tests share the plain write.
        clip_set(text)
    }
    #[cfg(not(test))]
    {
        let mut cb = arboard::Clipboard::new().map_err(|e| VaultError::Clipboard(e.to_string()))?;
        set_text_excluding(&mut cb, text)
    }
}

/// Write excluding the text from cloud sync but NOT from
/// history (persistent copies only: the requirement is that
/// the recovery key stays in Win+V history, not that it syncs
/// to the user's Microsoft account).
fn clip_set_no_cloud(text: &str) -> Result<()> {
    #[cfg(test)]
    {
        clip_set(text)
    }
    #[cfg(not(test))]
    {
        let mut cb = arboard::Clipboard::new().map_err(|e| VaultError::Clipboard(e.to_string()))?;
        set_text_no_cloud(&mut cb, text)
    }
}

fn clip_get() -> Option<String> {
    #[cfg(test)]
    {
        TEST_CLIPBOARD.lock().unwrap().clone()
    }
    #[cfg(not(test))]
    {
        arboard::Clipboard::new().ok()?.get_text().ok()
    }
}

fn clip_clear() {
    #[cfg(test)]
    {
        *TEST_CLIPBOARD.lock().unwrap() = None;
    }
    #[cfg(not(test))]
    {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            let _ = cb.clear();
        }
    }
}

/// Windows-only exclusion writer. Unused in test builds (the test
/// seam shares the plain write), so the dead-code lint is silenced
/// there; production calls it from `clip_set_excluding`.
#[cfg_attr(test, allow(dead_code))]
fn set_text_excluding(cb: &mut arboard::Clipboard, text: &str) -> Result<()> {
    #[cfg(windows)]
    {
        use arboard::SetExtWindows;
        cb.set()
            .exclude_from_history()
            .exclude_from_cloud()
            .text(text)
            .map_err(|e| VaultError::Clipboard(e.to_string()))?;
    }
    #[cfg(not(windows))]
    {
        cb.set_text(text.to_string())
            .map_err(|e| VaultError::Clipboard(e.to_string()))?;
    }
    Ok(())
}

/// Windows-only cloud-exclusion writer (history kept).
/// Production calls it from `clip_set_no_cloud`.
#[cfg_attr(test, allow(dead_code))]
fn set_text_no_cloud(cb: &mut arboard::Clipboard, text: &str) -> Result<()> {
    #[cfg(windows)]
    {
        use arboard::SetExtWindows;
        cb.set()
            .exclude_from_cloud()
            .text(text)
            .map_err(|e| VaultError::Clipboard(e.to_string()))?;
    }
    #[cfg(not(windows))]
    {
        cb.set_text(text.to_string())
            .map_err(|e| VaultError::Clipboard(e.to_string()))?;
    }
    Ok(())
}

/// Read the current clipboard text — backs the context menu's
/// Paste action. Reads only; never tracks, never clears.
pub fn read_clipboard_text() -> Result<String> {
    clip_get().ok_or_else(|| VaultError::Clipboard("Clipboard is empty or unavailable".to_string()))
}

/// Clearable secret: TTL reaper + lock/exit tracking (see the
/// module docs). The TTL is unchanged (settings
/// `clipboard_clear_seconds`, default 20 s).
pub fn copy_secret(secret: &str, clear_after: Duration) -> Result<()> {
    // Bump the generation BEFORE touching the clipboard,
    // so an older reaper firing mid-copy sees a stale
    // generation and stands down instead of wiping the secret
    // being copied (the A, B, A case).
    let gen = LAST_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    // The reaper is spawned BEFORE the clipboard is
    // written: spawning after the write (with `?`) would leave
    // the secret on the clipboard with no TTL clear if the
    // spawn failed. Spawning early is safe: the thread sleeps
    // the whole TTL before it reads anything, and it only
    // clears if the clipboard still holds exactly this secret
    // — a failed write is a no-op for it.
    if !clear_after.is_zero() {
        let expected = Zeroizing::new(secret.to_string());
        std::thread::Builder::new()
            .name("aethervault-clipboard-reaper".to_string())
            .spawn(move || {
                std::thread::sleep(clear_after);
                // A superseded reaper clears nothing —
                // not the clipboard, not the tracking. Only
                // the current generation may sweep.
                if LAST_GEN.load(std::sync::atomic::Ordering::SeqCst) != gen {
                    return;
                }
                if let Some(current) = clip_get() {
                    if clipboard_eq(current.as_bytes(), expected.as_bytes()) {
                        clip_clear();
                    }
                }
                // The TTL fired; the tracked-secret duty moves on.
                if let Ok(mut last) = LAST_SECRET.lock() {
                    let matches = last
                        .as_deref()
                        .map(|t| clipboard_eq(t.as_bytes(), expected.as_bytes()))
                        .unwrap_or(false);
                    if matches {
                        *last = None;
                    }
                }
                // `expected` zeroizes on drop.
            })
            .map_err(|e| VaultError::Clipboard(e.to_string()))?;
    }
    clip_set_excluding(secret)?;

    if let Ok(mut last) = LAST_SECRET.lock() {
        *last = Some(Zeroizing::new(secret.to_string()));
    }

    Ok(())
}

/// Persistent copy — master password and recovery key ONLY.
/// No reaper, no tracking, no lock/exit sweep, and written
/// WITHOUT the history exclusion so the copy stays in
/// Windows clipboard history until something else is copied.
/// Cloud sync IS excluded: history is the requirement, and a
/// recovery key must not leave the machine via the user's
/// Microsoft account. Never call this for entry data.
pub fn copy_persistent(secret: &str) -> Result<()> {
    // Bump the generation so any pending clearable-secret reaper
    // stands down, and drop tracking: this copy replaces the
    // clipboard content, so the lock/exit sweep finds nothing of
    // the previous secret to remove.
    LAST_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    clip_set_no_cloud(secret)?;
    if let Ok(mut last) = LAST_SECRET.lock() {
        *last = None;
    }
    Ok(())
}

/// Clear the clipboard outright (the `clear_clipboard` command):
/// bump the generation counter so any live reaper stands down,
/// drop lock/exit tracking, and clear. This is the explicit
/// "Clear now" action — it clears persistent copies too.
pub fn clear_clipboard() {
    LAST_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    if let Ok(mut last) = LAST_SECRET.lock() {
        *last = None;
    }
    clip_clear();
}

/// Clear the clipboard NOW if it still holds exactly the last copied
/// CLEARABLE secret. Called on lock and on the main window's close
/// event — the reaper thread cannot be trusted to outlive either.
/// Never touches a clipboard that holds something else, and never
/// touches a persistent copy (those are never tracked).
///
/// The tracked secret is taken from `LAST_SECRET` only after
/// a successful read-and-clear: taking it first would drop
/// tracking on a clipboard read failure (no clipboard, locked
/// clipboard) while the secret stayed on the clipboard with no
/// cleanup path left. On failure the tracking is left in place
/// for the next sweep; a poisoned mutex is recovered via
/// `into_inner()`.
pub fn clear_tracked_secret() {
    // Clone the tracked value under the lock, then release it
    // BEFORE doing clipboard I/O: `clip_get` can block for
    // seconds if another app holds the clipboard, and holding
    // the lock across it stalls every copy/clear.
    let tracked: Option<Zeroizing<String>> = {
        let guard = LAST_SECRET.lock().unwrap_or_else(|e| e.into_inner());
        guard.clone()
    };
    let Some(tracked) = tracked else {
        return;
    };
    // Read the clipboard and clear it iff it still holds the secret.
    // `None` = the read (or the clear) failed: keep tracking.
    let outcome: Option<bool> = (|| {
        let current = clip_get()?;
        if clipboard_eq(current.as_bytes(), tracked.as_bytes()) {
            clip_clear();
            Some(true)
        } else {
            // Secret is no longer on the clipboard; nothing to clear.
            Some(false)
        }
    })();
    if outcome.is_some() {
        if let Ok(mut last) = LAST_SECRET.lock() {
            // Compare-and-take: a newer secret copied while this
            // sweep was doing clipboard I/O must stay tracked, or
            // it would never be swept on lock/exit.
            let still_same = last
                .as_ref()
                .map(|cur| clipboard_eq(cur.as_bytes(), tracked.as_bytes()))
                .unwrap_or(false);
            if still_same {
                last.take();
            }
        }
    }
    // `tracked` (a Zeroizing<String>) wipes on drop when taken; when
    // the outcome was a failure it stays tracked under the guard.
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// Clipboard tests share one process-global clipboard and
    /// one tracking slot: serialize them, or a parallel test's
    /// copy lands mid-assertion. The guard is held across the
    /// sleeps; a stale reaper from an earlier test is harmless
    /// — its generation is stale by then, so it stands down
    /// before touching anything.
    fn lock_tests() -> std::sync::MutexGuard<'static, ()> {
        static SERIAL: Mutex<()> = Mutex::new(());
        SERIAL.lock().unwrap()
    }

    fn reset() {
        *TEST_CLIPBOARD.lock().unwrap() = None;
        if let Ok(mut last) = LAST_SECRET.lock() {
            *last = None;
        }
    }

    fn clip_now() -> Option<String> {
        TEST_CLIPBOARD.lock().unwrap().clone()
    }

    #[test]
    fn clipboard_eq_matches_and_mismatches() {
        assert!(clipboard_eq(b"correct-horse", b"correct-horse"));
        assert!(clipboard_eq(b"", b""));
        assert!(!clipboard_eq(b"correct-horse", b"correct-horsf"));
        // Last-byte difference must still be caught (no early
        // exit that only checks a prefix).
        assert!(!clipboard_eq(b"aaaaaaaaaaaaaaaa", b"aaaaaaaaaaaaaaab"));
        assert!(!clipboard_eq(b"short", b"shorter"));
        assert!(!clipboard_eq(b"shorter", b"short"));
    }

    #[test]
    fn read_clipboard_text_round_trips_and_errors_when_empty() {
        let _g = lock_tests();
        reset();
        assert!(read_clipboard_text().is_err());
        copy_persistent("read-me-back").unwrap();
        assert_eq!(read_clipboard_text().unwrap(), "read-me-back");
        reset();
    }

    #[test]
    fn persistent_copy_survives_ttl_and_lock() {
        let _g = lock_tests();
        reset();
        copy_persistent("persist-placeholder").unwrap();
        assert_eq!(clip_now().as_deref(), Some("persist-placeholder"));
        // Longer than any TTL in play: no reaper exists for it.
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!(clip_now().as_deref(), Some("persist-placeholder"));
        // The lock/exit sweep must not touch it either.
        clear_tracked_secret();
        assert_eq!(clip_now().as_deref(), Some("persist-placeholder"));
    }

    #[test]
    fn clearable_copy_clears_after_ttl() {
        let _g = lock_tests();
        reset();
        copy_secret("clear-placeholder", Duration::from_millis(30)).unwrap();
        assert_eq!(clip_now().as_deref(), Some("clear-placeholder"));
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(clip_now(), None);
    }

    #[test]
    fn reaper_leaves_replaced_clipboard_alone() {
        let _g = lock_tests();
        reset();
        copy_secret("orig-placeholder", Duration::from_millis(30)).unwrap();
        // A superseding copy (fresh generation + tracking) must
        // protect the replacement from the first reaper.
        copy_secret("replacement-placeholder", Duration::from_secs(60)).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(clip_now().as_deref(), Some("replacement-placeholder"));
    }

    #[test]
    fn persistent_copy_supersedes_tracked_secret() {
        let _g = lock_tests();
        reset();
        copy_secret("clear-placeholder", Duration::from_millis(30)).unwrap();
        copy_persistent("persist-placeholder").unwrap();
        assert_eq!(clip_now().as_deref(), Some("persist-placeholder"));
        std::thread::sleep(Duration::from_millis(200));
        // The first copy's reaper stood down (stale generation)
        // and the lock sweep finds nothing tracked.
        assert_eq!(clip_now().as_deref(), Some("persist-placeholder"));
        clear_tracked_secret();
        assert_eq!(clip_now().as_deref(), Some("persist-placeholder"));
    }

    #[test]
    fn clearable_copy_clears_on_lock() {
        let _g = lock_tests();
        reset();
        copy_secret("clear-placeholder", Duration::from_secs(60)).unwrap();
        clear_tracked_secret();
        assert_eq!(clip_now(), None);
    }

    #[test]
    fn clear_clipboard_is_unconditional() {
        let _g = lock_tests();
        reset();
        copy_persistent("persist-placeholder").unwrap();
        clear_clipboard();
        assert_eq!(clip_now(), None);
    }
}
