# Changelog

All notable changes to AetherVault are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.13] - 2026-11-18

- Fixed the double eye icon on password fields: WebView2 draws
  its own reveal button inside password inputs, and the app's
  toggle sat next to it. The built-in one is now hidden, so each
  field shows exactly one eye
- Fixed Bitwarden CSV imports silently dropping all card and
  identity fields (number, expiry, CVV, name, email, phone,
  address, ID number) — cards and identities now import whole
- Bitwarden JSON items of unsupported types (for example SSH
  keys) are now skipped instead of becoming empty login entries
- Fixed the unlock throttle being bypassed when `vault.dat` was
  corrupt: wrong passwords tried against `vault.dat.bak` were
  never counted, so the lockout never engaged
- A second launch of the app now focuses the running window
  instead of opening a twin instance whose saves could silently
  overwrite the first instance's entries
- Changing the master password or rotating the recovery key on
  a vault whose primary file is corrupt no longer overwrites
  the good `.bak` with the corrupt bytes
- The stale-temp sweep no longer deletes temp files that a
  write in flight is about to rename into place
- Health audit: entries that share an id (possible after an
  import) no longer produce colliding issue ids or
  "Shared with ." descriptions
- The strength meter no longer reports more bits after its
  pattern penalty than the password had before it, and password
  length checks count characters the same way in the UI and the
  backend (emoji passwords included)

## [1.0.12] - 2026-11-17

- Updated the `rand` crate from 0.8 to 0.10. Randomness for keys,
  salts, nonces and the password generator now comes from the
  current release line. No behavior change.

## [1.0.11] - 2026-11-17

- Removed the dead `breachedCount` field from the health report
  end to end (Rust report, types, app state) — it was always 0
- Fixed the audit score formula in the module docs to match the code

## [1.0.10] - 2026-11-17

- Health audit no longer shows a "Breached" row: the app has no breach
  database, so the count was always 0 — the row is removed instead of
  pretending to check
- Passphrase generator now defaults to 8 words (was 6 in the vault
  default, 5 in the window), about 64 bits before the added digit
- CI now runs the Rust tests against the committed lockfile

## [1.0.9] - 2026-11-16

- Fixed 7-digit TOTP codes: the frontend parser no longer downgrades
  them to 6 digits, and the Rust test that contradicted the code is
  fixed (7 digits is supported, as the README says)
- Master-password gate now uses the same common-password list as the
  frontend strength meter (76 words, was 20)
- Import files are capped at 10 MB, matching the vault save cap
- README/SECURITY notes clarified (see below)

## [1.0.8] - 2026-11-16

- New app icon and in-app logo

## [1.0.7] - 2026-11-14

First public release.

- Local-first offline vault: Argon2id (64 MiB, 3 iterations) +
  XChaCha20-Poly1305, one portable exe for Windows 10/11
- TOTP codes (6, 7, and 8 digits), password and passphrase generator
- Health audit: vault score, weak / reused / aging checks,
  duplicate-site merge
- Encrypted backup export and import (`.aevbackup`)
- Recovery key unlock, escalating unlock lockout
  (30 s, 2 min, 10 min, 1 h)
- System tray: hide to tray, lock, quit
- Imports from Bitwarden, 1Password, and generic CSV

[1.0.13]: https://github.com/iK4w4/AetherVault/compare/1.0.12...1.0.13
[1.0.12]: https://github.com/iK4w4/AetherVault/compare/1.0.11...1.0.12
[1.0.11]: https://github.com/iK4w4/AetherVault/releases/tag/1.0.11
[1.0.10]: https://github.com/iK4w4/AetherVault/releases/tag/1.0.10
[1.0.9]: https://github.com/iK4w4/AetherVault/releases/tag/1.0.9
[1.0.8]: https://github.com/iK4w4/AetherVault/releases/tag/1.0.8
[1.0.7]: https://github.com/iK4w4/AetherVault/releases/tag/1.0.7
