# Changelog

All notable changes to AetherVault are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.7] - 2026-11-14

First public release.

- Local-first offline vault: Argon2id (64 MiB, 3 iterations) +
  XChaCha20-Poly1305, one portable exe for Windows 10/11
- TOTP codes (6, 7, and 8 digits), password and passphrase generator
- Health audit: vault score, breached / weak / reused / aging checks,
  duplicate-site merge
- Encrypted backup export and import (`.aevbackup`)
- Recovery key unlock, escalating unlock lockout
  (30 s, 2 min, 10 min, 1 h)
- System tray: hide to tray, lock, quit
- Imports from Bitwarden, 1Password, and generic CSV

[1.0.7]: https://github.com/iK4w4/AetherVault/releases/tag/1.0.7
