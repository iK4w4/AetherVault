import React, { useEffect, useMemo, useRef } from 'react';
import {
  ArrowUpDown,
  CreditCard,
  FileText,
  GitMerge,
  Globe,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { DuplicateGroup, SidebarSection, VaultEntry } from '../types/vault';

export type SortMode = 'recent' | 'title';

interface EntryListProps {
  entries: VaultEntry[];
  totalVaultCount: number;
  selectedId: string | null;
  section: SidebarSection;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
  allTags: string[];
  sortMode: SortMode;
  onToggleSort: () => void;
  onSelectEntry: (id: string) => void;
  onAddEntry: () => void;
  onEmptyTrash: () => void;
  duplicates: DuplicateGroup[];
  onGoToAudit: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

const SECTION_LABELS: Record<SidebarSection, string> = {
  all: 'All Items',
  favorites: 'Favorites',
  totp: '2FA Authenticator',
  login: 'Logins',
  note: 'Secure Notes',
  card: 'Payment Cards',
  identity: 'Identities',
  audit: 'Health Audit',
  generator: 'Password Generator',
  settings: 'Settings',
  trash: 'Trash',
};

const EMPTY_CATEGORY_COPY: Partial<
  Record<SidebarSection, { title: string; subtitle: string; cta: string }>
> = {
  favorites: {
    title: 'No favorites pinned yet',
    subtitle: 'Star your most-used logins or cards to keep them at the top and in the system tray.',
    cta: 'Add Entry',
  },
  totp: {
    title: 'No 2FA secrets stored yet',
    subtitle: 'Add a Base32 authenticator secret to any login for live 6-digit verification codes.',
    cta: 'Add Login with 2FA',
  },
  note: {
    title: 'No secure notes yet',
    subtitle: 'Store recovery codes, SSH keys, software licenses, or private instructions offline.',
    cta: 'Add Secure Note',
  },
  card: {
    title: 'No payment cards yet',
    subtitle: 'Save card numbers, expiry dates, CVVs, and PINs behind master password protection.',
    cta: 'Add Payment Card',
  },
  identity: {
    title: 'No identities saved yet',
    subtitle: 'Store addresses, contact details, and passport or ID numbers for quick one-tap copying.',
    cta: 'Add Identity',
  },
};

export const EntryList: React.FC<EntryListProps> = ({
  entries,
  totalVaultCount,
  selectedId,
  section,
  searchQuery,
  onSearchChange,
  selectedTag,
  onSelectTag,
  allTags,
  sortMode,
  onToggleSort,
  onSelectEntry,
  onAddEntry,
  onEmptyTrash,
  duplicates,
  onGoToAudit,
  searchInputRef,
}) => {
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!selectedId) return;
    itemRefs.current[selectedId]?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const getSubtitle = (entry: VaultEntry) => {
    if (entry.category === 'login') return entry.username || entry.url || 'Login credential';
    if (entry.category === 'card') {
      const digits = (entry.cardNumber || '').replace(/\D/g, '');
      return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : entry.cardholderName || 'Payment card';
    }
    if (entry.category === 'identity') return entry.email || entry.fullName || 'Identity profile';
    return entry.notes?.split('\n')[0]?.slice(0, 48) || 'Secure note';
  };

  const renderCategoryAvatar = (entry: VaultEntry) => {
    if (entry.category === 'login') {
      const initial = entry.title.trim().charAt(0).toUpperCase();
      return initial ? (
        <span className="text-sm font-bold text-[var(--neu-accent)]">{initial}</span>
      ) : (
        <Globe className="w-4 h-4 text-[var(--neu-accent)]" />
      );
    }
    switch (entry.category) {
      case 'card':
        return <CreditCard className="w-4 h-4 text-[var(--neu-accent)]" />;
      case 'identity':
        return <UserCheck className="w-4 h-4 text-[var(--neu-accent)]" />;
      default:
        return <FileText className="w-4 h-4 text-[var(--neu-accent)]" />;
    }
  };

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (entries.length === 0) return;
    const isSearchFocused = document.activeElement === searchInputRef.current;

    if (e.key === 'Home' && !isSearchFocused) {
      e.preventDefault();
      e.stopPropagation();
      onSelectEntry(entries[0].id);
    } else if (e.key === 'End' && !isSearchFocused) {
      e.preventDefault();
      e.stopPropagation();
      onSelectEntry(entries[entries.length - 1].id);
    } else if (e.key === 'Enter' && isSearchFocused && selectedId) {
      e.preventDefault();
      onSelectEntry(selectedId);
    }
  };

  const showDuplicateBanner = useMemo(() => {
    return (
      duplicates.length > 0 &&
      (section === 'all' || section === 'login') &&
      !searchQuery
    );
  }, [duplicates.length, section, searchQuery]);

  const categoryEmpty = EMPTY_CATEGORY_COPY[section];

  return (
    <section
      aria-label="Vault entries"
      onKeyDown={handleListKeyDown}
      className="w-full lg:w-[340px] xl:w-[370px] shrink-0 h-full flex flex-col neu-raised rounded-[22px] p-4 gap-3.5"
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <div>
          <h2 className="text-base font-semibold text-[var(--neu-text)]">
            {SECTION_LABELS[section]}
          </h2>
          <div className="flex items-center gap-2 text-xs text-[var(--neu-text-muted)]">
            <span className="font-mono">
              {entries.length} {entries.length === 1 ? 'item' : 'items'}
            </span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={onToggleSort}
              className="hover:text-[var(--neu-accent)] inline-flex items-center gap-1 transition-colors"
              data-tip="Change sort order"
            >
              <ArrowUpDown className="w-3 h-3" />
              <span>{sortMode === 'recent' ? 'Recent' : 'A–Z'}</span>
            </button>
          </div>
        </div>

        {section === 'trash' ? (
          <button
            type="button"
            disabled={entries.length === 0}
            onClick={onEmptyTrash}
            className="neu-btn px-3.5 py-2 rounded-[12px] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
            style={{ color: entries.length > 0 ? 'var(--neu-danger)' : undefined }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Empty Trash</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onAddEntry}
            data-tip="New Entry (Ctrl+N)"
            className="neu-btn-primary px-3.5 py-2 rounded-[12px] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Entry</span>
          </button>
        )}
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-[var(--neu-text-subtle)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search vault (Ctrl+K)"
          aria-label="Search vault entries"
          spellCheck={false}
          autoComplete="off"
          className="neu-input w-full rounded-[14px] pl-10 pr-9 py-2.5 text-sm"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-[var(--neu-text-muted)] hover:text-[var(--neu-text)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {allTags.length > 0 && section !== 'trash' && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => onSelectTag(null)}
            className={`px-2.5 py-1 rounded-[10px] text-xs font-medium whitespace-nowrap shrink-0 transition-all ${
              selectedTag === null
                ? 'neu-inset-sm text-[var(--neu-accent)]'
                : 'text-[var(--neu-text-muted)] hover:text-[var(--neu-text)]'
            }`}
          >
            All Tags
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onSelectTag(selectedTag === tag ? null : tag)}
              className={`px-2.5 py-1 rounded-[10px] text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0 transition-all ${
                selectedTag === tag
                  ? 'neu-inset-sm text-[var(--neu-accent)]'
                  : 'text-[var(--neu-text-muted)] hover:text-[var(--neu-text)]'
              }`}
            >
              <Tag className="w-3 h-3" />
              <span>{tag}</span>
            </button>
          ))}
        </div>
      )}

      {showDuplicateBanner && (
        <button
          type="button"
          onClick={onGoToAudit}
          className="neu-inset-sm rounded-[14px] px-3.5 py-2.5 flex items-center justify-between gap-2 text-left hover:opacity-90 transition-opacity"
        >
          <span className="flex items-center gap-2 text-xs text-[var(--neu-text)] min-w-0">
            <GitMerge className="w-3.5 h-3.5 text-[var(--neu-warning)] shrink-0" />
            <span className="truncate">
              {duplicates.length} duplicate {duplicates.length === 1 ? 'site' : 'sites'} detected
            </span>
          </span>
          <span className="text-xs font-semibold text-[var(--neu-accent)] whitespace-nowrap shrink-0">
            Merge
          </span>
        </button>
      )}

      <div className="flex-1 overflow-y-auto space-y-2 pr-1 pt-2 neu-scroll-fade">
        {entries.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 py-10 space-y-4">
            <div className="neu-inset w-14 h-14 rounded-[18px] flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-[var(--neu-accent)]" />
            </div>

            {totalVaultCount === 0 && section !== 'trash' ? (
              <>
                <div className="space-y-1.5">
                  <h3 className="text-sm font-semibold text-[var(--neu-text)]">
                    Your vault is empty — add your first login
                  </h3>
                  <p className="text-xs text-[var(--neu-text-muted)] leading-relaxed">
                    Everything is encrypted locally with XChaCha20-Poly1305. Save logins, 2FA codes, cards, or secure notes.
                  </p>
                </div>
                <div className="flex flex-col w-full gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={onAddEntry}
                    className="neu-btn-primary w-full py-2.5 rounded-[14px] text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add First Login</span>
                  </button>
                </div>
              </>
            ) : !searchQuery && !selectedTag && categoryEmpty ? (
              <>
                <div className="space-y-1.5">
                  <h3 className="text-sm font-semibold text-[var(--neu-text)]">
                    {categoryEmpty.title}
                  </h3>
                  <p className="text-xs text-[var(--neu-text-muted)] leading-relaxed">
                    {categoryEmpty.subtitle}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onAddEntry}
                  className="neu-btn-primary px-5 py-2.5 rounded-[14px] text-xs font-semibold flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>{categoryEmpty.cta}</span>
                </button>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-[var(--neu-text)]">
                    {section === 'trash' ? 'Trash is empty' : 'No matching items'}
                  </h3>
                  <p className="text-xs text-[var(--neu-text-muted)]">
                    {section === 'trash'
                      ? 'Deleted items appear here until you restore or empty them.'
                      : 'Try clearing your search or selecting another category.'}
                  </p>
                </div>
                {(searchQuery || selectedTag) && (
                  <button
                    type="button"
                    onClick={() => {
                      onSearchChange('');
                      onSelectTag(null);
                    }}
                    className="neu-btn px-4 py-2 rounded-[12px] text-xs font-medium"
                  >
                    Clear Filters
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          entries.map((entry) => {
            const selected = entry.id === selectedId;
            return (
              <button
                key={entry.id}
                ref={(el) => {
                  itemRefs.current[entry.id] = el;
                }}
                type="button"
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelectEntry(entry.id)}
                className={`w-full text-left rounded-[16px] px-3.5 py-3 flex items-center gap-3 transition-all ${
                  selected
                    ? 'neu-inset-sm'
                    : 'hover:bg-black/[0.025] dark:hover:bg-white/[0.025]'
                }`}
              >
                <div className="neu-raised-xs w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0">
                  {renderCategoryAvatar(entry)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-sm font-semibold truncate ${
                        selected ? 'text-[var(--neu-accent)]' : 'text-[var(--neu-text)]'
                      }`}
                    >
                      {entry.title}
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {entry.totpSecret && (
                        <ShieldCheck
                          className="w-3.5 h-3.5 text-[var(--neu-accent)]"
                          aria-label="2FA enabled"
                        />
                      )}
                      {entry.favorite && (
                        <Star
                          className="w-3.5 h-3.5 fill-amber-500 text-amber-500"
                          aria-label="Favorite"
                        />
                      )}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--neu-text-muted)] truncate mt-0.5">
                    {getSubtitle(entry)}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
};
