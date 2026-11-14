//! Persisted unlock throttling.
//!
//! The state lives in a sidecar JSON file `vault.throttle.json`
//! beside `vault.dat`: `{failed_attempts, locked_until_unix}` —
//! counts + timestamps ONLY, never any secret material. Unix time
//! (not `Instant`) is used throughout so the lockout survives
//! restarts. A successful unlock resets the file; an expired
//! lockout is treated as a fresh count.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::errors::{Result, VaultError};

/// Failed unlocks before the lockout engages.
pub const MAX_FAILED_UNLOCKS: u32 = 5;
/// Default lockout length in seconds.
pub const DEFAULT_LOCKOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct ThrottleState {
    #[serde(default)]
    pub failed_attempts: u32,
    /// Unix time the lockout ends; 0 = not locked out.
    #[serde(default)]
    pub locked_until_unix: i64,
}

impl ThrottleState {
    pub fn is_locked_out(&self, now_unix: i64) -> bool {
        self.locked_until_unix > now_unix
    }

    pub fn remaining_secs(&self, now_unix: i64) -> u64 {
        if self.locked_until_unix > now_unix {
            (self.locked_until_unix - now_unix) as u64
        } else {
            0
        }
    }
}

/// Owns the sidecar file for one vault path. `lockout_secs` is a
/// constructor parameter (test seam: tests use a 1–2 s lockout
/// instead of sleeping 30 s; production always uses 30).
pub struct ThrottleStore {
    path: PathBuf,
    lockout_secs: u64,
}

impl ThrottleStore {
    pub fn with_lockout(vault_path: &Path, lockout_secs: u64) -> Self {
        Self {
            path: throttle_path(vault_path),
            lockout_secs,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Raw stored state. A missing file is a fresh state; a corrupt
    /// file is treated as fresh too (it holds no secrets, and a
    /// corrupt sidecar must never cause a lockout).
    pub fn load(&self) -> ThrottleState {
        let Ok(text) = std::fs::read_to_string(&self.path) else {
            return ThrottleState::default();
        };
        serde_json::from_str(&text).unwrap_or_default()
    }

    /// Effective state: an expired lockout reads as a fresh count,
    /// so the next unlock sees a clean slate without waiting
    /// for a write. A crafted sidecar deadline is clamped to one
    /// lockout length — a `locked_until_unix` of `i64::MAX` must
    /// not lock the owner out forever.
    pub fn effective(&self, now_unix: i64) -> ThrottleState {
        let state = self.load();
        if state.locked_until_unix != 0 && state.locked_until_unix <= now_unix {
            ThrottleState::default()
        } else if state.locked_until_unix > now_unix.saturating_add(self.lockout_secs as i64) {
            ThrottleState {
                locked_until_unix: now_unix.saturating_add(self.lockout_secs as i64),
                ..state
            }
        } else {
            state
        }
    }

    fn save(&self, state: &ThrottleState) {
        // Best-effort: a throttle write failure must never block an
        // unlock or a save. The in-memory path is unaffected.
        // Atomic temp+rename (same as vault writes) so a crash
        // mid-write can't leave a torn sidecar.
        if let Ok(text) = serde_json::to_string(state) {
            let _ = super::atomic_write(&self.path, text.as_bytes());
        }
    }

    fn remove(&self) {
        let _ = std::fs::remove_file(&self.path);
    }

    /// Refuse the attempt while locked out, with the seconds left
    /// in the message (the UI shows the wait instead of a bare
    /// failure).
    pub fn check(&self, now_unix: i64) -> Result<()> {
        let state = self.effective(now_unix);
        if state.is_locked_out(now_unix) {
            return Err(VaultError::Validation(format!(
                "Too many failed unlock attempts — try again in {} seconds.",
                state.remaining_secs(now_unix)
            )));
        }
        Ok(())
    }

    /// Record one failed unlock. At the threshold the lockout is
    /// set; further failures while locked out leave the deadline
    /// alone (no lockout extension — the deadline is fixed from
    /// the 5th failure).
    pub fn record_failure(&self, now_unix: i64) {
        let mut state = self.effective(now_unix);
        if state.is_locked_out(now_unix) {
            return;
        }
        state.failed_attempts = state.failed_attempts.saturating_add(1);
        if state.failed_attempts >= MAX_FAILED_UNLOCKS {
            state.locked_until_unix = now_unix + self.lockout_secs as i64;
        }
        self.save(&state);
    }

    /// Successful unlock: the sidecar is removed entirely.
    pub fn reset(&self) {
        self.remove();
    }
}

/// `vault.dat` → `vault.throttle.json` in the same directory.
pub fn throttle_path(vault_path: &Path) -> PathBuf {
    match vault_path.parent() {
        Some(dir) => dir.join("vault.throttle.json"),
        None => PathBuf::from("vault.throttle.json"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str, lockout_secs: u64) -> (ThrottleStore, PathBuf) {
        let dir = std::env::temp_dir()
            .join(format!("aethervault-test-{}-throttle-{name}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let vault = dir.join("vault.dat");
        (ThrottleStore::with_lockout(&vault, lockout_secs), dir)
    }

    #[test]
    fn throttle_persists_across_reloads() {
        let (store, _dir) = temp_store("persist", 30);
        store.reset();
        let now = 1_700_000_000i64;
        for _ in 0..4 {
            store.record_failure(now);
        }
        assert_eq!(store.effective(now).failed_attempts, 4);
        assert!(!store.effective(now).is_locked_out(now));
        // A fresh store object reading the same sidecar sees it.
        let reloaded = ThrottleStore::with_lockout(
            &store.path().parent().unwrap().join("vault.dat"),
            30,
        );
        assert_eq!(reloaded.effective(now).failed_attempts, 4);
        // 5th failure locks out for 30 s.
        store.record_failure(now);
        let state = reloaded.effective(now);
        assert!(state.is_locked_out(now));
        assert_eq!(state.remaining_secs(now), 30);
        assert_eq!(state.locked_until_unix, now + 30);
        // check() refuses while locked out…
        assert!(store.check(now).is_err());
        // …and passes once the deadline is past, with a fresh count.
        assert!(store.check(now + 31).is_ok());
        assert_eq!(store.effective(now + 31).failed_attempts, 0);
        // Reset removes the sidecar.
        store.reset();
        assert!(!store.path().exists());
        assert_eq!(reloaded.effective(now).failed_attempts, 0);
    }

    #[test]
    fn corrupt_sidecar_is_fresh_not_locked() {
        let (store, dir) = temp_store("corrupt", 30);
        std::fs::write(dir.join("vault.throttle.json"), "{not json").expect("write");
        assert_eq!(store.effective(1_700_000_000).failed_attempts, 0);
        assert!(store.check(1_700_000_000).is_ok());
    }
}
