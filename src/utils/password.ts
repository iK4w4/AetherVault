import { invoke } from '@tauri-apps/api/core';

const COMMON_BREACHED_PASSWORDS = new Set([
  '123456', '123456789', '12345678', '12345', '1234567', '1234567890', 'password',
  'password1', 'password123', 'qwerty', 'qwerty123', 'abc123', '111111', '123123',
  'admin', 'letmein', 'welcome', 'monkey', 'dragon', 'baseball', 'football',
  'iloveyou', 'trustno1', 'sunshine', 'princess', 'master', 'hello', 'freedom',
  'whatever', 'qazwsx', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx', 'passw0rd', 'p@ssword',
  'p@ssw0rd', 'charlie', 'michael', 'shadow', 'ashley', 'bailey', 'superman',
  'batman', 'hunter2', 'correcthorsebatterystaple', 'summer', 'winter', 'spring',
  'autumn', 'welcome123', 'changeme', 'secret', 'test1234', 'root', 'toor', 'default',
  'qwertyuiop', 'asdfghjkl', '654321', '000000', '987654321', 'chocolate',
  'cookie', 'starwars', 'pokemon', 'minecraft', 'roblox', 'liverpool', 'arsenal',
  'admin123', 'pass1234', 'qwerty1', 'jordan', 'harley', 'ranger', 'buster'
]);

export interface PasswordGenOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

export interface PassphraseGenOptions {
  wordCount: number;
  separator: string;
  capitalize: boolean;
  includeNumber: boolean;
}

export async function generateRandomPassword(options: PasswordGenOptions): Promise<string> {
  try {
    const { password } = await invoke<{ password: string; entropy_bits: number }>(
      'generate_password',
      {
        opts: {
          length: options.length,
          uppercase: options.uppercase,
          lowercase: options.lowercase,
          digits: options.numbers,
          symbols: options.symbols,
          exclude_ambiguous: options.excludeAmbiguous,
        },
      }
    );
    return password;
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(typeof err === 'string' ? err : 'Failed to generate password.');
  }
}

export async function generatePassphrase(options: PassphraseGenOptions): Promise<string> {
  let passphrase: string;
  try {
    const result = await invoke<{ passphrase: string; entropy_bits: number }>(
      'generate_passphrase',
      { wordCount: options.wordCount }
    );
    passphrase = result.passphrase;
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(typeof err === 'string' ? err : 'Failed to generate passphrase.');
  }
  // The Rust backend takes only a word count, so the separator / capitalize /
  // include-number options are applied here on the returned plain words.
  const words = passphrase.split(/[^A-Za-z]+/).filter(Boolean);
  const styled = words.map((w) =>
    options.capitalize ? w.charAt(0).toUpperCase() + w.slice(1) : w
  );
  if (options.includeNumber && styled.length > 0) {
    const pick = new Uint32Array(1);
    crypto.getRandomValues(pick);
    const idx = pick[0] % styled.length;
    styled[idx] = `${styled[idx]}${10 + (pick[0] % 90)}`;
  }
  return styled.join(options.separator);
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  entropyBits: number;
  isBreached: boolean;
  crackTimeLabel: string;
  feedback: string;
}

function estimateCrackTime(entropyBits: number): string {
  if (entropyBits < 28) return 'Seconds';
  if (entropyBits < 38) return 'Minutes to hours';
  if (entropyBits < 52) return 'Weeks to months';
  if (entropyBits < 68) return 'Years';
  return 'Centuries';
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return {
      score: 0,
      label: 'Empty',
      entropyBits: 0,
      isBreached: false,
      crackTimeLabel: '—',
      feedback: 'Enter a password to check strength.',
    };
  }

  const lower = password.toLowerCase();
  const strippedCommon = lower
    .replace(/(19|20)\d{2}[!@#$%^&*]*$/, '')
    .replace(/[0-9!@#$]+$/, '');
  const isBreached =
    COMMON_BREACHED_PASSWORDS.has(lower) ||
    (strippedCommon.length >= 4 && COMMON_BREACHED_PASSWORDS.has(strippedCommon));

  let charsetSize = 0;
  if (/[a-z]/.test(password)) charsetSize += 26;
  if (/[A-Z]/.test(password)) charsetSize += 26;
  if (/[0-9]/.test(password)) charsetSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) charsetSize += 32;

  const uniqueRatio = new Set(password).size / password.length;
  let entropyBits = Math.round(
    password.length * Math.log2(Math.max(charsetSize, 1)) * (0.65 + 0.35 * uniqueRatio)
  );

  if (
    /^(.)\1+$/.test(password) ||
    /(0123|1234|2345|3456|4567|5678|6789|9876|abcd|qwer|asdf|zxcv)/i.test(password) ||
    /(.)\1{3,}/.test(password)
  ) {
    entropyBits = Math.max(10, Math.round(entropyBits * 0.52));
  }

  if (isBreached) {
    return {
      score: 0,
      label: 'Breached',
      entropyBits: Math.min(entropyBits, 22),
      isBreached: true,
      crackTimeLabel: 'Instant',
      feedback: 'Found in common data breaches. Replace immediately.',
    };
  }

  if (password.length < 8 || entropyBits < 36) {
    return {
      score: 1,
      label: 'Weak',
      entropyBits,
      isBreached: false,
      crackTimeLabel: estimateCrackTime(entropyBits),
      feedback: 'Use at least 12 characters with mixed character types.',
    };
  }

  if (entropyBits < 56) {
    return {
      score: 2,
      label: 'Fair',
      entropyBits,
      isBreached: false,
      crackTimeLabel: estimateCrackTime(entropyBits),
      feedback: 'Acceptable, though 14+ characters or a passphrase is safer.',
    };
  }

  if (entropyBits < 80) {
    return {
      score: 3,
      label: 'Strong',
      entropyBits,
      isBreached: false,
      crackTimeLabel: estimateCrackTime(entropyBits),
      feedback: 'Solid protection against brute-force guessing.',
    };
  }

  return {
    score: 4,
    label: 'Excellent',
    entropyBits,
    isBreached: false,
    crackTimeLabel: estimateCrackTime(entropyBits),
    feedback: 'High-entropy password with strong resistance.',
  };
}

export function detectCardBrand(cardNumber?: string): string | null {
  const digits = (cardNumber || '').replace(/\D/g, '');
  if (!digits) return null;
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'Amex';
  if (/^6(?:011|5)/.test(digits)) return 'Discover';
  return 'Card';
}

export function isValidLuhnCard(cardNumber?: string): boolean {
  const digits = (cardNumber || '').replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export function formatCardNumberGroups(cardNumber: string): string {
  const digits = cardNumber.replace(/\D/g, '');
  if (!digits) return '';
  if (/^3[47]/.test(digits)) {
    return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)]
      .filter(Boolean)
      .join(' ');
  }
  return digits.match(/.{1,4}/g)?.join(' ') || digits;
}

export function formatCardNumberMasked(cardNumber: string): string {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 4) return '•••• ••••';
  return `•••• •••• •••• ${digits.slice(-4)}`;
}
