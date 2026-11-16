# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for a security vulnerability.

Report it privately through the Telegram bot:
[@AskKawaBot](https://t.me/AskKawaBot)

Include what you found, how to reproduce it, and which version you
used. You should get a reply within a few days. Please give a
reasonable amount of time for a fix before disclosing publicly.

## Supported versions

Only the latest release is supported. Fixes are not backported to
older versions.

## Verifying the release download

Download `AetherVault.exe` only from this repository's
[releases](https://github.com/iK4w4/AetherVault/releases). Check
the file against the fingerprint below before running it.

Release 1.0.9:

- Size: 5,219,840 bytes
- SHA-256: `461f077fd7001d0b12416a3e9459bfc85793d0b50216ee86d81e7aea55df711c`

Release 1.0.8:

- Size: 5,219,328 bytes
- SHA-256: `8d4e1aaf3b8c62a7cdfc344860b692680a082df307d43886366d96133a68a941`

Release 1.0.7:

- Size: 5,204,992 bytes
- SHA-256: `e8c16fa4e5c762f57e9580db04aad4380f52bf6488789453806cde9d9663cf97`

On Windows, in PowerShell:

```powershell
Get-FileHash .\AetherVault.exe -Algorithm SHA256
```

## Scope notes

AetherVault is fully offline: it makes no network connections and
collects no telemetry. Your vault file (`vault.dat`) never leaves
your device. Anyone with your master password (or your recovery
key) and a copy of `vault.dat` can open your vault — protect both.
