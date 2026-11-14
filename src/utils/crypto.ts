import { invoke } from '@tauri-apps/api/core';
import { VaultPayload, VaultSettings } from '../types/vault';

export const DEFAULT_SETTINGS: VaultSettings = {
  theme: 'light',
  zoom: 1,
  autoLockMinutes: 5,
  clipboardClearSeconds: 20,
};

/**
 * Thin invoke wrapper: Rust commands throw plain strings on error, so
 * rethrow as Error to keep every existing `err instanceof Error` call site
 * surfacing the real backend message.
 */
async function invokeCmd<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error(typeof err === 'string' ? err : 'Vault operation failed.');
  }
}

export function formatRecoveryKeyInput(raw: string): string {
  const upper = raw.toUpperCase();
  const clean = upper.replace(/[^A-Z0-9]/g, '');
  if (!clean) return '';
  if (clean === 'A' || clean === 'AE' || clean === 'AEV') {
    return clean;
  }
  const hasPrefix =
    upper.trimStart().startsWith('AEV-') ||
    clean.length > 24 ||
    (clean.startsWith('AEV') && clean.length !== 24);
  const body = hasPrefix && clean.startsWith('AEV') ? clean.slice(3) : clean;
  const chunks = body.slice(0, 24).match(/.{1,4}/g) || [];
  return chunks.length > 0 ? `AEV-${chunks.join('-')}` : '';
}

export async function hasLocalVaultAsync(): Promise<boolean> {
  return invokeCmd<boolean>('vault_exists');
}

export async function createNewVault(
  masterPassword: string,
  initialPayload: VaultPayload
): Promise<{ recoveryKey: string }> {
  const { recovery_key } = await invokeCmd<{ recovery_key: string }>('create_vault', {
    password: masterPassword,
  });
  try {
    await invokeCmd('save_vault', { payload: initialPayload });
  } catch (err) {
    // Creation is two steps on the backend: if the initial payload
    // never lands, the vault on disk is the empty default — and its
    // recovery key was never shown. Erase it so the user can retry
    // instead of being stranded with an unusable vault.
    try {
      await invokeCmd('erase_vault');
    } catch {
      // Best effort only; the original error is the one to surface.
    }
    throw err;
  }
  return { recoveryKey: recovery_key };
}

export async function unlockVaultWithPassword(
  masterPassword: string
): Promise<{ payload: VaultPayload }> {
  const payload = await invokeCmd<VaultPayload>('unlock_vault', {
    password: masterPassword,
  });
  return { payload };
}

export async function unlockVaultWithRecoveryKey(
  recoveryKeyInput: string
): Promise<{ payload: VaultPayload }> {
  const payload = await invokeCmd<VaultPayload>('unlock_with_recovery_key', {
    key: recoveryKeyInput,
  });
  return { payload };
}

export async function verifyMasterPassword(masterPassword: string): Promise<boolean> {
  return invokeCmd<boolean>('verify_master_password', { password: masterPassword });
}

export async function verifyRecoveryKey(recoveryKeyInput: string): Promise<boolean> {
  return invokeCmd<boolean>('verify_recovery_key', { key: recoveryKeyInput });
}

export async function persistVaultPayload(payload: VaultPayload): Promise<void> {
  await invokeCmd('save_vault', { payload });
}

export async function changeMasterPassword(
  currentPassword: string,
  newMasterPassword: string,
  viaRecovery: boolean
): Promise<void> {
  await invokeCmd('change_password', {
    current: currentPassword,
    newPassword: newMasterPassword,
    viaRecovery: viaRecovery,
  });
}

export async function regenerateRecoveryKey(): Promise<string> {
  return invokeCmd<string>('regenerate_recovery_key');
}

export interface EncryptedBackupFile {
  app: 'AetherVault';
  format: 'aev-backup-v1';
  exportedAt: string;
  salt: string;
  iv: string;
  ciphertext: string;
}

/**
 * Exports the session's last-saved vault via the Rust backend. The backup
 * password encrypts the vault in Rust; the returned JSON string is parsed
 * into the same EncryptedBackupFile shape the UI already handles.
 */
export async function createEncryptedBackup(
  backupPassword: string
): Promise<EncryptedBackupFile> {
  const json = await invokeCmd<string>('export_backup', { password: backupPassword });
  return JSON.parse(json) as EncryptedBackupFile;
}

export async function decryptBackupFile(
  backup: EncryptedBackupFile,
  backupPassword: string
): Promise<VaultPayload> {
  if (
    backup.app !== 'AetherVault' ||
    backup.format !== 'aev-backup-v1' ||
    !backup.salt ||
    !backup.iv ||
    !backup.ciphertext
  ) {
    throw new Error('Unsupported or malformed backup file format.');
  }
  const payload = await invokeCmd<VaultPayload>('import_backup', {
    backupJson: JSON.stringify(backup),
    password: backupPassword,
  });
  if (!payload || !Array.isArray(payload.entries)) {
    throw new Error('Invalid vault payload inside backup.');
  }
  return {
    entries: payload.entries,
    settings: { ...DEFAULT_SETTINGS, ...(payload.settings || {}) },
  };
}

export async function clearLocalVault(): Promise<void> {
  await invokeCmd('erase_vault');
}
