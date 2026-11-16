import { invoke } from '@tauri-apps/api/core';

export type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

export interface ParsedTotpUri {
  secret: string;
  period: number;
  digits: number;
  algorithm: TotpAlgorithm;
}

function normalizeAlgorithm(raw?: string | null): TotpAlgorithm {
  const upper = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (upper === 'SHA256') return 'SHA-256';
  if (upper === 'SHA512') return 'SHA-512';
  return 'SHA-1';
}

export function parseTotpInput(input: string): ParsedTotpUri {
  const trimmed = input.trim();
  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    try {
      const url = new URL(trimmed);
      if (url.hostname.toLowerCase() === 'hotp') {
        return { secret: '', period: 30, digits: 6, algorithm: 'SHA-1' };
      }
      const secret = url.searchParams.get('secret') || '';
      const rawPeriod = Math.floor(Number(url.searchParams.get('period')) || 30);
      const period = rawPeriod >= 5 && rawPeriod <= 300 ? rawPeriod : 30;
      const rawDigits = Number(url.searchParams.get('digits'));
      const digits = rawDigits >= 6 && rawDigits <= 8 ? rawDigits : 6;
      const algorithm = normalizeAlgorithm(url.searchParams.get('algorithm'));
      return {
        secret: cleanTotpSecret(secret),
        period,
        digits,
        algorithm,
      };
    } catch {
      return { secret: '', period: 30, digits: 6, algorithm: 'SHA-1' };
    }
  }
  return {
    secret: cleanTotpSecret(trimmed),
    period: 30,
    digits: 6,
    algorithm: 'SHA-1',
  };
}

export function cleanTotpSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/-/g, '').replace(/=+$/, '').toUpperCase();
}

export function formatTotpStorage(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const parsed = parseTotpInput(trimmed);
  if (parsed.period !== 30 || parsed.digits !== 6 || parsed.algorithm !== 'SHA-1') {
    const algoParam = parsed.algorithm.replace('-', '');
    return `otpauth://totp/AetherVault?secret=${parsed.secret}&period=${parsed.period}&digits=${parsed.digits}&algorithm=${algoParam}`;
  }
  return parsed.secret;
}

/** Bytes a base32 string decodes to (padding bits are dropped, as in RFC 4648). */
export function decodedSecretBytes(secret: string): number {
  return Math.floor((secret.length * 5) / 8);
}

export function isValidTotpSecret(input: string): boolean {
  const { secret } = parseTotpInput(input);
  if (!/^[A-Z2-7]+$/.test(secret)) return false;
  // Base32 can only encode 0, 2, 4, 5 or 7 leftover bits per 8 characters.
  const remainder = secret.length % 8;
  if (remainder === 1 || remainder === 3 || remainder === 6) return false;
  // Mirrors the Rust backend: at least 10 decoded bytes (80 bits).
  return decodedSecretBytes(secret) >= 10;
}

export function getTotpCountdown(period = 30, nowMs = Date.now()): {
  remaining: number;
  progress: number;
} {
  const epochSeconds = Math.floor(nowMs / 1000);
  const elapsed = epochSeconds % period;
  const remaining = period - elapsed;
  const progress = remaining / period;
  return { remaining, progress };
}

export async function generateTotpCode(
  input: string,
  defaultPeriod = 30,
  defaultDigits = 6,
  _nowMs = Date.now()
): Promise<string> {
  // The Rust backend computes the code for the current time; the caller's
  // timestamp is accepted for signature compatibility but not forwarded,
  // since the backend command takes no timestamp.
  const parsed = parseTotpInput(input);
  const period = parsed.period || defaultPeriod;
  const digits = parsed.digits || defaultDigits;
  if (!parsed.secret) {
    throw new Error('Empty TOTP secret');
  }
  try {
    const { code } = await invoke<{ code: string; remaining_secs: number }>('totp_code', {
      secret: parsed.secret,
      period,
      digits,
      algorithm: parsed.algorithm,
    });
    return code;
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(typeof err === 'string' ? err : 'Failed to generate TOTP code.');
  }
}
