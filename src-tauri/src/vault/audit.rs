//! Vault health audit producing the `HealthReport` JSON:
//! score, totalLogins, breached/weak/reused/old counts, issues,
//! and duplicate groups (entry JSON grouped by domain, with
//! plaintext passwords replaced by `passwordLength`).
//!
//! Rules:
//! * Only non-trashed entries with `category == "login"` count;
//!   `totalLogins` counts only those WITH a password.
//! * Weak: strength score ≤ 1 (see `crate::crypto::evaluate_strength`).
//! * Reused: the same password on 2+ active logins (one issue per
//!   entry in the group, naming the others).
//! * Old: `passwordUpdatedAt || updatedAt || createdAt` (ms) more
//!   than 180 days ago.
//! * Duplicates: non-trashed logins grouped by normalized domain
//!   (host, lowercased, `www.` stripped); groups of 2+ only.
//! * Score: `100 - round((breached*22 + weak*12 + reused*9 +
//!   old*4) / max(totalLogins, 3) * 1.4)`, clamped to [8, 100];
//!   100 when there are no active logins.
//! * Issues sorted critical → high → medium, then by entry title.
//!
//! NO BREACH CORPUS: `breachedCount` is always 0 and no `breached`
//! issues are ever produced (there is no local HIBP range file and
//! no network lookup). A password in the small built-in
//! common-password list still scores 0, so it surfaces as a
//! `weak` issue.

use std::collections::HashMap;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::crypto;

/// 180 days, in milliseconds — the aging threshold.
pub const STALE_AFTER_MS: i64 = 180 * 24 * 60 * 60 * 1000;

/// Normalized domain of an entry URL: host, lowercased,
/// `www.` stripped. Hand-rolled (no `url` crate): strip the
/// scheme, cut at the first `/ ? #`, strip userinfo and a
/// trailing `:port`. Returns `None` for an empty URL.
pub fn normalize_domain(raw_url: &str) -> Option<String> {
    let raw = raw_url.trim();
    if raw.is_empty() {
        return None;
    }
    let no_scheme = match raw.find("://") {
        Some(i) => &raw[i + 3..],
        None => raw,
    };
    let host = no_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("");
    let host = match host.rfind('@') {
        Some(i) => &host[i + 1..],
        None => host,
    };
    let host = if let Some(rest) = host.strip_prefix('[') {
        match rest.find(']') {
            Some(i) => &host[..=i + 1],
            None => host,
        }
    } else {
        match host.rfind(':') {
            Some(i) => &host[..i],
            None => host,
        }
    };
    let host = host.to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    if host.is_empty() {
        None
    } else {
        Some(host.to_string())
    }
}

