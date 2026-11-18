import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Moon,
  ShieldAlert,
  Sun,
  Upload,
} from 'lucide-react';
import {
  clearLocalVault,
  createNewVault,
  decryptBackupFile,
  DEFAULT_SETTINGS,
  EncryptedBackupFile,
  formatRecoveryKeyInput,
  hasLocalVaultAsync,
  unlockVaultWithPassword,
  unlockVaultWithRecoveryKey,
} from '../utils/crypto';
import { ThemeMode, VaultPayload } from '../types/vault';
import { ConfirmDialog } from './ConfirmDialog';
import { CreatorLinks } from './CreatorLinks';
import { NeumorphicLogo } from './NeumorphicLogo';
import { NeuSwitch } from './NeuSwitch';
import { StrengthMeter } from './StrengthMeter';

interface LockScreenProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
  onUnlocked: (payload: VaultPayload, viaRecovery: boolean) => void;
  onOpenLinkError?: (message: string) => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({
  theme,
  onToggleTheme,
  onUnlocked,
  onOpenLinkError,
}) => {
  const [vaultExists, setVaultExists] = useState(false);
  const [booting, setBooting] = useState(true);
  const [mode, setMode] = useState<'password' | 'recovery'>('password');

  // Unlock state
  const [password, setPassword] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // Setup state
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [setupPwError, setSetupPwError] = useState('');
  const [setupConfirmError, setSetupConfirmError] = useState('');
  const [showSetupPw, setShowSetupPw] = useState(false);
  const [pendingSetup, setPendingSetup] = useState<{
    payload: VaultPayload;
    recoveryKey: string;
  } | null>(null);
  const [recoverySavedConfirmed, setRecoverySavedConfirmed] = useState(false);
  const [copiedRecovery, setCopiedRecovery] = useState(false);
  const [copyRecoveryError, setCopyRecoveryError] = useState('');

  // Restore from backup during initial setup
  const [pendingRestoreBackup, setPendingRestoreBackup] = useState<EncryptedBackupFile | null>(null);
  const [restoreBackupPw, setRestoreBackupPw] = useState('');
  const [restoreNewMasterPw, setRestoreNewMasterPw] = useState('');
  const [restoreConfirmPw, setRestoreConfirmPw] = useState('');
  const [showRestorePws, setShowRestorePws] = useState(false);
  const [restoreBackupError, setRestoreBackupError] = useState('');
  const [restoreNewPwError, setRestoreNewPwError] = useState('');
  const [restoreConfirmError, setRestoreConfirmError] = useState('');
  const backupFileRef = useRef<HTMLInputElement>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    hasLocalVaultAsync().then(
      (exists) => {
        if (active) {
          setVaultExists(exists);
          setBooting(false);
        }
      },
      () => {
        if (active) setBooting(false);
      }
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!booting) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [vaultExists, mode, pendingSetup, booting, pendingRestoreBackup]);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 450);
  };

  const handleCapsCheck = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(e.getModifierState('CapsLock'));
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'password') {
      if (!password) {
        setError('Enter your master password to unlock.');
        triggerShake();
        return;
      }
      setBusy(true);
      try {
        const { payload } = await unlockVaultWithPassword(password);
        setPassword('');
        onUnlocked(payload, false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Incorrect master password.');
        triggerShake();
      } finally {
        setBusy(false);
      }
    } else {
      if (!recoveryInput.trim()) {
        setError('Enter your 24-character recovery key.');
        triggerShake();
        return;
      }
      setBusy(true);
      try {
        const { payload } = await unlockVaultWithRecoveryKey(recoveryInput);
        setRecoveryInput('');
        onUnlocked(payload, true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid recovery key.');
        triggerShake();
      } finally {
        setBusy(false);
      }
    }
  };

  const handleCreateVault = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSetupPwError('');
    setSetupConfirmError('');

    let hasErr = false;
    if ([...setupPassword].length < 8) {
      setSetupPwError('Master password must be at least 8 characters long.');
      hasErr = true;
    }
    if (setupPassword !== setupConfirm) {
      setSetupConfirmError('Master passwords do not match.');
      hasErr = true;
    }
    if (hasErr) {
      triggerShake();
      return;
    }

    setBusy(true);
    try {
      const initialPayload: VaultPayload = {
        entries: [],
        settings: { ...DEFAULT_SETTINGS, theme },
      };
      const { recoveryKey } = await createNewVault(setupPassword, initialPayload);
      setSetupPassword('');
      setSetupConfirm('');
      setPendingSetup({ payload: initialPayload, recoveryKey });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize vault.');
      triggerShake();
    } finally {
      setBusy(false);
    }
  };

  const handleBackupPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setRestoreBackupError('');
    setRestoreNewPwError('');
    setRestoreConfirmError('');
    try {
      const parsed = JSON.parse(await file.text()) as EncryptedBackupFile;
      if (parsed.app !== 'AetherVault' || parsed.format !== 'aev-backup-v1') {
        setError('Selected file is not a valid AetherVault .aevbackup file.');
        return;
      }
      setPendingRestoreBackup(parsed);
    } catch {
      setError('Could not read the selected backup file.');
    }
  };

  const handleRestoreInitialVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingRestoreBackup) return;
    setError('');
    setRestoreBackupError('');
    setRestoreNewPwError('');
    setRestoreConfirmError('');

    let hasErr = false;
    if (!restoreBackupPw) {
      setRestoreBackupError('Enter the password used when exporting this backup.');
      hasErr = true;
    }
    if ([...restoreNewMasterPw].length < 8) {
      setRestoreNewPwError('Choose a master password of at least 8 characters for this device.');
      hasErr = true;
    }
    if (restoreNewMasterPw !== restoreConfirmPw) {
      setRestoreConfirmError('New master passwords do not match.');
      hasErr = true;
    }
    if (hasErr) {
      triggerShake();
      return;
    }

    setBusy(true);
    try {
      const restored = await decryptBackupFile(pendingRestoreBackup, restoreBackupPw);
      const { recoveryKey } = await createNewVault(restoreNewMasterPw, restored);
      setPendingRestoreBackup(null);
      setRestoreBackupPw('');
      setRestoreNewMasterPw('');
      setRestoreConfirmPw('');
      setPendingSetup({ payload: restored, recoveryKey });
    } catch (err) {
      setRestoreBackupError(
        err instanceof Error ? err.message : 'Incorrect backup password.'
      );
      triggerShake();
    } finally {
      setBusy(false);
    }
  };

  const handleCopyRecovery = async () => {
    if (!pendingSetup) return;
    try {
      // Recovery keys are persistent copies: no TTL, no lock/exit
      // sweep, and kept in Windows clipboard history until the
      // user copies something else.
      await invoke('copy_persistent', { text: pendingSetup.recoveryKey });
    } catch {
      // Never report "Copied" when the clipboard write failed — the
      // user would walk away believing the key is saved when it isn't.
      setCopyRecoveryError('Could not copy — select the key above and copy it manually.');
      return;
    }
    setCopyRecoveryError('');
    setCopiedRecovery(true);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedRecovery(false), 2000);
  };

  const handleDownloadRecovery = () => {
    if (!pendingSetup) return;
    const text = [
      'AetherVault Emergency Recovery Key',
      '===================================',
      '',
      'Store this key offline in a safe place (printed or hardware-backed).',
      'It is the only way to unlock your local vault if you forget your master password.',
      '',
      `Recovery Key: ${pendingSetup.recoveryKey}`,
      `Created: ${new Date().toISOString()}`,
    ].join('\n');

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aethervault-recovery-key.txt';
    a.click();
    // Revoking immediately can cancel the download in some
    // WebView2 timings — give it a second to start.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const finishSetup = () => {
    if (!pendingSetup || !recoverySavedConfirmed) return;
    onUnlocked(pendingSetup.payload, false);
  };

  const handleResetVault = async () => {
    await clearLocalVault();
    setPassword('');
    setRecoveryInput('');
    setError('');
    setConfirmReset(false);
    setVaultExists(false);
  };

  return (
    <div className="h-full w-full flex flex-col items-center justify-start p-6 relative overflow-y-auto neu-scroll-fade">
      <div className="absolute top-5 right-5">
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="neu-btn w-11 h-11 rounded-[14px] flex items-center justify-center text-[var(--neu-text-muted)]"
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
      </div>

      {booting ? null : pendingSetup ? (
        <div className="neu-raised w-full max-w-lg rounded-[24px] p-8 space-y-6 my-auto">
          <div className="flex items-center gap-4">
            <div className="neu-inset-sm w-12 h-12 rounded-[16px] flex items-center justify-center shrink-0">
              <KeyRound className="w-6 h-6 text-[var(--neu-accent)]" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-[var(--neu-text)]">
                Save Your Recovery Key
              </h1>
              <p className="text-xs text-[var(--neu-text-muted)] mt-0.5">
                Shown once at setup · Unlocks your vault if you forget your master password
              </p>
            </div>
          </div>

          <div className="neu-inset rounded-[18px] p-5 space-y-3">
            <div className="font-mono text-sm sm:text-base font-semibold tracking-wider text-center text-[var(--neu-text)] break-all select-all">
              {pendingSetup.recoveryKey}
            </div>
            <div className="flex items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleCopyRecovery}
                className="neu-btn px-4 py-2 rounded-[12px] text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {copiedRecovery ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[var(--neu-success)]" />
                    <span className="text-[var(--neu-success)]">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Key</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleDownloadRecovery}
                className="neu-btn px-4 py-2 rounded-[12px] text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save as .txt</span>
              </button>
            </div>
            {copyRecoveryError && (
              <p role="alert" className="text-xs font-medium text-[var(--neu-danger)] text-center">
                {copyRecoveryError}
              </p>
            )}
          </div>

          <div className="flex items-start gap-3 text-xs text-[var(--neu-text-muted)] leading-relaxed">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-[var(--neu-warning)]" />
            <p>
              AetherVault runs 100% offline with zero servers or password resets. Without your master password or this recovery key, encrypted entries cannot be recovered.
            </p>
          </div>

          <NeuSwitch
            checked={recoverySavedConfirmed}
            onChange={setRecoverySavedConfirmed}
            label="I have saved my recovery key safely"
          />

          <button
            type="button"
            disabled={!recoverySavedConfirmed}
            onClick={finishSetup}
            className="neu-btn-primary w-full py-3.5 rounded-[16px] text-sm font-semibold flex items-center justify-center gap-2"
          >
            <span>Open My Vault</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      ) : pendingRestoreBackup ? (
        <form
          onSubmit={handleRestoreInitialVault}
          className={`neu-raised w-full max-w-md rounded-[24px] p-8 space-y-5 my-auto ${shake ? 'animate-neu-shake' : ''}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="neu-inset-sm w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0">
                <Upload className="w-5 h-5 text-[var(--neu-accent)]" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-[var(--neu-text)]">
                  Restore Encrypted Backup
                </h1>
                <p className="text-xs text-[var(--neu-text-muted)]">
                  Backup from {new Date(pendingRestoreBackup.exportedAt).toLocaleDateString()}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowRestorePws((v) => !v)}
              aria-label={showRestorePws ? 'Hide passwords' : 'Show passwords'}
              className="neu-btn w-9 h-9 rounded-[11px] flex items-center justify-center text-[var(--neu-text-muted)]"
            >
              {showRestorePws ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <label htmlFor="restore-bk-pw" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                Backup Decryption Password
              </label>
              <input
                ref={inputRef}
                id="restore-bk-pw"
                type={showRestorePws ? 'text' : 'password'}
                value={restoreBackupPw}
                onKeyDown={handleCapsCheck}
                onKeyUp={handleCapsCheck}
                onChange={(e) => {
                  setRestoreBackupPw(e.target.value);
                  if (restoreBackupError) setRestoreBackupError('');
                }}
                placeholder="Password used when exporting"
                className={`neu-input w-full rounded-[14px] px-4 py-3 text-sm ${
                  restoreBackupError ? 'neu-input-error' : ''
                }`}
              />
              {restoreBackupError && (
                <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                  {restoreBackupError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="restore-new-pw" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                New Device Master Password
              </label>
              <input
                id="restore-new-pw"
                type={showRestorePws ? 'text' : 'password'}
                value={restoreNewMasterPw}
                onKeyDown={handleCapsCheck}
                onKeyUp={handleCapsCheck}
                onChange={(e) => {
                  setRestoreNewMasterPw(e.target.value);
                  if (restoreNewPwError) setRestoreNewPwError('');
                }}
                placeholder="Minimum 8 characters"
                className={`neu-input w-full rounded-[14px] px-4 py-3 text-sm ${
                  restoreNewPwError ? 'neu-input-error' : ''
                }`}
              />
              {restoreNewMasterPw && <StrengthMeter password={restoreNewMasterPw} compact />}
              {restoreNewPwError && (
                <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                  {restoreNewPwError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="restore-confirm-pw" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                Confirm New Master Password
              </label>
              <input
                id="restore-confirm-pw"
                type={showRestorePws ? 'text' : 'password'}
                value={restoreConfirmPw}
                onKeyDown={handleCapsCheck}
                onKeyUp={handleCapsCheck}
                onChange={(e) => {
                  setRestoreConfirmPw(e.target.value);
                  if (restoreConfirmError) setRestoreConfirmError('');
                }}
                placeholder="Re-enter new master password"
                className={`neu-input w-full rounded-[14px] px-4 py-3 text-sm ${
                  restoreConfirmError ? 'neu-input-error' : ''
                }`}
              />
              {capsLockOn && (
                <p className="text-xs font-medium text-[var(--neu-warning)]">
                  Caps Lock is on
                </p>
              )}
              {restoreConfirmError && (
                <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                  {restoreConfirmError}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                setPendingRestoreBackup(null);
                setRestoreBackupPw('');
                setRestoreNewMasterPw('');
                setRestoreConfirmPw('');
                setRestoreBackupError('');
                setRestoreNewPwError('');
                setRestoreConfirmError('');
                setError('');
              }}
              disabled={busy}
              className="neu-btn px-4 py-2.5 rounded-[14px] text-xs font-semibold"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={busy || !restoreBackupPw || !restoreNewMasterPw || !restoreConfirmPw}
              className="neu-btn-primary px-5 py-2.5 rounded-[14px] text-xs font-semibold flex items-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Decrypt & Restore</span>
            </button>
          </div>
        </form>
      ) : !vaultExists ? (
        <form
          onSubmit={handleCreateVault}
          className={`neu-raised w-full max-w-md rounded-[24px] p-8 space-y-6 my-auto ${shake ? 'animate-neu-shake' : ''}`}
        >
          <div className="flex flex-col items-center text-center space-y-3">
            <NeumorphicLogo size="lg" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--neu-text)]">
                AetherVault
              </h1>
              <p className="text-xs text-[var(--neu-text-muted)] mt-1">
                Create a local encrypted vault · Offline & zero-knowledge
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="setup-pw" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                Master Password
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  id="setup-pw"
                  type={showSetupPw ? 'text' : 'password'}
                  value={setupPassword}
                  onKeyDown={handleCapsCheck}
                onKeyUp={handleCapsCheck}
                  onChange={(e) => {
                    setSetupPassword(e.target.value);
                    if (setupPwError) setSetupPwError('');
                  }}
                  placeholder="Minimum 8 characters"
                  className={`neu-input w-full rounded-[15px] px-4 py-3 pr-11 text-sm ${
                    setupPwError ? 'neu-input-error' : ''
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowSetupPw((v) => !v)}
                  aria-label={showSetupPw ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-[10px] flex items-center justify-center text-[var(--neu-text-muted)]"
                >
                  {showSetupPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {setupPwError && (
                <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                  {setupPwError}
                </p>
              )}
              <StrengthMeter password={setupPassword} />
            </div>

            <div className="space-y-2">
              <label htmlFor="setup-confirm" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                Confirm Master Password
              </label>
              <input
                id="setup-confirm"
                type={showSetupPw ? 'text' : 'password'}
                value={setupConfirm}
                onKeyDown={handleCapsCheck}
                onKeyUp={handleCapsCheck}
                onChange={(e) => {
                  setSetupConfirm(e.target.value);
                  if (setupConfirmError) setSetupConfirmError('');
                }}
                placeholder="Re-enter master password"
                className={`neu-input w-full rounded-[15px] px-4 py-3 text-sm ${
                  setupConfirmError ? 'neu-input-error' : ''
                }`}
              />
              {capsLockOn && (
                <p className="text-xs font-medium text-[var(--neu-warning)]">
                  Caps Lock is on
                </p>
              )}
              {setupConfirmError && (
                <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                  {setupConfirmError}
                </p>
              )}
              {error && (
                <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                  {error}
                </p>
              )}
            </div>

          </div>

          <button
            type="submit"
            disabled={busy || !setupPassword || !setupConfirm}
            className="neu-btn-primary w-full py-3.5 rounded-[16px] text-sm font-semibold flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Encrypting Vault...</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                <span>Create Encrypted Vault</span>
              </>
            )}
          </button>

          <div className="flex justify-center">
            <input
              ref={backupFileRef}
              type="file"
              accept=".aevbackup,.json"
              onChange={handleBackupPicked}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => backupFileRef.current?.click()}
              className="text-xs font-medium text-[var(--neu-text-muted)] hover:text-[var(--neu-accent)] flex items-center gap-1.5 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Restore from .aevbackup file</span>
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={handleUnlock}
          className={`neu-raised w-full max-w-md rounded-[24px] p-8 space-y-6 my-auto ${shake ? 'animate-neu-shake' : ''}`}
        >
          <div className="flex flex-col items-center text-center space-y-3">
            <NeumorphicLogo size="lg" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--neu-text)]">
                AetherVault
              </h1>
              <p className="text-xs text-[var(--neu-text-muted)] mt-1">
                {mode === 'password'
                  ? 'Enter your master password to unlock'
                  : 'Enter your one-time recovery key'}
              </p>
            </div>
          </div>

          {mode === 'password' ? (
            <div className="space-y-2">
              <label htmlFor="unlock-password" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                Master Password
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  id="unlock-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onKeyDown={handleCapsCheck}
                onKeyUp={handleCapsCheck}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="Enter master password"
                  autoComplete="current-password"
                  className={`neu-input w-full rounded-[15px] px-4 py-3.5 pr-11 text-sm ${error ? 'neu-input-error' : ''}`}
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
                <p className="text-xs font-medium text-[var(--neu-danger)] pt-0.5" role="alert">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="unlock-recovery" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                Recovery Key
              </label>
              <input
                ref={inputRef}
                id="unlock-recovery"
                type="text"
                value={recoveryInput}
                onChange={(e) => {
                  setRecoveryInput(formatRecoveryKeyInput(e.target.value));
                  if (error) setError('');
                }}
                placeholder="AEV-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                spellCheck={false}
                autoComplete="off"
                className={`neu-input w-full rounded-[15px] px-4 py-3.5 font-mono text-sm ${error ? 'neu-input-error' : ''}`}
              />
              {error && (
                <p className="text-xs font-medium text-[var(--neu-danger)] pt-0.5" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || (mode === 'password' ? !password : !recoveryInput.trim())}
            className="neu-btn-primary w-full py-3.5 rounded-[16px] text-sm font-semibold flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Decrypting...</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                <span>Unlock Vault</span>
              </>
            )}
          </button>

          <div className="flex flex-col items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                setMode((m) => (m === 'password' ? 'recovery' : 'password'));
                setError('');
              }}
              className="text-xs font-medium text-[var(--neu-text-muted)] hover:text-[var(--neu-accent)] transition-colors flex items-center gap-1.5"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>
                {mode === 'password'
                  ? 'Use Recovery Key instead'
                  : 'Back to Master Password'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="text-[11px] text-[var(--neu-text-subtle)] hover:text-[var(--neu-danger)] transition-colors"
            >
              Reset local vault
            </button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={confirmReset}
        destructive
        title="Reset Local Vault?"
        description="This permanently erases the encrypted vault on this device so you can start fresh. Existing encrypted entries cannot be recovered unless you exported a backup."
        confirmLabel="Erase & Start Fresh"
        onCancel={() => setConfirmReset(false)}
        onConfirm={handleResetVault}
      />

      {/* Creator watermark */}
      <div className="mt-auto pt-6 shrink-0">
        <CreatorLinks onError={onOpenLinkError} />
      </div>
    </div>
  );
};
