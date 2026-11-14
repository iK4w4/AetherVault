# Third-party components

AetherVault's own files are MIT (see [LICENSE](LICENSE)). The
components below keep their own licenses.

## Fonts (bundled in `public/fonts/`)

- **Plus Jakarta Sans** (variable, `PlusJakartaSans-var.woff2`) —
  Copyright The Plus Jakarta Sans Project Authors —
  SIL Open Font License 1.1.
- **JetBrains Mono** (variable, `JetBrainsMono-var.woff2`) —
  Copyright The JetBrains Mono Project Authors —
  SIL Open Font License 1.1.

## Libraries

- Rust crates are listed in `src-tauri/Cargo.toml` and pinned in
  `src-tauri/Cargo.lock` (Tauri, argon2, chacha20poly1305,
  totp-rs, zeroize, and their dependencies — each under its own
  MIT / Apache-2.0 / BSD-style license).
- npm packages are listed in `package.json` and pinned in
  `package-lock.json` (React, Vite, Tailwind CSS, lucide-react
  icons — MIT / ISC).
