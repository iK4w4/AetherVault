import React from 'react';
import { Check } from 'lucide-react';

interface NeuCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
}

/**
 * Neumorphic checkbox — an inset square with a raised check.
 * Replaces the native checkbox, which the browser draws in its own style
 * no matter what color you set on it.
 */
export const NeuCheckbox: React.FC<NeuCheckboxProps> = ({ checked, onChange, label }) => {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-start gap-2.5 text-left cursor-pointer select-none group"
    >
      <span
        aria-hidden="true"
        className="w-5 h-5 rounded-[7px] shrink-0 mt-px flex items-center justify-center transition-all duration-150"
        style={{
          backgroundColor: checked ? 'var(--neu-accent-soft)' : 'var(--neu-surface)',
          boxShadow: 'var(--neu-shadow-inset-sm)',
        }}
      >
        <Check
          className={`w-3.5 h-3.5 text-[var(--neu-accent)] transition-all duration-150 ${
            checked ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
          }`}
          strokeWidth={3}
        />
      </span>
      <span className="text-xs text-[var(--neu-text-muted)] leading-5">{label}</span>
    </button>
  );
};
