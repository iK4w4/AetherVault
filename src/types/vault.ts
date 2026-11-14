export type EntryCategory = 'login' | 'note' | 'card' | 'identity';

export type SidebarSection =
  | 'all'
  | 'favorites'
  | 'totp'
  | 'login'
  | 'note'
  | 'card'
  | 'identity'
  | 'audit'
  | 'generator'
  | 'settings'
  | 'trash';

export interface CustomField {
  id: string;
  label: string;
  value: string;
  hidden: boolean;
}

export interface PasswordHistoryItem {
  password: string;
  changedAt: number;
}

export interface VaultEntry {
  id: string;
  category: EntryCategory;
  title: string;
  favorite: boolean;
  tags: string[];
  notes: string;
  customFields: CustomField[];
  createdAt: number;
  updatedAt: number;
  trashedAt?: number | null;

  // Login fields
  username?: string;
  password?: string;
  // Set only by the health audit on duplicate entries: the
  // password value is stripped from the report and only its
  // length is reported.
  passwordLength?: number;
  passwordUpdatedAt?: number;
  passwordHistory?: PasswordHistoryItem[];
  url?: string;
  totpSecret?: string;

  // Card fields
  cardholderName?: string;
  cardNumber?: string;
  cardExpiry?: string;
  cardCvv?: string;
  cardPin?: string;

  // Identity fields
  fullName?: string;
  email?: string;
  phone?: string;
  address?: string;
  idNumber?: string;
}

export type ThemeMode = 'light' | 'dark';

export interface VaultSettings {
  theme: ThemeMode;
  zoom: number; // 0.9, 1, 1.1, 1.2
  autoLockMinutes: number; // 0 means Never
  clipboardClearSeconds: number; // default 20
  lastBackupAt?: number;
}

export interface VaultPayload {
  entries: VaultEntry[];
  settings: VaultSettings;
}

export type AuditIssueType = 'breached' | 'weak' | 'reused' | 'old';

export interface AuditIssue {
  id: string;
  entryId: string;
  entryTitle: string;
  username?: string;
  url?: string;
  type: AuditIssueType;
  severity: 'critical' | 'high' | 'medium';
  title: string;
  description: string;
}

export interface DuplicateGroup {
  domain: string;
  entries: VaultEntry[];
}

export interface HealthReport {
  score: number;
  totalLogins: number;
  breachedCount: number;
  weakCount: number;
  reusedCount: number;
  oldCount: number;
  issues: AuditIssue[];
  duplicates: DuplicateGroup[];
}
