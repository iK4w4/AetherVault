import React, { useEffect, useState } from 'react';
import { Copy, Check, ShieldCheck } from 'lucide-react';
import {
  generateTotpCode,
  getTotpCountdown,
  isValidTotpSecret,
  parseTotpInput,
} from '../utils/totp';

interface TotpWidgetProps {
  secret: string;
  onCopy: (code: string) => void;
  compact?: boolean;
}

export const TotpWidget: React.FC<TotpWidgetProps> = ({ secret, onCopy, compact = false }) => {
  const parsed = parseTotpInput(secret);
  const period = parsed.period || 30;
  const digits = parsed.digits || 6;
  const placeholder = '-'.repeat(digits);

  const [code, setCode] = useState<string>(placeholder);
  const [remaining, setRemaining] = useState<number>(period);
  const [copied, setCopied] = useState(false);

  const valid = isValidTotpSecret(secret);

  useEffect(() => {
    if (!valid) return;
    let active = true;

    // The Rust backend computes the code; the countdown is pure math,
    // so it runs locally. The backend is only re-asked when the TOTP
    // window rolls over (code changes) — not on every animation tick.
    let lastWindow = Math.floor(Date.now() / 1000 / period);
    const fetchCode = async () => {
      try {
        const nextCode = await generateTotpCode(secret, period, digits, Date.now());
        if (active) setCode(nextCode);
      } catch {
        if (active) setCode(placeholder);
      }
    };

    void fetchCode();
    const interval = window.setInterval(() => {
      if (!active) return;
      const now = Date.now();
      setRemaining(getTotpCountdown(period, now).remaining);
      const curWindow = Math.floor(now / 1000 / period);
      if (curWindow !== lastWindow) {
        lastWindow = curWindow;
        void fetchCode();
      }
    }, 250);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [secret, valid, period, digits, placeholder]);

  if (!valid) {
    return (
      <div className="neu-inset-sm rounded-[14px] px-4 py-3 text-xs text-[var(--neu-danger)]">
        Invalid Base32 authenticator secret. Check the key in Edit mode.
      </div>
    );
  }

  const splitAt = digits === 8 ? 4 : 3;
  const formattedCode = `${code.slice(0, splitAt)} ${code.slice(splitAt)}`;
  const radius = compact ? 13 : 17;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - remaining / period);
  const urgent = remaining <= Math.min(5, Math.ceil(period * 0.2));

  const handleCopy = () => {
    if (code === placeholder) return;
    onCopy(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className={`neu-inset rounded-[16px] flex items-center justify-between gap-4 ${
        compact ? 'px-3.5 py-2.5' : 'px-4 py-3.5'
      }`}
    >
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="relative flex items-center justify-center shrink-0" style={{ width: compact ? 34 : 42, height: compact ? 34 : 42 }}>
          <svg
            className="-rotate-90"
            width={compact ? 34 : 42}
            height={compact ? 34 : 42}
            viewBox={`0 0 ${compact ? 34 : 42} ${compact ? 34 : 42}`}
          >
            <circle
              cx={compact ? 17 : 21}
              cy={compact ? 17 : 21}
              r={radius}
              fill="none"
              stroke="var(--neu-divider)"
              strokeWidth="3"
            />
            <circle
              cx={compact ? 17 : 21}
              cy={compact ? 17 : 21}
              r={radius}
              fill="none"
              stroke={urgent ? 'var(--neu-danger)' : 'var(--neu-accent)'}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              style={{ transition: 'stroke-dashoffset 0.35s linear, stroke 0.2s ease' }}
            />
          </svg>
          <span
            className="absolute font-mono text-[11px] font-semibold"
            style={{ color: urgent ? 'var(--neu-danger)' : 'var(--neu-text-muted)' }}
          >
            {remaining}
          </span>
        </div>

        <div className="min-w-0">
          {!compact && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--neu-text-muted)] mb-0.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[var(--neu-accent)]" />
              <span>One-Time Verification Code</span>
            </div>
          )}
          <div className="font-mono text-xl font-semibold tracking-wider text-[var(--neu-text)] select-all">
            {formattedCode}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy 2FA verification code"
        className="neu-btn px-3.5 py-2 rounded-[12px] text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-[var(--neu-success)]" />
            <span className="text-[var(--neu-success)]">Copied</span>
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5 text-[var(--neu-text-muted)]" />
            <span>Copy</span>
          </>
        )}
      </button>
    </div>
  );
};
