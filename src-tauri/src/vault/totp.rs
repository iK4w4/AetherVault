//! RFC 6238 TOTP engine, backed by `totp-rs`.
//!
//! Accepts either a bare base32 secret or a full `otpauth://totp/...`
//! URI (as scanned from a QR code elsewhere and pasted in). Codes are
//! generated locally, on demand, per frame — the secret never leaves
//! the encrypted vault. All codes are produced by `code_with_params`
//! (the `totp_code` command); the frontend validates secret shape
//! with its own `isValidTotpSecret` before saving.

use totp_rs::{Algorithm, Secret, TOTP};

use crate::errors::{Result, VaultError};

/// TOTP validity period in seconds (RFC default).
pub const TOTP_PERIOD: u64 = 30;

/// Seconds remaining in the current window of `period`.
pub fn seconds_remaining_in(now_unix: u64, period: u64) -> u64 {
    let period = period.max(1);
    period - (now_unix % period)
}

/// Clamp helpers shared by the `totp_code` command: period
/// outside 5–300 s falls back to 30 s; digits are 8 or
/// (anything else) 6.
pub fn clamp_period(period: u32) -> u64 {
    if (5..=300).contains(&period) {
        period as u64
    } else {
        TOTP_PERIOD
    }
}

pub fn clamp_digits(digits: u32) -> usize {
    if digits == 8 {
        8
    } else {
        6
    }
}

pub fn parse_algorithm(raw: &str) -> Algorithm {
    let upper: String = raw
        .to_uppercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    match upper.as_str() {
        "SHA256" => Algorithm::SHA256,
        "SHA512" => Algorithm::SHA512,
        _ => Algorithm::SHA1,
    }
}

/// Generate the current code for a secret that may be a bare base32
/// string or a full `otpauth://totp/...` URI, with explicit
/// period/digits/algorithm from the caller.
///
/// Precedence: parameters present in the URI win (clamped);
/// parameters absent from the URI fall back to the caller's
/// values (clamped the same way); a bare secret always uses the
/// caller's values. `otpauth://hotp/...` URIs are rejected —
/// HOTP is counter-based, not time-based.
pub fn code_with_params(
    secret_field: &str,
    period: u32,
    digits: u32,
    algorithm: &str,
) -> Result<(String, u64)> {
    let field = secret_field.trim();
    if field.is_empty() {
        return Err(VaultError::InvalidTotpSecret("empty secret".into()));
    }
    let totp = if field.to_lowercase().starts_with("otpauth://") {
        build_from_uri_with_params(field, period, digits, algorithm)?
    } else {
        let cleaned: String = field
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect::<String>()
            .to_uppercase();
        let secret = Secret::Encoded(cleaned).to_bytes().map_err(|_| {
            VaultError::InvalidTotpSecret(
                "not valid base32 (check for typos — the secret itself is never shown)".into(),
            )
        })?;
        if secret.len() < 10 {
            return Err(VaultError::InvalidTotpSecret(format!(
                "TOTP secret is only {} bytes — at least 10 bytes (80 bits) are required",
                secret.len()
            )));
        }
        TOTP::new_unchecked(
            parse_algorithm(algorithm),
            clamp_digits(digits),
            1,
            clamp_period(period),
            secret,
            None,
            "AetherVault".to_string(),
        )
    };
    let code = totp
        .generate_current()
        .map_err(|e| VaultError::InvalidTotpSecret(e.to_string()))?;
    let remaining = seconds_remaining_in(now_unix_secs(), totp.step);
    Ok((code, remaining))
}

