import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface NeuSelectOption {
  value: string | number;
  label: string;
}

interface NeuSelectProps {
  id?: string;
  value: string | number;
  options: NeuSelectOption[];
  onChange: (value: string | number) => void;
  ariaLabel?: string;
}

/**
 * Neumorphic dropdown — replaces the native <select>, whose open list is
 * rendered by the OS/browser and can never match the theme. The button is
 * an inset field; the list is a raised surface with a check on the
 * selected option. Closes on outside click, Escape, or selection.
 */
export const NeuSelect: React.FC<NeuSelectProps> = ({
  id,
  value,
  options,
  onChange,
  ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selected = options.find((o) => String(o.value) === String(value));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open ]);

  const toggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setOpenUp(rect.bottom + 240 > window.innerHeight);
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={toggle}
        className="neu-input w-full rounded-[14px] px-4 py-2.5 pr-10 text-sm cursor-pointer flex items-center justify-between gap-2 text-left"
      >
        <span className="truncate text-[var(--neu-text)]">
          {selected ? selected.label : 'Select…'}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-[var(--neu-text-muted)] shrink-0 transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className={`neu-raised absolute left-0 right-0 z-50 rounded-[14px] p-1.5 max-h-56 overflow-y-auto ${
            openUp ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
          }`}
        >
          {options.map((opt) => {
            const isSelected = String(opt.value) === String(value);
            return (
              <button
                key={String(opt.value)}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[10px] text-sm text-left transition-colors ${
                  isSelected
                    ? 'text-[var(--neu-accent)] font-semibold bg-[var(--neu-accent-soft)]'
                    : 'text-[var(--neu-text)] hover:bg-[var(--neu-accent-soft)]'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <Check className="w-4 h-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
