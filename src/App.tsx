import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardCheck,
  KeyRound,
  Menu,
  RotateCcw,
  X,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  EntryCategory,
  HealthReport,
  SidebarSection,
  ThemeMode,
  VaultEntry,
  VaultPayload,
  VaultSettings,
} from './types/vault';
import {
  clearLocalVault,
  DEFAULT_SETTINGS,
  persistVaultPayload,
} from './utils/crypto';
import { createId } from './utils/importers';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ContextMenuProvider } from './components/ContextMenu';
import { EntryDetail } from './components/EntryDetail';
import { EntryEditorModal } from './components/EntryEditorModal';
import { EntryList, SortMode } from './components/EntryList';
import { HealthAuditView } from './components/HealthAuditView';
import { LockScreen } from './components/LockScreen';
import { PasswordGeneratorView } from './components/PasswordGeneratorView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';

const EMPTY_HEALTH_REPORT: HealthReport = {
  score: 100,
  totalLogins: 0,
  breachedCount: 0,
  weakCount: 0,
  reusedCount: 0,
  oldCount: 0,
  issues: [],
  duplicates: [],
};

interface UndoToastState {
  message: string;
  onUndo?: () => void;
  undoLabel?: string;
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [settings, setSettings] = useState<VaultSettings>(() => {
    try {
      const savedTheme = localStorage.getItem('aethervault_theme_pref') as ThemeMode | null;
      return {
        ...DEFAULT_SETTINGS,
        theme: savedTheme === 'dark' ? 'dark' : 'light',
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [unlockedViaRecovery, setUnlockedViaRecovery] = useState(false);

  const unlockedRef = useRef(false);
  const entriesRef = useRef<VaultEntry[]>([]);
  const settingsRef = useRef<VaultSettings>(settings);
  unlockedRef.current = unlocked;
  entriesRef.current = entries;
  settingsRef.current = settings;

  const [section, setSection] = useState<SidebarSection>('all');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('recent');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<VaultEntry | null>(null);
  const [prefillPassword, setPrefillPassword] = useState('');

  const [confirmTrashEntry, setConfirmTrashEntry] = useState<VaultEntry | null>(null);
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<VaultEntry | null>(null);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);

  const [clipboardStatus, setClipboardStatus] = useState<{
    label: string;
    secondsLeft: number;
  } | null>(null);
  const clipboardTimerRef = useRef<number | null>(null);

  const [toast, setToast] = useState<UndoToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('aethervault_theme_pref', settings.theme);
    } catch {
      // Ignore storage error
    }
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * (settings.zoom || 1)}px`;
  }, [settings.zoom]);

  const showToast = useCallback(
    (message: string, onUndo?: () => void, undoLabel = 'Undo') => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      setToast({ message, onUndo, undoLabel });
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
      }, 7500);
    },
    []
  );

  const lockVault = useCallback(() => {
    // Tell the Rust backend to drop the session keys and sweep the
    // clipboard (conditionally — only if it still holds the last
    // copied clearable secret; persistent copies are never touched).
    void invoke('lock_vault').catch(() => undefined);
    if (clipboardTimerRef.current) {
      window.clearInterval(clipboardTimerRef.current);
      clipboardTimerRef.current = null;
    }
    setUnlocked(false);
    setEntries([]);
    setSelectedEntryId(null);
    setMobileDetailOpen(false);
    setMobileSidebarOpen(false);
    setEditorOpen(false);
    setEditingEntry(null);
    setPrefillPassword('');
    setConfirmTrashEntry(null);
    setConfirmDeleteEntry(null);
    setConfirmEmptyTrash(false);
    setUnlockedViaRecovery(false);
    setSearchQuery('');
    setSelectedTag(null);
    setClipboardStatus(null);
  }, []);

  const lastActivityRef = useRef<number>(Date.now());

  // Tray menu "Lock Vault": the backend emits this event; lock here.
  useEffect(() => {
    if (!unlocked) return;
    const promise = listen('aethervault://tray-lock', () => lockVault());
    return () => {
      void promise.then((unlisten) => unlisten());
    };
  }, [unlocked, lockVault]);

  useEffect(() => {
    if (!unlocked || settings.autoLockMinutes <= 0) return;

    const timeoutMs = settings.autoLockMinutes * 60 * 1000;
    lastActivityRef.current = Date.now();
    let timerId: number;

    const checkExpiry = () => {
      if (Date.now() - lastActivityRef.current >= timeoutMs) {
        lockVault();
      }
    };

    const resetTimer = () => {
      lastActivityRef.current = Date.now();
      window.clearTimeout(timerId);
      timerId = window.setTimeout(checkExpiry, timeoutMs);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkExpiry();
      }
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibility);
    const heartbeat = window.setInterval(checkExpiry, 15000);
    resetTimer();

    return () => {
      window.clearTimeout(timerId);
      window.clearInterval(heartbeat);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [unlocked, settings.autoLockMinutes, lockVault]);

  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  const saveVaultState = useCallback(
    async (nextEntries: VaultEntry[], nextSettings: VaultSettings = settingsRef.current) => {
      if (!unlockedRef.current) return;
      entriesRef.current = nextEntries;
      settingsRef.current = nextSettings;
      setEntries(nextEntries);
      setSettings(nextSettings);

      const writeTask = persistQueueRef.current.then(async () => {
        if (!unlockedRef.current) return;
        await persistVaultPayload({
          entries: entriesRef.current,
          settings: settingsRef.current,
        });
      });
      persistQueueRef.current = writeTask.catch(() => undefined);
      try {
        await writeTask;
      } catch {
        // Keep the UI state (it already shows the edit) but report that
        // the change never reached disk.
        showToast('Could not save changes to the vault file.');
      }
    },
    [showToast]
  );

  const handleCopyWithAutoClear = useCallback(
    async (value: string, label: string) => {
      const totalSeconds = settingsRef.current.clipboardClearSeconds || 20;
      try {
        await invoke('copy_secret', { text: value, ttlSecs: totalSeconds });
      } catch {
        // The copy failed: report it instead of starting the countdown.
        showToast('Could not copy to the clipboard.');
        return;
      }
      if (clipboardTimerRef.current) {
        window.clearInterval(clipboardTimerRef.current);
      }
      setClipboardStatus({ label, secondsLeft: totalSeconds });

      clipboardTimerRef.current = window.setInterval(() => {
        setClipboardStatus((prev) => {
          if (!prev) return null;
          if (prev.secondsLeft <= 1) {
            if (clipboardTimerRef.current) {
              window.clearInterval(clipboardTimerRef.current);
              clipboardTimerRef.current = null;
            }
            // The backend reaper owns the actual clear: it only wipes the
            // clipboard if it still holds this secret, never a persistent
            // copy or a newer clipboard value.
            return null;
          }
          return { ...prev, secondsLeft: prev.secondsLeft - 1 };
        });
      }, 1000);
    },
    [showToast]
  );

  const clearClipboardNow = () => {
    if (clipboardTimerRef.current) {
      window.clearInterval(clipboardTimerRef.current);
      clipboardTimerRef.current = null;
    }
    void invoke('clear_clipboard').catch(() => undefined);
    setClipboardStatus(null);
  };

  // Entries come from the vault file or an import, which may hold
  // malformed data (wrong types, missing arrays). Coerce every field
  // the UI touches so one bad entry can't crash the whole app.
  const normalizeEntry = (raw: VaultEntry): VaultEntry => {
    const asStr = (v: unknown): string =>
      typeof v === 'string' ? v : v == null ? '' : String(v);
    const asStrArr = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => asStr(x)) : [];
    return {
      ...raw,
      title: asStr(raw.title) || 'Untitled Entry',
      username: asStr(raw.username),
      url: asStr(raw.url),
      email: asStr(raw.email),
      notes: asStr(raw.notes),
      tags: asStrArr(raw.tags),
      customFields: Array.isArray(raw.customFields)
        ? raw.customFields.map((f) => ({ ...f, label: asStr(f?.label), value: asStr(f?.value) }))
        : [],
      passwordHistory: Array.isArray(raw.passwordHistory)
        ? raw.passwordHistory.map((h) => ({ ...h, password: asStr(h?.password) }))
        : [],
      cardholderName: asStr(raw.cardholderName),
      cardNumber: asStr(raw.cardNumber),
      fullName: asStr(raw.fullName),
      phone: asStr(raw.phone),
      address: asStr(raw.address),
      idNumber: asStr(raw.idNumber),
    };
  };

  const handleUnlocked = (payload: VaultPayload, viaRecovery: boolean) => {
    // The theme is a device-level preference (persisted in localStorage and
    // toggled on the lock screen), so it must not be overwritten by whatever
    // theme the vault file was saved with.
    const deviceTheme = settingsRef.current.theme;
    const entries = (payload.entries || []).map(normalizeEntry);
    setUnlocked(true);
    setEntries(entries);
    setSettings({ ...DEFAULT_SETTINGS, ...(payload.settings || {}), theme: deviceTheme });
    setUnlockedViaRecovery(viaRecovery);
    setSection('all');
    setMobileDetailOpen(false);
    const firstActive = entries.find((e) => !e.trashedAt);
    setSelectedEntryId(firstActive?.id || null);
  };

  const activeEntries = useMemo(
    () => entries.filter((e) => !e.trashedAt),
    [entries]
  );
  const trashedEntries = useMemo(
    () => entries.filter((e) => Boolean(e.trashedAt)),
    [entries]
  );

  const counts = useMemo<Record<SidebarSection, number>>(
    () => ({
      all: activeEntries.length,
      favorites: activeEntries.filter((e) => e.favorite).length,
      totp: activeEntries.filter((e) => Boolean(e.totpSecret?.trim())).length,
      login: activeEntries.filter((e) => e.category === 'login').length,
      note: activeEntries.filter((e) => e.category === 'note').length,
      card: activeEntries.filter((e) => e.category === 'card').length,
      identity: activeEntries.filter((e) => e.category === 'identity').length,
      audit: 0,
      generator: 0,
      settings: 0,
      trash: trashedEntries.length,
    }),
    [activeEntries, trashedEntries]
  );

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const e of activeEntries) {
      for (const t of e.tags) tagSet.add(t);
    }
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }, [activeEntries]);

  const [healthReport, setHealthReport] = useState<HealthReport>(EMPTY_HEALTH_REPORT);
  useEffect(() => {
    let active = true;
    invoke<HealthReport>('audit_vault', { entries })
      .then((report) => {
        if (active) setHealthReport(report);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [entries]);

  const totpProtectedCount = useMemo(
    () =>
      activeEntries.filter(
        (e) => e.category === 'login' && Boolean(e.totpSecret?.trim())
      ).length,
    [activeEntries]
  );

  const filteredEntries = useMemo(() => {
    let base = section === 'trash' ? trashedEntries : activeEntries;
    if (section === 'favorites') base = base.filter((e) => e.favorite);
    else if (section === 'totp') base = base.filter((e) => Boolean(e.totpSecret?.trim()));
    else if (
      section === 'login' ||
      section === 'note' ||
      section === 'card' ||
      section === 'identity'
    ) {
      base = base.filter((e) => e.category === section);
    }

    if (selectedTag && section !== 'trash') {
      base = base.filter((e) => e.tags.includes(selectedTag));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      base = base.filter((e) => {
        const searchable = [
          e.title,
          e.username,
          e.url,
          e.email,
          e.notes,
          e.cardholderName,
          e.cardNumber,
          e.fullName,
          e.phone,
          e.address,
          e.idNumber,
          ...e.tags,
          ...e.customFields.flatMap((f) => [f.label, f.value]),
        ];
        return searchable.some((field) => (field || '').toLowerCase().includes(q));
      });
    }

    return [...base].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      if (sortMode === 'title') return a.title.localeCompare(b.title);
      return b.updatedAt - a.updatedAt;
    });
  }, [activeEntries, trashedEntries, section, selectedTag, searchQuery, sortMode]);

  useEffect(() => {
    if (section === 'audit' || section === 'generator' || section === 'settings') return;
    if (filteredEntries.length === 0) {
      if (selectedEntryId !== null) setSelectedEntryId(null);
      return;
    }
    const stillVisible = filteredEntries.some((e) => e.id === selectedEntryId);
    if (!stillVisible) {
      setSelectedEntryId(filteredEntries[0].id);
    }
  }, [filteredEntries, selectedEntryId, section]);

  const selectedEntry = useMemo(
    () => entries.find((e) => e.id === selectedEntryId) || null,
    [entries, selectedEntryId]
  );

  // Global keyboard shortcuts: Ctrl+K (Search), Ctrl+L (Lock), Ctrl+N (New Entry), Esc (Close drawer), Arrows (Browse list)
  useEffect(() => {
    if (!unlocked) return;
    const anyModalOpen =
      editorOpen ||
      Boolean(confirmTrashEntry) ||
      Boolean(confirmDeleteEntry) ||
      confirmEmptyTrash;

    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        lockVault();
        return;
      }

      if (anyModalOpen || Boolean(document.querySelector('[role="dialog"]'))) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (section === 'audit' || section === 'generator' || section === 'settings') {
          setSection('all');
        }
        setMobileDetailOpen(false);
        setTimeout(() => searchInputRef.current?.focus(), 30);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setEditingEntry(null);
        setPrefillPassword('');
        setEditorOpen(true);
      } else if (e.key === 'Escape' && (mobileDetailOpen || mobileSidebarOpen)) {
        setMobileDetailOpen(false);
        setMobileSidebarOpen(false);
      } else if (
        (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
        section !== 'audit' &&
        section !== 'generator' &&
        section !== 'settings' &&
        filteredEntries.length > 0
      ) {
        const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
        const isTypingField =
          activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
        if (isTypingField && document.activeElement !== searchInputRef.current) return;

        e.preventDefault();
        const currentIndex = filteredEntries.findIndex((item) => item.id === selectedEntryId);
        const nextIndex =
          e.key === 'ArrowDown'
            ? Math.min(filteredEntries.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1);
        const target = filteredEntries[nextIndex];
        if (target) setSelectedEntryId(target.id);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    unlocked,
    editorOpen,
    confirmTrashEntry,
    confirmDeleteEntry,
    confirmEmptyTrash,
    section,
    mobileSidebarOpen,
    mobileDetailOpen,
    filteredEntries,
    selectedEntryId,
    lockVault,
  ]);

  const handleRestorePassword = async (entryId: string, targetPassword: string) => {
    const current = entriesRef.current;
    const target = current.find((e) => e.id === entryId);
    if (!target) return;
    const now = Date.now();
    const updated: VaultEntry = {
      ...target,
      password: targetPassword,
      passwordUpdatedAt: now,
      updatedAt: now,
      passwordHistory: target.password
        ? [{ password: target.password, changedAt: now }, ...(target.passwordHistory || [])].slice(0, 15)
        : target.passwordHistory,
    };
    await saveVaultState(current.map((e) => (e.id === entryId ? updated : e)));
    showToast(`Restored previous password for ${target.title}.`);
  };

  const handleSaveEntry = async (entryData: VaultEntry, previousPassword?: string) => {
    const current = entriesRef.current;
    const exists = current.some((e) => e.id === entryData.id);
    const nextEntries = exists
      ? current.map((e) => (e.id === entryData.id ? entryData : e))
      : [entryData, ...current];

    await saveVaultState(nextEntries);
    setSelectedEntryId(entryData.id);
    setEditorOpen(false);
    setEditingEntry(null);
    setPrefillPassword('');

    if (previousPassword !== undefined) {
      showToast(
        `Updated password for ${entryData.title}.`,
        () => {
          void handleRestorePassword(entryData.id, previousPassword);
        },
        'Undo Change'
      );
    } else {
      showToast(exists ? `Saved ${entryData.title}.` : `Added ${entryData.title}.`);
    }
  };

  const handleToggleFavorite = async (entry: VaultEntry) => {
    const updated = { ...entry, favorite: !entry.favorite, updatedAt: Date.now() };
    await saveVaultState(
      entriesRef.current.map((e) => (e.id === entry.id ? updated : e))
    );
  };

  const handleMoveToTrash = async (entry: VaultEntry) => {
    const next = entriesRef.current.map((e) =>
      e.id === entry.id ? { ...e, trashedAt: Date.now() } : e
    );
    await saveVaultState(next);
    setConfirmTrashEntry(null);
    setMobileDetailOpen(false);

    showToast(
      `Moved "${entry.title}" to Trash.`,
      () => {
        const latest = entriesRef.current;
        const restored = latest.map((e) =>
          e.id === entry.id ? { ...e, trashedAt: null } : e
        );
        void saveVaultState(restored);
        setSelectedEntryId(entry.id);
      },
      'Undo'
    );
  };

  const handleRestoreFromTrash = async (entry: VaultEntry) => {
    const next = entriesRef.current.map((e) =>
      e.id === entry.id ? { ...e, trashedAt: null, updatedAt: Date.now() } : e
    );
    await saveVaultState(next);
    setMobileDetailOpen(false);
    showToast(`Restored "${entry.title}" to vault.`);
  };

  const handleDeleteForever = async (entry: VaultEntry) => {
    const next = entriesRef.current.filter((e) => e.id !== entry.id);
    await saveVaultState(next);
    setConfirmDeleteEntry(null);
    setMobileDetailOpen(false);
    showToast(`Permanently deleted "${entry.title}".`);
  };

  const handleEmptyTrash = async () => {
    const next = entriesRef.current.filter((e) => !e.trashedAt);
    await saveVaultState(next);
    setConfirmEmptyTrash(false);
    setMobileDetailOpen(false);
    showToast('Trash emptied permanently.');
  };

  const handleMergeDuplicates = async (primaryId: string, secondaryIds: string[]) => {
    const current = entriesRef.current;
    const primary = current.find((e) => e.id === primaryId);
    if (!primary) return;
    const secondaries = current.filter((e) => secondaryIds.includes(e.id));
    const now = Date.now();

    const mergedTags = Array.from(
      new Set([...primary.tags, ...secondaries.flatMap((s) => s.tags)])
    );
    const extraNotes = secondaries
      .map((s) => (s.notes ? `[Merged from ${s.title}]\n${s.notes}` : ''))
      .filter(Boolean)
      .join('\n\n');
    const mergedNotes = [primary.notes, extraNotes].filter(Boolean).join('\n\n');
    const mergedFields = [
      ...primary.customFields,
      ...secondaries.flatMap((s) => s.customFields),
    ];
    const mergedTotp =
      primary.totpSecret || secondaries.find((s) => s.totpSecret)?.totpSecret || '';
    const mergedUsername =
      primary.username || secondaries.find((s) => s.username)?.username || '';

    const extraPasswords = secondaries
      .map((s) => s.password)
      .filter((pw): pw is string => Boolean(pw && pw !== primary.password));
    const mergedHistory = [
      ...(primary.passwordHistory || []),
      ...extraPasswords.map((pw) => ({ password: pw, changedAt: now })),
      ...secondaries.flatMap((s) => s.passwordHistory || []),
    ].slice(0, 15);

    const updatedPrimary: VaultEntry = {
      ...primary,
      username: mergedUsername,
      tags: mergedTags,
      notes: mergedNotes,
      customFields: mergedFields,
      totpSecret: mergedTotp,
      passwordHistory: mergedHistory,
      updatedAt: now,
    };

    const nextEntries = current.map((e) => {
      if (e.id === primaryId) return updatedPrimary;
      if (secondaryIds.includes(e.id)) return { ...e, trashedAt: now };
      return e;
    });

    await saveVaultState(nextEntries);
    showToast(`Merged ${secondaries.length + 1} entries into "${primary.title}".`);
  };

  const sanitizeImportedEntries = (items: VaultEntry[]): VaultEntry[] => {
    const now = Date.now();
    return items.map((raw) => {
      const e = normalizeEntry(raw);
      return {
        ...e,
        id: e.id || createId(),
        category:
          e.category === 'login' ||
          e.category === 'note' ||
          e.category === 'card' ||
          e.category === 'identity'
            ? e.category
            : 'login',
        createdAt: Number(e.createdAt) || now,
        updatedAt: Number(e.updatedAt) || now,
      };
    });
  };

  const handleImportEntries = async (
    importedRaw: VaultEntry[],
    mode: 'merge' | 'replace'
  ) => {
    const imported = sanitizeImportedEntries(importedRaw);
    if (mode === 'replace') {
      await saveVaultState(imported);
      if (imported[0]) setSelectedEntryId(imported[0].id);
      return;
    }

    const byId = new Map<string, VaultEntry>();
    for (const existing of entriesRef.current) {
      byId.set(existing.id, existing);
    }
    for (const incoming of imported) {
      const existing = byId.get(incoming.id);
      if (!existing || incoming.updatedAt >= existing.updatedAt) {
        byId.set(incoming.id, incoming);
      }
    }
    const merged = Array.from(byId.values());
    await saveVaultState(merged);
    if (imported[0]) setSelectedEntryId(imported[0].id);
  };

  const handleWipeVault = async () => {
    try {
      await clearLocalVault();
    } catch {
      showToast('Could not erase the vault.');
      return;
    }
    lockVault();
  };

  const defaultNewCategory: EntryCategory =
    section === 'note' || section === 'card' || section === 'identity'
      ? section
      : 'login';

  if (!unlocked) {
    return (
      <div className="h-screen w-screen overflow-hidden flex flex-col bg-[var(--neu-bg)] text-[var(--neu-text)]">
        <TitleBar />
        <div className="flex-1 min-h-0">
          <LockScreen
            theme={settings.theme}
            onToggleTheme={() =>
              setSettings((prev) => ({
                ...prev,
                theme: prev.theme === 'dark' ? 'light' : 'dark',
              }))
            }
            onUnlocked={handleUnlocked}
            onOpenLinkError={(msg) => showToast(msg)}
          />
        </div>
        <ContextMenuProvider onCopy={handleCopyWithAutoClear} />
      </div>
    );
  }

  const isVaultListScreen =
    section !== 'audit' && section !== 'generator' && section !== 'settings';

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[var(--neu-bg)] text-[var(--neu-text)]">
      <TitleBar />
      <div className="lg:hidden px-4 pt-3 flex items-center justify-between gap-3 shrink-0">
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          aria-label="Open navigation menu"
          className="neu-btn px-3.5 py-2 rounded-[13px] text-xs font-semibold flex items-center gap-2 shrink-0"
        >
          <Menu className="w-4 h-4 text-[var(--neu-accent)]" />
          <span>Menu</span>
        </button>
        <span className="min-w-0 truncate px-1 text-sm font-bold text-[var(--neu-text)]">AetherVault</span>
        <button
          type="button"
          onClick={lockVault}
          className="neu-btn px-3 py-2 rounded-[13px] text-xs font-semibold shrink-0"
        >
          Lock
        </button>
      </div>

      {unlockedViaRecovery && (
        <div className="px-4 pt-3 shrink-0">
          <div className="neu-raised-sm rounded-[16px] px-5 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs font-medium text-[var(--neu-text)]">
              <KeyRound className="w-4 h-4 text-[var(--neu-warning)] shrink-0" />
              <span>
                You unlocked with your emergency recovery key. Set a new master password to keep your vault secure.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSection('settings')}
              className="neu-btn-primary px-3.5 py-1.5 rounded-[11px] text-xs font-semibold whitespace-nowrap shrink-0"
            >
              Set New Password
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex p-3 lg:p-5 gap-4 lg:gap-5 relative">
        <div className="hidden lg:block h-full">
          <Sidebar
            activeSection={section}
            onSelectSection={(next) => {
              setSection(next);
              setSelectedTag(null);
              setMobileDetailOpen(false);
            }}
            counts={counts}
            auditIssueCount={healthReport.issues.length + healthReport.duplicates.length}
            theme={settings.theme}
            onToggleTheme={() =>
              void saveVaultState(entriesRef.current, {
                ...settingsRef.current,
                theme: settingsRef.current.theme === 'dark' ? 'light' : 'dark',
              })
            }
            onLockVault={lockVault}
            onHideToTray={() => void invoke('hide_to_tray').catch(() => showToast('Could not hide to tray.'))}
            onOpenLinkError={(msg) => showToast(msg)}
          />
        </div>

        {mobileSidebarOpen && (
          <div
            className="lg:hidden fixed inset-0 z-50 flex bg-black/30 dark:bg-black/55 backdrop-blur-[2px]"
            onClick={(e) => {
              if (e.target === e.currentTarget) setMobileSidebarOpen(false);
            }}
          >
            <div className="h-full bg-[var(--neu-bg)] shadow-2xl">
              <Sidebar
                activeSection={section}
                onSelectSection={(next) => {
                  setSection(next);
                  setSelectedTag(null);
                  setMobileDetailOpen(false);
                  setMobileSidebarOpen(false);
                }}
                counts={counts}
                auditIssueCount={healthReport.issues.length + healthReport.duplicates.length}
                theme={settings.theme}
                onToggleTheme={() =>
                  void saveVaultState(entriesRef.current, {
                    ...settingsRef.current,
                    theme: settingsRef.current.theme === 'dark' ? 'light' : 'dark',
                  })
                }
                onLockVault={lockVault}
                onHideToTray={() => {
                  setMobileSidebarOpen(false);
                  void invoke('hide_to_tray').catch(() => showToast('Could not hide to tray.'));
                }}
                onOpenLinkError={(msg) => showToast(msg)}
              />
            </div>
          </div>
        )}

        <main className="flex-1 min-w-0 h-full flex gap-4 lg:gap-5">
          {isVaultListScreen ? (
            <>
              <div
                className={`h-full w-full lg:w-auto ${
                  mobileDetailOpen ? 'hidden lg:block' : 'block'
                }`}
              >
                <EntryList
                  entries={filteredEntries}
                  totalVaultCount={entries.length}
                  selectedId={selectedEntryId}
                  section={section}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  selectedTag={selectedTag}
                  onSelectTag={setSelectedTag}
                  allTags={allTags}
                  sortMode={sortMode}
                  onToggleSort={() =>
                    setSortMode((m) => (m === 'recent' ? 'title' : 'recent'))
                  }
                  onSelectEntry={(id) => {
                    setSelectedEntryId(id);
                    setMobileDetailOpen(true);
                  }}
                  onAddEntry={() => {
                    setEditingEntry(null);
                    setPrefillPassword('');
                    setEditorOpen(true);
                  }}
                  onEmptyTrash={() => setConfirmEmptyTrash(true)}
                  duplicates={healthReport.duplicates}
                  onGoToAudit={() => setSection('audit')}
                  searchInputRef={searchInputRef}
                />
              </div>

              <div
                className={`flex-1 min-w-0 h-full ${
                  mobileDetailOpen ? 'block' : 'hidden lg:block'
                }`}
              >
                <EntryDetail
                  entry={selectedEntry}
                  onCopy={handleCopyWithAutoClear}
                  onToggleFavorite={(e) => void handleToggleFavorite(e)}
                  onEdit={(e) => {
                    setEditingEntry(e);
                    setPrefillPassword('');
                    setEditorOpen(true);
                  }}
                  onMoveToTrash={(e) => setConfirmTrashEntry(e)}
                  onRestoreFromTrash={(e) => void handleRestoreFromTrash(e)}
                  onDeleteForever={(e) => setConfirmDeleteEntry(e)}
                  onRestorePasswordHistory={(e, pw) => void handleRestorePassword(e.id, pw)}
                  onNotify={(msg) => showToast(msg)}
                  onBackToList={() => setMobileDetailOpen(false)}
                />
              </div>
            </>
          ) : section === 'audit' ? (
            <HealthAuditView
              report={healthReport}
              totpProtectedCount={totpProtectedCount}
              onFixEntry={(entryId) => {
                const target = entries.find((e) => e.id === entryId);
                if (target) {
                  setSearchQuery('');
                  setSelectedTag(null);
                  setSection('all');
                  setSelectedEntryId(target.id);
                  setMobileDetailOpen(true);
                  setEditingEntry(target);
                  setPrefillPassword('');
                  setEditorOpen(true);
                }
              }}
              onMergeDuplicates={handleMergeDuplicates}
            />
          ) : section === 'generator' ? (
            <PasswordGeneratorView
              onCopy={handleCopyWithAutoClear}
              onUseInNewEntry={(generatedPw) => {
                setSection('login');
                setEditingEntry(null);
                setPrefillPassword(generatedPw);
                setEditorOpen(true);
              }}
            />
          ) : (
            <SettingsView
              entries={entries}
              settings={settings}
              unlockedViaRecovery={unlockedViaRecovery}
              onUpdateSettings={async (patch) => {
                const next = { ...settingsRef.current, ...patch };
                await saveVaultState(entriesRef.current, next);
              }}
              onImportEntries={handleImportEntries}
              onWipeVault={() => void handleWipeVault()}
              onMasterPasswordChanged={() => setUnlockedViaRecovery(false)}
              onNotify={(msg) => showToast(msg)}
            />
          )}
        </main>
      </div>

      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2.5 pointer-events-none">
        {clipboardStatus && (
          <div className="pointer-events-auto neu-raised rounded-[16px] px-4 py-3 flex items-center gap-3">
            <ClipboardCheck className="w-4 h-4 text-[var(--neu-accent)] shrink-0" />
            <div className="text-xs">
              <span className="font-semibold text-[var(--neu-text)]">
                {clipboardStatus.label} copied
              </span>
              <span className="text-[var(--neu-text-muted)]">
                {' '}· Clearing in{' '}
                <span className="font-mono font-semibold text-[var(--neu-text)]">
                  {clipboardStatus.secondsLeft}s
                </span>
              </span>
            </div>
            <button
              type="button"
              onClick={clearClipboardNow}
              className="neu-btn px-2.5 py-1 rounded-[10px] text-[11px] font-semibold"
            >
              Clear
            </button>
          </div>
        )}

        {toast && (
          <div className="pointer-events-auto neu-raised rounded-[16px] px-4 py-3 flex items-center gap-3">
            <span className="text-xs font-medium text-[var(--neu-text)]">
              {toast.message}
            </span>
            {toast.onUndo && (
              <button
                type="button"
                onClick={() => {
                  toast.onUndo?.();
                  setToast(null);
                }}
                className="neu-btn px-3 py-1 rounded-[10px] text-xs font-semibold text-[var(--neu-accent)] flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{toast.undoLabel || 'Undo'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="text-[var(--neu-text-muted)] hover:text-[var(--neu-text)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <EntryEditorModal
        open={editorOpen}
        initialEntry={editingEntry}
        defaultCategory={defaultNewCategory}
        prefillPassword={prefillPassword}
        existingTags={allTags}
        unlockedViaRecovery={unlockedViaRecovery}
        onSave={handleSaveEntry}
        onClose={() => {
          setEditorOpen(false);
          setEditingEntry(null);
          setPrefillPassword('');
        }}
        onCopy={handleCopyWithAutoClear}
      />

      <ConfirmDialog
        open={Boolean(confirmTrashEntry)}
        destructive
        title="Move Entry to Trash?"
        description={`"${confirmTrashEntry?.title}" will be moved to Trash. You can restore it anytime from the Trash section.`}
        confirmLabel="Move to Trash"
        onCancel={() => setConfirmTrashEntry(null)}
        onConfirm={() => {
          if (confirmTrashEntry) void handleMoveToTrash(confirmTrashEntry);
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteEntry)}
        destructive
        title="Delete Forever?"
        description={`"${confirmDeleteEntry?.title}" will be permanently erased and cannot be undone.`}
        confirmLabel="Delete Forever"
        onCancel={() => setConfirmDeleteEntry(null)}
        onConfirm={() => {
          if (confirmDeleteEntry) void handleDeleteForever(confirmDeleteEntry);
        }}
      />

      <ConfirmDialog
        open={confirmEmptyTrash}
        destructive
        title="Empty Trash Permanently?"
        description={`All ${trashedEntries.length} items in Trash will be permanently erased and cannot be recovered.`}
        confirmLabel="Empty Trash"
        onCancel={() => setConfirmEmptyTrash(false)}
        onConfirm={() => void handleEmptyTrash()}
      />

      <ContextMenuProvider onCopy={handleCopyWithAutoClear} />
    </div>
  );
}
