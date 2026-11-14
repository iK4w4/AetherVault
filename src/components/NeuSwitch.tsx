import React from 'react';

interface NeuSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  description?: string;
}

/**
 * Neumorphic switch — an inset groove with a raised knob that slides.
 * On: the groove fills with a soft accent tint and the knob turns accent.
 * Off: groove and knob are both the plain surface, knob pressed into the
 * groove. The switch reads as part of the surface, not a separate control.
 */
export const NeuSwitch: React.FC<NeuSwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  label,
  description,
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`neu-inset-sm w-full rounded-[15px] px-4 py-3 flex items-center justify-between gap-4 text-left transition-opacity ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      }`}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--neu-text)]">{label}</div>
        {description && (
          <div className="text-xs text-[var(--neu-text-muted)] mt-0.5">{description}</div>
        )}
      </div>

      <span
        aria-hidden="true"
        className="w-12 h-7 rounded-full p-1 shrink-0 flex items-center transition-colors duration-200"
        style={{
          backgroundColor: checked ? 'var(--neu-accent-soft)' : 'var(--neu-surface)',
          boxShadow: 'var(--neu-shadow-inset-sm)',
        }}
      >
        <span
          className="w-5 h-5 rounded-full transition-all duration-200 flex items-center justify-center"
          style={{
            backgroundColor: checked ? 'var(--neu-accent)' : 'var(--neu-surface)',
            transform: checked ? 'translateX(20px)' : 'translateX(0)',
            boxShadow: checked
              ? 'var(--neu-shadow-btn-primary)'
              : 'var(--neu-shadow-raised-xs)',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full transition-opacity duration-200"
            style={{
              backgroundColor: '#ffffff',
              opacity: checked ? 0.95 : 0,
            }}
          />
        </span>
      </span>
    </button>
  );
};
