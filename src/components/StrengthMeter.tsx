import React from 'react';
import { evaluatePasswordStrength } from '../utils/password';

interface StrengthMeterProps {
  password: string;
  compact?: boolean;
  showCrackTime?: boolean;
}

export const StrengthMeter: React.FC<StrengthMeterProps> = ({
  password,
  compact = false,
  showCrackTime = false,
}) => {
  const strength = evaluatePasswordStrength(password);

  const barColor =
    strength.score <= 1
      ? 'var(--neu-danger)'
      : strength.score === 2
      ? 'var(--neu-warning)'
      : strength.score === 3
      ? 'var(--neu-accent)'
      : 'var(--neu-success)';

  const filledCount = !password
    ? 0
    : strength.isBreached
    ? 1
    : strength.score === 1
    ? 1
    : strength.score === 2
    ? 2
    : strength.score === 3
    ? 3
    : 4;

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-4 gap-2" aria-hidden="true">
        {[0, 1, 2, 3].map((idx) => (
          <div
            key={idx}
            className="neu-inset-sm h-2 rounded-full overflow-hidden p-[1px]"
          >
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{
                width: idx < filledCount ? '100%' : '0%',
                backgroundColor: barColor,
              }}
            />
          </div>
        ))}
      </div>
      {!compact && (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span
            className="font-semibold whitespace-nowrap shrink-0"
            style={{ color: password ? barColor : 'var(--neu-text-muted)' }}
          >
            {strength.label}
            {password ? ` · ${strength.entropyBits} bits` : ''}
            {password && showCrackTime ? ` · Est. crack: ${strength.crackTimeLabel}` : ''}
          </span>
          <span className="text-[var(--neu-text-muted)] truncate">
            {strength.feedback}
          </span>
        </div>
      )}
    </div>
  );
};