fn entry_str(e: &Value, key: &str) -> String {
    e.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn entry_i64(e: &Value, key: &str) -> i64 {
    e.get(key).and_then(|v| v.as_i64()).unwrap_or(0)
}

/// HMAC-SHA-256 (RFC 2104), implemented on `sha2` directly so
/// the reuse map needs no extra dependency.
fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    let mut key_block = [0u8; 64];
    if key.len() > 64 {
        let mut h = Sha256::new();
        h.update(key);
        key_block[..32].copy_from_slice(&h.finalize());
    } else {
        key_block[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; 64];
    let mut opad = [0x5cu8; 64];
    for i in 0..64 {
        ipad[i] ^= key_block[i];
        opad[i] ^= key_block[i];
    }
    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(msg);
    let inner_hash = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(inner_hash);
    outer.finalize().into()
}

fn is_trashed(e: &Value) -> bool {
    // `trashedAt` set (non-null, non-zero) means trashed.
    // A legacy `deleted: bool` is accepted too, so either shape
    // audits correctly.
    match e.get("trashedAt") {
        Some(Value::Null) | None => {}
        Some(v) => {
            if v.as_i64().unwrap_or(0) != 0 {
                return true;
            }
        }
    }
    e.get("deleted").and_then(|v| v.as_bool()).unwrap_or(false)
}

fn is_login(e: &Value) -> bool {
    entry_str(e, "category") == "login"
}

/// Build the `HealthReport` JSON for the given entries.
pub fn audit_vault(entries: &[Value]) -> Value {
    let now_ms = crate::vault::now_unix() * 1000;
    let active_logins: Vec<&Value> = entries
        .iter()
        .filter(|e| !is_trashed(e) && is_login(e))
        .collect();
    let with_password: Vec<&Value> = active_logins
        .iter()
        .copied()
        .filter(|e| !entry_str(e, "password").is_empty())
        .collect();

    let mut issues: Vec<Value> = Vec::new();
    let mut weak_count = 0usize;
    let mut old_count = 0usize;

    // Reuse map: HMAC-SHA-256 of the password under a per-call
    // random 32-byte key — never an unsalted fast hash, even
    // though the map lives only for this call.
    let reuse_key = crate::crypto::random_bytes::<32>();
    let mut by_hash: HashMap<String, Vec<&Value>> = HashMap::new();
    for e in &with_password {
        let pw = entry_str(e, "password");
        let hash = hmac_sha256(&reuse_key, pw.as_bytes());
        let hex: String = hash.iter().map(|b| format!("{b:02x}")).collect();
        by_hash.entry(hex).or_default().push(e);
    }

    for e in &with_password {
        let id = entry_str(e, "id");
        let title = entry_str(e, "title");
        let username = entry_str(e, "username");
        let url = entry_str(e, "url");
        let pw = entry_str(e, "password");
        let eval = crypto::evaluate_strength(&pw);
        // Breached (common list) is checked first, weak
        // second — but with no breach corpus this build never
        // emits breached issues, so a score-0 common password
        // falls through to the weak branch.
        if eval.score <= 1 {
            weak_count += 1;
            issues.push(json!({
                "id": format!("{id}-weak"),
                "entryId": id,
                "entryTitle": title,
                "username": username,
                "url": url,
                "type": "weak",
                "severity": "high",
                "title": "Weak Password",
                "description": format!(
                    "{} characters · {} bits entropy. Generate a stronger replacement.",
                    pw.chars().count(),
                    (eval.bits * 10.0).round() / 10.0
                ),
            }));
        }
        // `passwordUpdatedAt || updatedAt || createdAt` —
        // first truthy (non-zero) value wins.
        let last_changed = if entry_i64(e, "passwordUpdatedAt") != 0 {
            entry_i64(e, "passwordUpdatedAt")
        } else if entry_i64(e, "updatedAt") != 0 {
            entry_i64(e, "updatedAt")
        } else {
            entry_i64(e, "createdAt")
        };
        // A crafted timestamp near i64::MIN would overflow the
        // subtraction (release builds wrap silently).
        if now_ms.saturating_sub(last_changed) > STALE_AFTER_MS {
            old_count += 1;
            let days = now_ms.saturating_sub(last_changed) / (24 * 60 * 60 * 1000);
            issues.push(json!({
                "id": format!("{id}-old"),
                "entryId": id,
                "entryTitle": title,
                "username": username,
                "url": url,
                "type": "old",
                "severity": "medium",
                "title": "Aging Password",
                "description": format!("Last updated {days} days ago. Rotating older credentials limits exposure."),
            }));
        }
    }

    let mut reused_count = 0usize;
    for group in by_hash.values() {
        if group.len() > 1 {
            for e in group {
                reused_count += 1;
                let id = entry_str(e, "id");
                let others: Vec<String> = group
                    .iter()
                    .filter(|g| entry_str(g, "id") != id)
                    .map(|g| entry_str(g, "title"))
                    .collect();
                let mut desc = format!("Shared with {}", others[..others.len().min(2)].join(", "));
                if others.len() > 2 {
                    desc.push_str(&format!(" +{} more", others.len() - 2));
                }
                desc.push('.');
                issues.push(json!({
                    "id": format!("{id}-reused"),
                    "entryId": id,
                    "entryTitle": entry_str(e, "title"),
                    "username": entry_str(e, "username"),
                    "url": entry_str(e, "url"),
                    "type": "reused",
                    "severity": "high",
                    "title": "Reused Password",
                    "description": desc,
                }));
            }
        }
    }

    // Duplicates: all active logins (password or not) grouped by
    // normalized domain; groups of 2+ only. The report never
    // carries a plaintext password — the merge dialog only needs
    // the password length, so the value is replaced by
    // `passwordLength`.
    let mut domain_groups: HashMap<String, Vec<Value>> = HashMap::new();
    for e in &active_logins {
        if let Some(domain) = normalize_domain(&entry_str(e, "url")) {
            let mut entry = (*e).clone();
            if let Some(pw) = entry.get("password").and_then(|p| p.as_str()) {
                let len = pw.chars().count();
                if let Some(obj) = entry.as_object_mut() {
                    obj.remove("password");
                    obj.insert("passwordLength".to_string(), json!(len));
                }
            }
            domain_groups.entry(domain).or_default().push(entry);
        }
    }
    let mut duplicates: Vec<Value> = domain_groups
        .into_iter()
        .filter(|(_, g)| g.len() > 1)
        .map(|(domain, entries)| json!({ "domain": domain, "entries": entries }))
        .collect();
    duplicates.sort_by(|a, b| {
        b["entries"]
            .as_array()
            .map(|v| v.len())
            .unwrap_or(0)
            .cmp(&a["entries"].as_array().map(|v| v.len()).unwrap_or(0))
    });

    // Issues sorted critical → high → medium, then by entry title.
    let severity_rank = |s: &str| match s {
        "critical" => 0,
        "high" => 1,
        _ => 2,
    };
    issues.sort_by(|a, b| {
        let ra = severity_rank(a["severity"].as_str().unwrap_or(""));
        let rb = severity_rank(b["severity"].as_str().unwrap_or(""));
        ra.cmp(&rb).then_with(|| {
            a["entryTitle"]
                .as_str()
                .unwrap_or("")
                .cmp(b["entryTitle"].as_str().unwrap_or(""))
        })
    });

    let total = with_password.len();
    let score = if total > 0 {
        let penalty = weak_count * 12 + reused_count * 9 + old_count * 4;
        let normalized = (penalty as f64 / total.max(3) as f64) * 1.4;
        (100.0 - normalized).round() as i64
    } else {
        100
    };
    let score = score.clamp(8, 100);

    json!({
        "score": score,
        "totalLogins": total,
        "breachedCount": 0,
        "weakCount": weak_count,
        "reusedCount": reused_count,
        "oldCount": old_count,
        "issues": issues,
        "duplicates": duplicates,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn login(id: &str, title: &str, pw: &str, url: &str, updated_ms: i64) -> Value {
        json!({
            "id": id, "category": "login", "title": title,
            "username": "user", "password": pw, "url": url,
            "createdAt": updated_ms, "updatedAt": updated_ms,
            "trashedAt": null
        })
    }

    #[test]
    fn audit_counts_match_report_shape() {
        let now_ms = crate::vault::now_unix() * 1000;
        let day_ms = 24 * 60 * 60 * 1000;
        let strong = "X9$kQ!2mZp#8vL4nW7";
        let entries = vec![
            login("a", "Site A", "password", "https://github.com", now_ms),
            login("b", "Site B", "password", "https://WWW.github.com/x", now_ms),
            login("c", "Site C", strong, "https://example.com", now_ms - 200 * day_ms),
            login("d", "Note", "", "https://example.com", now_ms),
            json!({"id":"e","category":"note","title":"A note","password":"","createdAt":now_ms,"updatedAt":now_ms,"trashedAt":null}),
            // Trashed login: excluded everywhere.
            json!({"id":"f","category":"login","title":"Trashed","username":"u","password":"password","url":"https://github.com","createdAt":now_ms,"updatedAt":now_ms,"trashedAt":now_ms}),
        ];
        let report = audit_vault(&entries);
        // totalLogins counts only logins WITH a password (a, b, c).
        assert_eq!(report["totalLogins"], 3);
        assert_eq!(report["breachedCount"], 0);
        // "password" is common → score 0 → weak, twice.
        assert_eq!(report["weakCount"], 2);
        // Same password on a + b → reused, twice.
        assert_eq!(report["reusedCount"], 2);
        // c is 200 days old → old once.
        assert_eq!(report["oldCount"], 1);
        // Score: penalty 2*12 + 2*9 + 1*4 = 46; /max(3,3)=15.33; *1.4=21.47 → 79.
        assert_eq!(report["score"], 79);
        // Duplicates: github.com (a, b) AND example.com (c + the
        // password-less login d — duplicates group ALL active
        // logins, not just ones with a password). Trashed f excluded.
        assert_eq!(report["duplicates"].as_array().unwrap().len(), 2);
        let gh = report["duplicates"]
            .as_array()
            .unwrap()
            .iter()
            .find(|g| g["domain"] == "github.com")
            .expect("github group");
        assert_eq!(gh["entries"].as_array().unwrap().len(), 2);
        // No breached issue ever.
        assert!(!report["issues"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["type"] == "breached"));
        // Issues sorted high before medium.
        let sev: Vec<&str> = report["issues"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["severity"].as_str().unwrap())
            .collect();
        assert!(sev.iter().take_while(|s| **s == "high").count() >= 4);
        assert_eq!(sev.last(), Some(&"medium"));
    }

    #[test]
    fn audit_empty_vault_scores_100() {
        let report = audit_vault(&[]);
        assert_eq!(report["score"], 100);
        assert_eq!(report["totalLogins"], 0);
        assert!(report["issues"].as_array().unwrap().is_empty());
        assert!(report["duplicates"].as_array().unwrap().is_empty());
    }

    #[test]
    fn normalize_domain_parses_urls() {
        assert_eq!(
            normalize_domain("https://WWW.GitHub.com/settings"),
            Some("github.com".to_string())
        );
        assert_eq!(normalize_domain("github.com"), Some("github.com".to_string()));
        assert_eq!(
            normalize_domain("https://user:pw@sub.example.com:8080/x?y=1#z"),
            Some("sub.example.com".to_string())
        );
        assert_eq!(normalize_domain(""), None);
        assert_eq!(normalize_domain("   "), None);
    }
}
