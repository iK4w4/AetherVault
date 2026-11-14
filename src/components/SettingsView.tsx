import React, { useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileUp,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Shield,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  changeMasterPassword,
  createEncryptedBackup,
  decryptBackupFile,
  EncryptedBackupFile,
  regenerateRecoveryKey,
} from '../utils/crypto';
import { import1PasswordData, importBitwardenData } from '../utils/importers';
import { VaultEntry, VaultSettings } from '../types/vault';
import { ConfirmDialog, MasterPasswordPrompt } from './ConfirmDialog';
import { NeuCheckbox } from './NeuCheckbox';
import { NeuSelect } from './NeuSelect';
import { StrengthMeter } from './StrengthMeter';

interface SettingsViewProps {
  entries: VaultEntry[];
  settings: VaultSettings;
  unlockedViaRecovery: boolean;
  onUpdateSettings: (patch: Partial<VaultSettings>) => Promise<void>;
  onImportEntries: (imported: VaultEntry[], mode: 'merge' | 'replace') => Promise<void>;
  onWipeVault: () => void;
  onMasterPasswordChanged: () => void;
  onNotify: (message: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  entries,
  settings,
  unlockedViaRecovery,
  onUpdateSettings,
  onImportEntries,
  onWipeVault,
  onMasterPasswordChanged,
  onNotify,
}) => {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPws, setShowPws] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [currentPwError, setCurrentPwError] = useState('');
  const [newPwError, setNewPwError] = useState('');
  const [confirmPwError, setConfirmPwError] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const [askPwForRecovery, setAskPwForRecovery] = useState(false);
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null);
  const [copiedRecovery, setCopiedRecovery] = useState(false);
  const [copyRecoveryError, setCopyRecoveryError] = useState('');

  const [backupExportPw, setBackupExportPw] = useState('');
  const [showBackupExportPw, setShowBackupExportPw] = useState(false);
  const [backupExportError, setBackupExportError] = useState('');
  const [backupExportBusy, setBackupExportBusy] = useState(false);

  const [pendingBackupData, setPendingBackupData] = useState<EncryptedBackupFile | null>(null);
  const [backupRestorePw, setBackupRestorePw] = useState('');
  const [showBackupRestorePw, setShowBackupRestorePw] = useState(false);
  const [backupRestoreError, setBackupRestoreError] = useState('');
  const [backupRestoreBusy, setBackupRestoreBusy] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const [importSource, setImportSource] = useState<'bitwarden' | '1password' | null>(null);
  const [pasteMode, setPasteMode] = useState<'bitwarden' | '1password' | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [importPreview, setImportPreview] = useState<{
    source: 'bitwarden' | '1password';
    items: VaultEntry[];
  } | null>(null);
  const [skipDuplicateImports, setSkipDuplicateImports] = useState(true);
  const [importError, setImportError] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const thirdPartyInputRef = useRef<HTMLInputElement>(null);

  const [confirmWipe, setConfirmWipe] = useState(false);

  const handleChangeMasterPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPwError('');
    setNewPwError('');
    setConfirmPwError('');
    setPwError('');
    setPwSuccess('');

    let hasErr = false;
    if (!unlockedViaRecovery && !currentPw) {
      setCurrentPwError('Enter your current master password.');
      hasErr = true;
    }
    if (newPw.length < 8) {
      setNewPwError('New master password must be at least 8 characters.');
      hasErr = true;
    }
    if (newPw !== confirmPw) {
      setConfirmPwError('New passwords do not match.');
      hasErr = true;
    }
    if (hasErr) return;

    setPwBusy(true);
    try {
      await changeMasterPassword(
        unlockedViaRecovery ? '' : currentPw,
        newPw,
        unlockedViaRecovery
      );
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setPwSuccess('Master password updated and vault key re-encrypted.');
      onMasterPasswordChanged();
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Failed to change master password.');
    } finally {
      setPwBusy(false);
    }
  };

  const handleExportEncryptedBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBackupExportError('');
    if (backupExportPw.length < 6) {
      setBackupExportError('Choose a backup password of at least 6 characters.');
      return;
    }
    setBackupExportBusy(true);
    try {
      const now = Date.now();
      const backupObj = await createEncryptedBackup(backupExportPw);
      const blob = new Blob([JSON.stringify(backupObj, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aethervault-backup-${new Date().toISOString().slice(0, 10)}.aevbackup`;
      a.click();
      // Revoking immediately can cancel the download in some
      // WebView2 timings — give it a second to start.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBackupExportPw('');
      await onUpdateSettings({ lastBackupAt: now });
      onNotify('Encrypted backup downloaded.');
    } catch (err) {
      setBackupExportError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBackupExportBusy(false);
    }
  };

  const handleBackupFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBackupRestoreError('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as EncryptedBackupFile;
      if (parsed.app !== 'AetherVault' || parsed.format !== 'aev-backup-v1') {
        setBackupRestoreError('Not a valid AetherVault .aevbackup file.');
        return;
      }
      setPendingBackupData(parsed);
      setBackupRestorePw('');
    } catch {
      setBackupRestoreError('Could not read backup file.');
    }
  };

  const handleRestoreBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingBackupData) return;
    setBackupRestoreError('');
    setBackupRestoreBusy(true);
    try {
      const restored = await decryptBackupFile(pendingBackupData, backupRestorePw);
      await onImportEntries(restored.entries || [], 'merge');
      setPendingBackupData(null);
      setBackupRestorePw('');
      onNotify(`Restored ${restored.entries?.length || 0} entries from encrypted backup.`);
    } catch (err) {
      setBackupRestoreError(
        err instanceof Error ? err.message : 'Incorrect backup password.'
      );
    } finally {
      setBackupRestoreBusy(false);
    }
  };

  const parseThirdPartyText = (source: 'bitwarden' | '1password', text: string) => {
    const parsed =
      source === 'bitwarden' ? importBitwardenData(text) : import1PasswordData(text);
    if (parsed.length === 0) {
      setImportError('No importable entries found.');
      return;
    }
    setImportPreview({ source, items: parsed });
    setPasteMode(null);
    setPasteText('');
  };

  const handleThirdPartyFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !importSource) return;
    setImportError('');
    setImportBusy(true);
    try {
      const text = await file.text();
      parseThirdPartyText(importSource, text);
      setImportSource(null);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Could not parse the selected export file.'
      );
    } finally {
      setImportBusy(false);
    }
  };

  const handleParsePasted = () => {
    if (!pasteMode || !pasteText.trim()) return;
    setImportError('');
    try {
      parseThirdPartyText(pasteMode, pasteText);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not parse pasted export text.');
    }
  };

  const confirmImportPreview = async () => {
    if (!importPreview) return;
    setImportBusy(true);
    try {
      let itemsToImport = importPreview.items;
      let skippedCount = 0;
      if (skipDuplicateImports) {
        const existingKeys = new Set(
          entries
            .filter((e) => !e.trashedAt)
            .map((e) => `${e.category}|${e.title.trim().toLowerCase()}|${(e.username || '').trim().toLowerCase()}`)
        );
        const filtered: VaultEntry[] = [];
        for (const item of importPreview.items) {
          const key = `${item.category}|${item.title.trim().toLowerCase()}|${(item.username || '').trim().toLowerCase()}`;
          if (existingKeys.has(key)) {
            skippedCount++;
          } else {
            existingKeys.add(key);
            filtered.push(item);
          }
        }
        itemsToImport = filtered;
      }

      if (itemsToImport.length > 0) {
        await onImportEntries(itemsToImport, 'merge');
      }
      onNotify(
        itemsToImport.length > 0
          ? `Imported ${itemsToImport.length} ${
              itemsToImport.length === 1 ? 'entry' : 'entries'
            } from ${importPreview.source === 'bitwarden' ? 'Bitwarden' : '1Password'}${
              skippedCount > 0 ? ` (${skippedCount} duplicate skipped)` : ''
            }.`
          : `All ${skippedCount} entries were already in your vault.`
      );
      setImportPreview(null);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Could not import the selected entries.'
      );
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div className="flex-1 h-full overflow-y-auto pr-1 neu-scroll-fade">
      <div className="max-w-3xl mx-auto space-y-6 pt-3 pb-10">
        {/* Security Section */}
        <section className="neu-raised rounded-[22px] p-6 lg:p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="neu-inset-sm w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-[var(--neu-accent)]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--neu-text)]">Security</h2>
              <p className="text-xs text-[var(--neu-text-muted)]">
                Master password, recovery key, and automatic locking
              </p>
            </div>
          </div>

          <form onSubmit={handleChangeMasterPassword} className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--neu-text)]">
                {unlockedViaRecovery ? 'Set New Master Password' : 'Change Master Password'}
              </h3>
              <button
                type="button"
                onClick={() => setShowPws((v) => !v)}
                className="text-xs font-medium text-[var(--neu-text-muted)] hover:text-[var(--neu-text)] flex items-center gap-1"
              >
                {showPws ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showPws ? 'Hide' : 'Show'}</span>
              </button>
            </div>

            {!unlockedViaRecovery && (
              <div className="space-y-1.5">
                <label htmlFor="settings-current-pw" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                  Current Master Password
                </label>
                <input
                  id="settings-current-pw"
                  type={showPws ? 'text' : 'password'}
                  value={currentPw}
                  onKeyDown={(e) => setCapsLockOn(e.getModifierState('CapsLock'))}
                  onKeyUp={(e) => setCapsLockOn(e.getModifierState('CapsLock'))}
                  onChange={(e) => {
                    setCurrentPw(e.target.value);
                    if (currentPwError) setCurrentPwError('');
                    if (pwError) setPwError('');
                  }}
                  placeholder="Enter current master password"
                  className={`neu-input w-full rounded-[14px] px-4 py-3 text-sm ${
                    currentPwError ? 'neu-input-error' : ''
                  }`}
                />
                {currentPwError && (
                  <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                    {currentPwError}
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="settings-new-pw" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                  New Master Password
                </label>
                <input
                  id="settings-new-pw"
                  type={showPws ? 'text' : 'password'}
                  value={newPw}
                  onKeyDown={(e) => setCapsLockOn(e.getModifierState('CapsLock'))}
                  onKeyUp={(e) => setCapsLockOn(e.getModifierState('CapsLock'))}
                  onChange={(e) => {
                    setNewPw(e.target.value);
                    if (newPwError) setNewPwError('');
                    if (pwError) setPwError('');
                  }}
                  placeholder="Minimum 8 characters"
                  className={`neu-input w-full rounded-[14px] px-4 py-3 text-sm ${
                    newPwError ? 'neu-input-error' : ''
                  }`}
                />
                {newPwError && (
                  <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                    {newPwError}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="settings-confirm-pw" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                  Confirm New Password
                </label>
                <input
                  id="settings-confirm-pw"
                  type={showPws ? 'text' : 'password'}
                  value={confirmPw}
                  onKeyDown={(e) => setCapsLockOn(e.getModifierState('CapsLock'))}
                  onKeyUp={(e) => setCapsLockOn(e.getModifierState('CapsLock'))}
                  onChange={(e) => {
                    setConfirmPw(e.target.value);
                    if (confirmPwError) setConfirmPwError('');
                    if (pwError) setPwError('');
                  }}
                  placeholder="Re-enter new password"
                  className={`neu-input w-full rounded-[14px] px-4 py-3 text-sm ${
                    confirmPwError ? 'neu-input-error' : ''
                  }`}
                />
                {confirmPwError && (
                  <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                    {confirmPwError}
                  </p>
                )}
              </div>
            </div>

            {capsLockOn && (
              <p className="text-xs font-medium text-[var(--neu-warning)]">
                Caps Lock is on
              </p>
            )}

            {newPw && <StrengthMeter password={newPw} />}

            {pwError && (
              <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                {pwError}
              </p>
            )}
            {pwSuccess && (
              <p className="text-xs font-medium text-[var(--neu-success)]">{pwSuccess}</p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={pwBusy || !newPw || !confirmPw}
                className="neu-btn-primary px-5 py-2.5 rounded-[14px] text-xs font-semibold flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                {pwBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Update Master Password</span>
              </button>
            </div>
          </form>

          <div className="border-t border-[var(--neu-divider)] pt-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--neu-text)] flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-[var(--neu-accent)]" />
                  <span>Emergency Recovery Key</span>
                </h3>
                <p className="text-xs text-[var(--neu-text-muted)] mt-0.5">
                  Rotates and replaces your previous recovery key immediately.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAskPwForRecovery(true)}
                className="neu-btn px-4 py-2.5 rounded-[13px] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Regenerate Recovery Key</span>
              </button>
            </div>

            {newRecoveryKey && (
              <div className="neu-inset rounded-[16px] p-4 space-y-2.5">
                <div className="text-xs font-medium text-[var(--neu-warning)]">
                  New Recovery Key — copy and store safely offline:
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <code className="font-mono text-sm font-semibold text-[var(--neu-text)] select-all">
                    {newRecoveryKey}
                  </code>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          // Recovery keys are persistent copies: no
                          // TTL, no lock/exit sweep, kept in Windows
                          // clipboard history until overwritten.
                          await invoke('copy_persistent', { text: newRecoveryKey });
                        } catch {
                          // Never report "Copied" when the clipboard
                          // write failed.
                          setCopyRecoveryError(
                            'Could not copy — select the key and copy it manually.'
                          );
                          return;
                        }
                        setCopyRecoveryError('');
                        setCopiedRecovery(true);
                        setTimeout(() => setCopiedRecovery(false), 1800);
                      }}
                      className="neu-btn px-3 py-1.5 rounded-[10px] text-xs font-medium flex items-center gap-1.5"
                    >
                      {copiedRecovery ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[var(--neu-success)]" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const text = [
                          'AetherVault Emergency Recovery Key',
                          '===================================',
                          '',
                          'Store this key offline in a safe place (printed or hardware-backed).',
                          'It replaces any previous recovery key for this local vault.',
                          '',
                          `Recovery Key: ${newRecoveryKey}`,
                          `Rotated: ${new Date().toISOString()}`,
                        ].join('\n');
                        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'aethervault-recovery-key.txt';
                        a.click();
                        // Revoking immediately can cancel the download
                        // in some WebView2 timings.
                        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                      }}
                      className="neu-btn px-3 py-1.5 rounded-[10px] text-xs font-medium flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Save .txt</span>
                    </button>
                  </div>
                </div>
                {copyRecoveryError && (
                  <p role="alert" className="text-xs font-medium text-[var(--neu-danger)]">
                    {copyRecoveryError}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-[var(--neu-divider)] pt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="autolock-select" className="block text-xs font-semibold text-[var(--neu-text)]">
                Auto-Lock After Inactivity
              </label>
              <NeuSelect
                id="autolock-select"
                value={settings.autoLockMinutes}
                options={[
                  { value: 1, label: '1 minute' },
                  { value: 5, label: '5 minutes' },
                  { value: 15, label: '15 minutes' },
                  { value: 30, label: '30 minutes' },
                  { value: 0, label: 'Never (manual lock only)' },
                ]}
                onChange={(v) => void onUpdateSettings({ autoLockMinutes: Number(v) })}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="clipboard-select" className="block text-xs font-semibold text-[var(--neu-text)]">
                Clear Clipboard After Copy
              </label>
              <NeuSelect
                id="clipboard-select"
                value={settings.clipboardClearSeconds}
                options={[
                  { value: 10, label: '10 seconds' },
                  { value: 20, label: '20 seconds (Default)' },
                  { value: 30, label: '30 seconds' },
                  { value: 60, label: '60 seconds' },
                ]}
                onChange={(v) => void onUpdateSettings({ clipboardClearSeconds: Number(v) })}
              />
            </div>
          </div>
        </section>

        {/* Appearance Section */}
        <section className="neu-raised rounded-[22px] p-6 lg:p-8 space-y-5">
          <div className="flex items-center gap-3">
            <div className="neu-inset-sm w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0">
              <Palette className="w-5 h-5 text-[var(--neu-accent)]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--neu-text)]">Appearance</h2>
              <p className="text-xs text-[var(--neu-text-muted)]">
                Tactile surface theme and interface scale
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <span className="block text-xs font-semibold text-[var(--neu-text)]">Theme</span>
              <div className="neu-inset-sm p-1.5 rounded-[15px] grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => void onUpdateSettings({ theme: 'light' })}
                  className={`py-2.5 rounded-[11px] text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                    settings.theme === 'light'
                      ? 'neu-raised-xs text-[var(--neu-accent)]'
                      : 'text-[var(--neu-text-muted)]'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" />
                  <span>Soft Light</span>
                </button>
                <button
                  type="button"
                  onClick={() => void onUpdateSettings({ theme: 'dark' })}
                  className={`py-2.5 rounded-[11px] text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                    settings.theme === 'dark'
                      ? 'neu-raised-xs text-[var(--neu-accent)]'
                      : 'text-[var(--neu-text-muted)]'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" />
                  <span>Soft Dark</span>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-semibold text-[var(--neu-text)] flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5 text-[var(--neu-text-muted)]" />
                <span>Interface Zoom</span>
              </span>
              <div className="neu-inset-sm p-1.5 rounded-[15px] grid grid-cols-4 gap-1">
                {[0.9, 1, 1.1, 1.2].map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => void onUpdateSettings({ zoom: z })}
                    className={`py-2.5 rounded-[11px] font-mono text-xs font-semibold transition-all ${
                      settings.zoom === z
                        ? 'neu-raised-xs text-[var(--neu-accent)]'
                        : 'text-[var(--neu-text-muted)]'
                    }`}
                  >
                    {Math.round(z * 100)}%
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Backup & Import/Export Section */}
        <section className="neu-raised rounded-[22px] p-6 lg:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="neu-inset-sm w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0">
                <FileUp className="w-5 h-5 text-[var(--neu-accent)]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--neu-text)]">
                  Backup & Import
                </h2>
                <p className="text-xs text-[var(--neu-text-muted)]">
                  Encrypted offline backups and migration from Bitwarden or 1Password
                </p>
              </div>
            </div>
            {settings.lastBackupAt && (
              <span className="text-xs text-[var(--neu-text-muted)] font-mono">
                Last backup: {new Date(settings.lastBackupAt).toLocaleDateString()}
              </span>
            )}
          </div>

          <form onSubmit={handleExportEncryptedBackup} className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--neu-text)]">
              Export Encrypted Backup (.aevbackup)
            </h3>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <input
                  type={showBackupExportPw ? 'text' : 'password'}
                  value={backupExportPw}
                  onChange={(e) => {
                    setBackupExportPw(e.target.value);
                    setBackupExportError('');
                  }}
                  placeholder="Choose backup encryption password"
                  className={`neu-input w-full rounded-[14px] px-4 py-2.5 pr-10 text-sm ${
                    backupExportError ? 'neu-input-error' : ''
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowBackupExportPw((v) => !v)}
                  aria-label={showBackupExportPw ? 'Hide backup password' : 'Show backup password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-[10px] flex items-center justify-center text-[var(--neu-text-muted)]"
                >
                  {showBackupExportPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                type="submit"
                disabled={backupExportBusy || !backupExportPw}
                className="neu-btn px-5 py-2.5 rounded-[14px] text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
              >
                {backupExportBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 text-[var(--neu-accent)]" />
                )}
                <span>Export Backup</span>
              </button>
            </div>
            {backupExportError && (
              <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                {backupExportError}
              </p>
            )}
          </form>

          <div className="border-t border-[var(--neu-divider)] pt-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--neu-text)]">
                  Restore Encrypted Backup
                </h3>
                <p className="text-xs text-[var(--neu-text-muted)]">
                  Decrypts and merges entries from a previous .aevbackup file
                </p>
              </div>
              <input
                ref={backupInputRef}
                type="file"
                accept=".aevbackup,.json"
                onChange={handleBackupFileSelected}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => backupInputRef.current?.click()}
                className="neu-btn px-4 py-2.5 rounded-[13px] text-xs font-semibold flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <Upload className="w-4 h-4 text-[var(--neu-accent)]" />
                <span>Choose .aevbackup File</span>
              </button>
            </div>

            {pendingBackupData && (
              <form onSubmit={handleRestoreBackup} className="neu-inset-sm rounded-[16px] p-4 space-y-3">
                <div className="text-xs font-medium text-[var(--neu-text)]">
                  Backup from {new Date(pendingBackupData.exportedAt).toLocaleString()} — enter backup password:
                </div>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <input
                      type={showBackupRestorePw ? 'text' : 'password'}
                      value={backupRestorePw}
                      onChange={(e) => {
                        setBackupRestorePw(e.target.value);
                        setBackupRestoreError('');
                      }}
                      placeholder="Backup password"
                      className={`neu-input w-full rounded-[12px] px-3.5 py-2 pr-9 text-sm ${
                        backupRestoreError ? 'neu-input-error' : ''
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowBackupRestorePw((v) => !v)}
                      aria-label={showBackupRestorePw ? 'Hide backup password' : 'Show backup password'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-[9px] flex items-center justify-center text-[var(--neu-text-muted)]"
                    >
                      {showBackupRestorePw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <button
                    type="submit"
                    disabled={backupRestoreBusy || !backupRestorePw}
                    className="neu-btn-primary px-4 py-2 rounded-[12px] text-xs font-semibold whitespace-nowrap shrink-0"
                  >
                    {backupRestoreBusy ? 'Decrypting...' : 'Restore Entries'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingBackupData(null);
                      setBackupRestorePw('');
                      setBackupRestoreError('');
                    }}
                    className="neu-btn px-3 py-2 rounded-[12px] text-xs font-medium"
                  >
                    Cancel
                  </button>
                </div>
                {backupRestoreError && (
                  <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                    {backupRestoreError}
                  </p>
                )}
              </form>
            )}
            {!pendingBackupData && backupRestoreError && (
              <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                {backupRestoreError}
              </p>
            )}
          </div>

          <div className="border-t border-[var(--neu-divider)] pt-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--neu-text)]">
                Import from Bitwarden or 1Password
              </h3>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setPasteMode(pasteMode === 'bitwarden' ? null : 'bitwarden');
                    setImportError('');
                  }}
                  className="text-[var(--neu-accent)] hover:underline font-medium"
                >
                  Paste Bitwarden text
                </button>
                <span aria-hidden="true" className="text-[var(--neu-text-subtle)]">·</span>
                <button
                  type="button"
                  onClick={() => {
                    setPasteMode(pasteMode === '1password' ? null : '1password');
                    setImportError('');
                  }}
                  className="text-[var(--neu-accent)] hover:underline font-medium"
                >
                  Paste 1Password text
                </button>
              </div>
            </div>

            <input
              ref={thirdPartyInputRef}
              type="file"
              accept=".json,.csv,.1pux"
              onChange={handleThirdPartyFile}
              className="hidden"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                disabled={importBusy}
                onClick={() => {
                  setImportSource('bitwarden');
                  setImportError('');
                  thirdPartyInputRef.current?.click();
                }}
                className="neu-btn px-4 py-3 rounded-[14px] text-xs font-semibold flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4 text-[var(--neu-accent)]" />
                <span>Upload Bitwarden (JSON / CSV)</span>
              </button>
              <button
                type="button"
                disabled={importBusy}
                onClick={() => {
                  setImportSource('1password');
                  setImportError('');
                  thirdPartyInputRef.current?.click();
                }}
                className="neu-btn px-4 py-3 rounded-[14px] text-xs font-semibold flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4 text-[var(--neu-accent)]" />
                <span>Upload 1Password (JSON / CSV)</span>
              </button>
            </div>

            {pasteMode && (
              <div className="neu-inset-sm rounded-[16px] p-4 space-y-3">
                <div className="text-xs font-semibold text-[var(--neu-text)]">
                  Paste {pasteMode === 'bitwarden' ? 'Bitwarden' : '1Password'} JSON or CSV export
                </div>
                <textarea
                  rows={4}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="Paste exported JSON or CSV contents here..."
                  spellCheck={false}
                  autoComplete="off"
                  className="neu-input w-full rounded-[12px] p-3 font-mono text-xs"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPasteMode(null);
                      setPasteText('');
                    }}
                    className="neu-btn px-3.5 py-1.5 rounded-[10px] text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!pasteText.trim()}
                    onClick={handleParsePasted}
                    className="neu-btn-primary px-4 py-1.5 rounded-[10px] text-xs font-semibold"
                  >
                    Preview Import
                  </button>
                </div>
              </div>
            )}

            {importPreview && (
              <div className="neu-inset-sm rounded-[16px] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs space-y-0.5">
                    <div className="font-semibold text-[var(--neu-text)]">
                      Ready to import {importPreview.items.length} items from{' '}
                      {importPreview.source === 'bitwarden' ? 'Bitwarden' : '1Password'}
                    </div>
                    <div className="text-[var(--neu-text-muted)]">
                      Logins: {importPreview.items.filter((i) => i.category === 'login').length} · Cards:{' '}
                      {importPreview.items.filter((i) => i.category === 'card').length} · Notes:{' '}
                      {importPreview.items.filter((i) => i.category === 'note').length} · Identities:{' '}
                      {importPreview.items.filter((i) => i.category === 'identity').length}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setImportPreview(null)}
                      disabled={importBusy}
                      className="neu-btn px-3.5 py-2 rounded-[11px] text-xs font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={confirmImportPreview}
                      disabled={importBusy}
                      className="neu-btn-primary px-4 py-2 rounded-[11px] text-xs font-semibold"
                    >
                      {importBusy ? 'Importing...' : 'Confirm Import'}
                    </button>
                  </div>
                </div>
                <NeuCheckbox
                  checked={skipDuplicateImports}
                  onChange={setSkipDuplicateImports}
                  label="Skip entries that already exist in your vault (matching title & username)"
                />
              </div>
            )}

            {importError && (
              <p className="text-xs font-medium text-[var(--neu-danger)]" role="alert">
                {importError}
              </p>
            )}
          </div>

          <div className="border-t border-[var(--neu-divider)] pt-5 flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setConfirmWipe(true)}
              className="neu-btn px-4 py-2.5 rounded-[13px] text-xs font-semibold flex items-center gap-1.5"
              style={{ color: 'var(--neu-danger)' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Erase Local Vault</span>
            </button>
          </div>
        </section>
      </div>

      <MasterPasswordPrompt
        open={askPwForRecovery}
        title="Verify Master Password"
        description="Confirm your master password before generating a new recovery key."
        actionLabel="Generate Key"
        allowRecoveryFallback={unlockedViaRecovery}
        onCancel={() => setAskPwForRecovery(false)}
        onVerified={async () => {
          const key = await regenerateRecoveryKey();
          setNewRecoveryKey(key);
          setAskPwForRecovery(false);
          onNotify('Recovery key rotated.');
        }}
      />

      <ConfirmDialog
        open={confirmWipe}
        destructive
        title="Erase Local Vault?"
        description="This permanently deletes all encrypted entries and keys stored on this device. Export a backup first if you want to keep your data."
        confirmLabel="Erase Everything"
        onCancel={() => setConfirmWipe(false)}
        onConfirm={() => {
          setConfirmWipe(false);
          onWipeVault();
        }}
      />
    </div>
  );
};
