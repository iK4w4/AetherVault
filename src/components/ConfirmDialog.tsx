import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Lock, AlertTriangle, X } from 'lucide-react';
import {
  formatRecoveryKeyInput,
  verifyMasterPassword,
  verifyRecoveryKey,
} from '../utils/crypto';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}) => {
  const [busy, setBusy] = useState(false);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const onConfirmRef = useRef(onConfirm);
  const onCancelRef = useRef(onCancel);

  onConfirmRef.current = onConfirm;
  onCancelRef.current = onCancel;

  const triggerConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirmRef.current();
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    // Focus cancel on destructive actions to prevent accidental Enter confirmation
    setTimeout(() => {
      if (destructive) {
        cancelBtnRef.current?.focus();
      } else {
        confirmBtnRef.current?.focus();
      }
    }, 30);

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onCancelRef.current();
      } else if (
        e.key === 'Enter' &&
        !busy &&
        !destructive &&
        !(document.activeElement instanceof HTMLButtonElement)
      ) {
        e.preventDefault();
        void triggerConfirm();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [open, busy, destructive]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/25 dark:bg-black/50 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="neu-raised w-full max-w-md rounded-[20px] p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="neu-inset-sm w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0">
              <AlertTriangle
                className="w-5 h-5"
                style={{ color: destructive ? 'var(--neu-danger)' : 'var(--neu-warning)' }}
              />
            </div>
            <h2
              id="confirm-dialog-title"
              className="text-lg font-semibold text-[var(--neu-text)]"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close dialog"
            className="neu-btn w-9 h-9 rounded-[12px] flex items-center justify-center text-[var(--neu-text-muted)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm leading-relaxed text-[var(--neu-text-muted)]">
          {description}
        </p>

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="neu-btn px-5 py-2.5 rounded-[14px] text-sm font-medium whitespace-nowrap shrink-0 focus-visible:ring-2 focus-visible:ring-[var(--neu-accent)]"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={triggerConfirm}
            disabled={busy}
            className="px-5 py-2.5 rounded-[14px] text-sm font-semibold text-white whitespace-nowrap shrink-0 flex items-center gap-2 transition-transform active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-[var(--neu-accent)]"
            style={{
              backgroundColor: destructive ? 'var(--neu-danger)' : 'var(--neu-accent)',
              boxShadow: 'var(--neu-shadow-raised-sm)',
            }}
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface MasterPasswordPromptProps {
  open: boolean;
  title?: string;
  description?: string;
  actionLabel?: string;
  allowRecoveryFallback?: boolean;
  onVerified: (secret: string) => void | Promise<void>;
  onCancel: () => void;
}

export const MasterPasswordPrompt: React.FC<MasterPasswordPromptProps> = ({
  open,
  title = 'Confirm Master Password',
  description = 'Enter your master password to encrypt and save this change.',
  actionLabel = 'Confirm & Save',
  allowRecoveryFallback = false,
  onVerified,
  onCancel,
}) => {
  const [useRecovery, setUseRecovery] = useState(false);
  const [password, setPassword] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (open) {
      setUseRecovery(allowRecoveryFallback);
      setPassword('');
      setRecoveryInput('');
      setError('');
      setShowPassword(false);
      setCapsLockOn(false);
      setTimeout(() => inputRef.current?.focus(), 40);
    } else {
      // Don't leave the secret in state after the dialog closes.
      setPassword('');
      setRecoveryInput('');
    }
  }, [open, allowRecoveryFallback]);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onCancelRef.current();
      }
    };
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [open, busy]);

  if (!open) return null;

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 450);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const secretValue = useRecovery ? recoveryInput.trim() : password;
    if (!secretValue) {
      setError(
        useRecovery
          ? 'Please enter your recovery key.'
          : 'Please enter your master password.'
      );
      triggerShake();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const ok = useRecovery
        ? await verifyRecoveryKey(secretValue)
        : await verifyMasterPassword(secretValue);
      if (!ok) {
        setError(
          useRecovery
            ? 'Invalid recovery key. Nothing was saved.'
            : 'Incorrect master password. Nothing was saved.'
        );
        triggerShake();
        return;
      }
      await onVerified(secretValue);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
      triggerShake();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/30 dark:bg-black/55 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mp-prompt-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className={`neu-raised w-full max-w-md rounded-[20px] p-6 space-y-5 ${shake ? 'animate-neu-shake' : ''}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="neu-inset-sm w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0">
              {useRecovery ? (
                <KeyRound className="w-5 h-5 text-[var(--neu-accent)]" />
              ) : (
                <Lock className="w-5 h-5 text-[var(--neu-accent)]" />
              )}
            </div>
            <div>
              <h2 id="mp-prompt-title" className="text-lg font-semibold text-[var(--neu-text)]">
                {useRecovery ? 'Confirm Recovery Key' : title}
              </h2>
              <p className="text-xs text-[var(--neu-text-muted)] mt-0.5">
                {useRecovery
                  ? 'Verify with your emergency recovery key since you have not set a new master password yet.'
                  : description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Cancel verification"
            className="neu-btn w-9 h-9 rounded-[12px] flex items-center justify-center text-[var(--neu-text-muted)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {useRecovery ? (
          <div className="space-y-2">
            <label
              htmlFor="mp-recovery-input"
              className="block text-xs font-medium text-[var(--neu-text-muted)]"
            >
              Recovery Key
            </label>
            <input
              ref={inputRef}
              id="mp-recovery-input"
              type="text"
              value={recoveryInput}
              onChange={(e) => {
                setRecoveryInput(formatRecoveryKeyInput(e.target.value));
                if (error) setError('');
              }}
              placeholder="AEV-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              className={`neu-input w-full rounded-[14px] px-4 py-3 font-mono text-sm ${error ? 'neu-input-error' : ''}`}
            />
            {error && (
              <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <label
              htmlFor="mp-confirm-input"
              className="block text-xs font-medium text-[var(--neu-text-muted)]"
            >
              Master Password
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                id="mp-confirm-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onKeyDown={(e) => setCapsLockOn(e.getModifierState('CapsLock'))}
                onKeyUp={(e) => setCapsLockOn(e.getModifierState('CapsLock'))}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                placeholder="Enter master password"
                autoComplete="current-password"
                className={`neu-input w-full rounded-[14px] px-4 py-3 pr-11 text-sm ${error ? 'neu-input-error' : ''}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-[10px] flex items-center justify-center text-[var(--neu-text-muted)] hover:text-[var(--neu-text)]"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {capsLockOn && (
              <p className="text-xs font-medium text-[var(--neu-warning)]">
                Caps Lock is on
              </p>
            )}
            {error && (
              <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        {allowRecoveryFallback && (
          <div className="flex justify-start">
            <button
              type="button"
              onClick={() => {
                setUseRecovery((v) => !v);
                setError('');
                setTimeout(() => inputRef.current?.focus(), 30);
              }}
              className="text-xs font-medium text-[var(--neu-accent)] hover:underline"
            >
              {useRecovery ? 'Verify with master password instead' : 'Verify with recovery key instead'}
            </button>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="neu-btn px-5 py-2.5 rounded-[14px] text-sm font-medium whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || (useRecovery ? !recoveryInput.trim() : !password)}
            className="neu-btn-primary px-5 py-2.5 rounded-[14px] text-sm font-semibold whitespace-nowrap shrink-0 flex items-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{actionLabel}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