fn now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Minimal `otpauth://` query parsing (no `url` crate in the tree):
/// returns (secret, period?, digits?, algorithm?) with the raw
/// query values still unclamped; clamping happens in the caller.
fn parse_otpauth_query(uri: &str) -> (String, Option<String>, Option<String>, Option<String>) {
    let query = uri.split_once('?').map(|x| x.1).unwrap_or("");
    let mut secret = String::new();
    let mut period = None;
    let mut digits = None;
    let mut algorithm = None;
    for pair in query.split('&') {
        let Some((k, v)) = pair.split_once('=') else {
            continue;
        };
        // Percent-decode the few escapes a QR-scanned URI can carry
        // (+ is a space in query strings; %XX is a raw byte).
        let v = percent_decode(v);
        match k.to_lowercase().as_str() {
            "secret" => secret = v,
            "period" => period = Some(v),
            "digits" => digits = Some(v),
            "algorithm" => algorithm = Some(v),
            _ => {}
        }
    }
    (secret, period, digits, algorithm)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                if let Ok(b) = u8::from_str_radix(hex, 16) {
                    out.push(b);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn build_from_uri_with_params(
    uri: &str,
    period: u32,
    digits: u32,
    algorithm: &str,
) -> Result<TOTP> {
    // Host part between "otpauth://" and the next '/': "hotp" is a
    // different (counter-based) scheme — reject, don't silently
    // treat it as TOTP.
    let after_scheme = uri.split_once("://").map(|x| x.1).unwrap_or("");
    let host = after_scheme.split('/').next().unwrap_or("");
    if host.eq_ignore_ascii_case("hotp") {
        return Err(VaultError::InvalidTotpSecret(
            "HOTP (counter-based) URIs are not supported — only TOTP.".into(),
        ));
    }
    if !host.eq_ignore_ascii_case("totp") {
        return Err(VaultError::InvalidTotpSecret(
            "not an otpauth://totp URI".into(),
        ));
    }
    let (secret_raw, uri_period, uri_digits, uri_algo) = parse_otpauth_query(uri);
    let cleaned: String = secret_raw
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_uppercase();
    if cleaned.is_empty() {
        return Err(VaultError::InvalidTotpSecret("missing secret".into()));
    }
    let secret = Secret::Encoded(cleaned).to_bytes().map_err(|_| {
        VaultError::InvalidTotpSecret(
            "not valid base32 (check for typos — the secret itself is never shown)".into(),
        )
    })?;
    if secret.len() < 10 {
        return Err(VaultError::InvalidTotpSecret(format!(
            "TOTP secret is only {} bytes — at least 10 bytes (80 bits) are required",
            secret.len()
        )));
    }
    // URI params win when present (clamped); otherwise the
    // caller's values (same clamping).
    let step = match uri_period
        .as_deref()
        .and_then(|p| p.parse::<u32>().ok())
    {
        Some(p) => clamp_period(p),
        None => clamp_period(period),
    };
    let dig = match uri_digits
        .as_deref()
        .and_then(|d| d.parse::<u32>().ok())
    {
        Some(d) => clamp_digits(d),
        None => clamp_digits(digits),
    };
    let algo = match uri_algo.as_deref() {
        Some(a) => parse_algorithm(a),
        None => parse_algorithm(algorithm),
    };
    Ok(TOTP::new_unchecked(algo, dig, 1, step, secret, None, "AetherVault".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc6238_sha1_vector() {
        // RFC 6238 Appendix B seed for SHA-1: ASCII "12345678901234567890",
        // base32-encoded below. At T=59 the 8-digit code is 94287082,
        // so the 6-digit code must be 287082.
        let secret_b32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
        let totp = TOTP::new(
            Algorithm::SHA1,
            6,
            1,
            30,
            Secret::Encoded(secret_b32.to_string())
                .to_bytes()
                .expect("base32"),
            None,
            "test".to_string(),
        )
        .expect("totp");
        assert_eq!(totp.generate(59), "287082");
    }

    #[test]
    fn bare_secret_generates_six_digits() {
        let (code, _) = code_with_params("JBSWY3DPEHPK3PXP", 30, 6, "SHA1").expect("code");
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn otpauth_uri_with_80bit_secret_works() {
        // Integration test for the otpauth:// path in
        // code_with_params — 16 base32 chars = 80 bits, under
        // totp-rs's 128-bit floor, so a checked constructor
        // would reject this URI outright.
        let uri = "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example";
        let (code, _) = code_with_params(uri, 30, 6, "SHA1").expect("code from uri");
        assert_eq!(code.len(), 6);
        assert_eq!(code, code_with_params("JBSWY3DPEHPK3PXP", 30, 6, "SHA1").expect("bare").0);
    }

    #[test]
    fn otpauth_uri_invalid_and_missing_secret_rejected() {
        // Unchecked must not mean unvalidated: a URI whose
        // secret is not base32, and a URI with no secret at
        // all, must still fail instead of producing a code.
        assert!(code_with_params(
            "otpauth://totp/Example:alice?secret=!!!not-base32!!!&issuer=Example",
            30,
            6,
            "SHA1"
        )
        .is_err());
        assert!(code_with_params(
            "otpauth://totp/Example:alice?issuer=Example",
            30,
            6,
            "SHA1"
        )
        .is_err());
    }

    #[test]
    fn totp_floor_and_param_handling() {
        // Exactly 80 bits (16 base32 chars) is the floor — accepted.
        assert!(code_with_params("JBSWY3DPEHPK3PXP", 30, 6, "SHA1").is_ok());
        // Below 80 bits is rejected in both paths.
        assert!(code_with_params("JBSWY3DP", 30, 6, "SHA1").is_err()); // 8 chars = 40 bits
        assert!(code_with_params(
            "otpauth://totp/Example:alice?secret=JBSWY3DP&issuer=Example",
            30,
            6,
            "SHA1"
        )
        .is_err());
        // Caller params are clamped (see clamp_period /
        // clamp_digits), never rejected: out-of-range period falls
        // back to 30, digits other than 8 fall back to 6, and
        // unknown algorithms fall back to SHA-1. URI params win
        // when present (also clamped).
        let (_, rem) = code_with_params(
            "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&digits=8&period=15&algorithm=SHA256",
            30,
            6,
            "SHA-1",
        )
        .expect("uri params win");
        assert!((1..=15).contains(&rem));
        assert!(code_with_params("JBSWY3DPEHPK3PXP", 120, 6, "SHA512").is_ok());
        // A nonsense period is clamped to the 30 s default, not an error.
        assert!(code_with_params("JBSWY3DPEHPK3PXP", 3, 6, "SHA1").is_ok());
        assert!(code_with_params("JBSWY3DPEHPK3PXP", 7200, 6, "SHA1").is_ok());
        // MD5 falls back to SHA-1.
        assert!(code_with_params("JBSWY3DPEHPK3PXP", 30, 6, "MD5").is_ok());
    }

    #[test]
    fn rfc6238_sha256_and_sha512_vectors() {
        // RFC 6238 Appendix B, 8-digit codes.
        let sha256_b32 =
            "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA";
        let sha512_b32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA";
        let mk = |algo: Algorithm, b32: &str| {
            TOTP::new(
                algo,
                8,
                1,
                30,
                Secret::Encoded(b32.to_string()).to_bytes().expect("base32"),
                None,
                "test".to_string(),
            )
            .expect("totp")
        };
        let t256 = mk(Algorithm::SHA256, sha256_b32);
        let t512 = mk(Algorithm::SHA512, sha512_b32);
        assert_eq!(t256.generate(59), "46119246");
        assert_eq!(t512.generate(59), "90693936");
        assert_eq!(t256.generate(1_111_111_109), "68084774");
        assert_eq!(t512.generate(1_111_111_109), "25091201");
        assert_eq!(t256.generate(1_234_567_890), "91819424");
        assert_eq!(t512.generate(1_234_567_890), "93441116");
        assert_eq!(t256.generate(2_000_000_000), "90698825");
        assert_eq!(t512.generate(2_000_000_000), "38618901");
    }

    #[test]
    fn code_with_params_clamps_and_rejects_hotp() {
        // Bare secret: caller params apply; out-of-range period
        // falls back to 30, digits other than 8 fall back to 6.
        let (code, remaining) =
            code_with_params("JBSWY3DPEHPK3PXP", 30, 6, "SHA-1").expect("code");
        assert_eq!(code.len(), 6);
        assert!((1..=30).contains(&remaining));
        let (code8, _) = code_with_params("JBSWY3DPEHPK3PXP", 30, 8, "SHA-1").expect("code8");
        assert_eq!(code8.len(), 8);
        let (code_bad_period, rem) =
            code_with_params("JBSWY3DPEHPK3PXP", 1, 6, "SHA-1").expect("clamped");
        assert_eq!(code_bad_period.len(), 6);
        assert!((1..=30).contains(&rem));
        // URI params win over caller params.
        let (uri_code, _) = code_with_params(
            "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&digits=8&period=60&algorithm=SHA256",
            30,
            6,
            "SHA-1",
        )
        .expect("uri code");
        assert_eq!(uri_code.len(), 8);
        // HOTP URIs are rejected, not silently treated as TOTP.
        assert!(code_with_params(
            "otpauth://hotp/Example:alice?secret=JBSWY3DPEHPK3PXP&counter=1",
            30,
            6,
            "SHA-1"
        )
        .is_err());
        // Unknown algorithm falls back to SHA-1.
        assert_eq!(parse_algorithm("MD5"), Algorithm::SHA1);
        assert_eq!(parse_algorithm("sha256"), Algorithm::SHA256);
        assert_eq!(clamp_period(0), 30);
        assert_eq!(clamp_period(300), 300);
        assert_eq!(clamp_period(301), 30);
        assert_eq!(clamp_digits(7), 6);
    }

    #[test]
    fn garbage_secret_rejected() {
        assert!(code_with_params("!!!not-base32!!!", 30, 6, "SHA1").is_err());
        assert!(code_with_params("", 30, 6, "SHA1").is_err());
    }

    #[test]
    fn countdown_math() {
        assert_eq!(seconds_remaining_in(0, 30), 30);
        assert_eq!(seconds_remaining_in(29, 30), 1);
        assert_eq!(seconds_remaining_in(30, 30), 30);
        // A 60 s window counts down from 60, not 30.
        assert_eq!(seconds_remaining_in(0, 60), 60);
        assert_eq!(seconds_remaining_in(45, 60), 15);
    }
}
