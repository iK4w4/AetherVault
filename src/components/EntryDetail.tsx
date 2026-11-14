import React, { useEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  CreditCard,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Globe,
  History,
  RotateCcw,
  Star,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { VaultEntry } from '../types/vault';
import { detectCardBrand, formatCardNumberMasked } from '../utils/password';
import { StrengthMeter } from './StrengthMeter';
import { TotpWidget } from './TotpWidget';

interface EntryDetailProps {
  entry: VaultEntry | null;
  onCopy: (value: string, label: string) => void;
  onToggleFavorite: (entry: VaultEntry) => void;
  onEdit: (entry: VaultEntry) => void;
  onMoveToTrash: (entry: VaultEntry) => void;
  onRestoreFromTrash: (entry: VaultEntry) => void;
  onDeleteForever: (entry: VaultEntry) => void;
  onRestorePasswordHistory: (entry: VaultEntry, historicPassword: string) => void;
  onBackToList?: () => void;
  onNotify?: (message: string) => void;
}

export const EntryDetail: React.FC<EntryDetailProps> = ({
  entry,
  onCopy,
  onToggleFavorite,
  onEdit,
  onMoveToTrash,
  onRestoreFromTrash,
  onDeleteForever,
  onRestorePasswordHistory,
  onBackToList,
  onNotify,
}) => {
  const [revealPassword, setRevealPassword] = useState(false);
  const [revealCardNumber, setRevealCardNumber] = useState(false);
  const [revealCvv, setRevealCvv] = useState(false);
  const [revealPin, setRevealPin] = useState(false);
  const [revealedCustomIds, setRevealedCustomIds] = useState<Record<string, boolean>>({});
  const [revealedHistoryIndices, setRevealedHistoryIndices] = useState<Record<number, boolean>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  // Reset all reveal toggles when switching to another entry to avoid leaking secrets
  useEffect(() => {
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    setRevealPassword(false);
    setRevealCardNumber(false);
    setRevealCvv(false);
    setRevealPin(false);
    setRevealedCustomIds({});
    setRevealedHistoryIndices({});
    setCopiedField(null);
    setShowHistory(false);
  }, [entry?.id]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  if (!entry) {
    return (
      <div className="flex-1 h-full neu-raised rounded-[22px] flex flex-col items-center justify-center p-10 text-center">
        <div className="neu-inset w-16 h-16 rounded-[20px] flex items-center justify-center mb-4">
          <Globe className="w-7 h-7 text-[var(--neu-text-subtle)]" />
        </div>
        <h3 className="text-base font-semibold text-[var(--neu-text)]">
          Select an item to inspect
        </h3>
        <p className="text-xs text-[var(--neu-text-muted)] max-w-xs mt-1.5 leading-relaxed">
          Use Up and Down arrows to browse, or press Ctrl+K to jump directly to any credential.
        </p>
      </div>
    );
  }

  const triggerCopy = (value: string, fieldKey: string, label: string) => {
    if (!value) return;
    onCopy(value, label);
    setCopiedField(fieldKey);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedField((prev) => (prev === fieldKey ? null : prev));
    }, 1600);
  };

  const categoryIcon = () => {
    switch (entry.category) {
      case 'login':
        return <Globe className="w-6 h-6 text-[var(--neu-accent)]" />;
      case 'card':
        return <CreditCard className="w-6 h-6 text-[var(--neu-accent)]" />;
      case 'identity':
        return <UserCheck className="w-6 h-6 text-[var(--neu-accent)]" />;
      default:
        return <FileText className="w-6 h-6 text-[var(--neu-accent)]" />;
    }
  };

  const safeHref = (url?: string) => {
    if (!url) return undefined;
    const trimmed = url.trim();
    if (!trimmed) return undefined;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
    }
    return `https://${trimmed}`;
  };

  const cardBrand = entry.category === 'card' ? detectCardBrand(entry.cardNumber) : null;

  const renderCopyRow = (
    label: string,
    value: string | undefined,
    fieldKey: string,
    options?: {
      mono?: boolean;
      masked?: boolean;
      maskedDisplay?: string;
      revealed?: boolean;
      onToggleReveal?: () => void;
      externalUrl?: string;
    }
  ) => {
    if (!value) return null;
    const isMasked = options?.masked && !options?.revealed;
    const displayValue = isMasked
      ? options?.maskedDisplay || '•'.repeat(Math.min(Math.max(value.length, 8), 18))
      : value;

    return (
      <div
        key={fieldKey}
        className="neu-inset rounded-[16px] px-4 py-3 flex items-center justify-between gap-4"
      >
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-[var(--neu-text-muted)] mb-0.5">
            {label}
          </div>
          <div
            className={`text-sm text-[var(--neu-text)] break-all ${
              options?.mono ? 'font-mono' : 'font-medium'
            }`}
          >
            {displayValue}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {options?.masked && options.onToggleReveal && (
            <button
              type="button"
              onClick={options.onToggleReveal}
              aria-label={options.revealed ? `Hide ${label}` : `Show ${label}`}
              className="neu-btn w-9 h-9 rounded-[11px] flex items-center justify-center text-[var(--neu-text-muted)]"
            >
              {options.revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
          {options?.externalUrl && (
            <button
              type="button"
              onClick={() =>
                void openUrl(options.externalUrl!).catch(() =>
                  onNotify?.('Could not open the link.')
                )
              }
              aria-label={`Open ${label}`}
              className="neu-btn w-9 h-9 rounded-[11px] flex items-center justify-center text-[var(--neu-text-muted)]"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => triggerCopy(value, fieldKey, label)}
            aria-label={`Copy ${label}`}
            className="neu-btn px-3 h-9 rounded-[11px] text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            {copiedField === fieldKey ? (
              <>
                <Check className="w-3.5 h-3.5 text-[var(--neu-success)]" />
                <span className="text-[var(--neu-success)]">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-[var(--neu-text-muted)]" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 h-full neu-raised rounded-[22px] p-5 lg:p-8 overflow-y-auto flex flex-col gap-6">
      {/* Compact back button on mobile/tablet */}
      {onBackToList && (
        <div className="lg:hidden">
          <button
            type="button"
            onClick={onBackToList}
            className="neu-btn px-3.5 py-2 rounded-[12px] text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to list</span>
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-[var(--neu-divider)]">
        <div className="flex items-center gap-4 min-w-0">
          <div className="neu-raised-sm w-14 h-14 rounded-[18px] flex items-center justify-center shrink-0">
            {categoryIcon()}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[var(--neu-text)] truncate">
              {entry.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--neu-text-muted)] mt-1">
              <span className="capitalize">{cardBrand || entry.category}</span>
              <span aria-hidden="true">·</span>
              <span>Updated {new Date(entry.updatedAt).toLocaleDateString()}</span>
              {entry.tags.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{entry.tags.join(' · ')}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {entry.trashedAt ? (
            <>
              <button
                type="button"
                onClick={() => onRestoreFromTrash(entry)}
                className="neu-btn px-4 py-2.5 rounded-[13px] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5 text-[var(--neu-accent)]" />
                <span>Restore</span>
              </button>
              <button
                type="button"
                onClick={() => onDeleteForever(entry)}
                className="neu-btn px-4 py-2.5 rounded-[13px] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                style={{ color: 'var(--neu-danger)' }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Forever</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onToggleFavorite(entry)}
                aria-label={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
                className={`neu-btn w-10 h-10 rounded-[13px] flex items-center justify-center ${
                  entry.favorite ? 'neu-btn-pressed' : ''
                }`}
              >
                <Star
                  className={`w-4 h-4 ${
                    entry.favorite
                      ? 'fill-amber-500 text-amber-500'
                      : 'text-[var(--neu-text-muted)]'
                  }`}
                />
              </button>
              <button
                type="button"
                onClick={() => onEdit(entry)}
                className="neu-btn px-4 h-10 rounded-[13px] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Edit3 className="w-3.5 h-3.5 text-[var(--neu-accent)]" />
                <span>Edit</span>
              </button>
              <button
                type="button"
                onClick={() => onMoveToTrash(entry)}
                aria-label="Move to Trash"
                className="neu-btn w-10 h-10 rounded-[13px] flex items-center justify-center text-[var(--neu-text-muted)] hover:text-[var(--neu-danger)]"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Category-specific fields */}
      <div className="space-y-3.5">
        {entry.category === 'login' && (
          <>
            {renderCopyRow('Username / Email', entry.username, 'username')}
            {entry.password && (
              <div className="space-y-2.5">
                {renderCopyRow('Password', entry.password, 'password', {
                  mono: true,
                  masked: true,
                  revealed: revealPassword,
                  onToggleReveal: () => setRevealPassword((v) => !v),
                })}
                <div className="px-1">
                  <StrengthMeter password={entry.password} />
                </div>
              </div>
            )}
            {entry.totpSecret && (
              <TotpWidget
                secret={entry.totpSecret}
                onCopy={(code) => triggerCopy(code, 'totp', '2FA Code')}
              />
            )}
            {renderCopyRow('Website URL', entry.url, 'url', {
              externalUrl: safeHref(entry.url),
            })}
          </>
        )}

        {entry.category === 'card' && (
          <>
            {renderCopyRow('Cardholder Name', entry.cardholderName, 'cardholder')}
            {renderCopyRow(
              cardBrand ? `${cardBrand} Number` : 'Card Number',
              entry.cardNumber,
              'cardNumber',
              {
                mono: true,
                masked: true,
                maskedDisplay: entry.cardNumber
                  ? formatCardNumberMasked(entry.cardNumber)
                  : undefined,
                revealed: revealCardNumber,
                onToggleReveal: () => setRevealCardNumber((v) => !v),
              }
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              {renderCopyRow('Expiry', entry.cardExpiry, 'cardExpiry', { mono: true })}
              {renderCopyRow('CVV', entry.cardCvv, 'cardCvv', {
                mono: true,
                masked: true,
                revealed: revealCvv,
                onToggleReveal: () => setRevealCvv((v) => !v),
              })}
              {renderCopyRow('PIN', entry.cardPin, 'cardPin', {
                mono: true,
                masked: true,
                revealed: revealPin,
                onToggleReveal: () => setRevealPin((v) => !v),
              })}
            </div>
          </>
        )}

        {entry.category === 'identity' && (
          <>
            {renderCopyRow('Full Name', entry.fullName, 'fullName')}
            {renderCopyRow('Email Address', entry.email, 'email')}
            {renderCopyRow('Phone Number', entry.phone, 'phone', { mono: true })}
            {renderCopyRow('Address', entry.address, 'address')}
            {renderCopyRow('ID / Passport Number', entry.idNumber, 'idNumber', { mono: true })}
          </>
        )}

        {/* Custom Fields */}
        {entry.customFields.length > 0 && (
          <div className="space-y-2.5 pt-2">
            <h3 className="text-xs font-semibold text-[var(--neu-text-muted)] px-1">
              Custom Fields
            </h3>
            {entry.customFields.map((field) =>
              renderCopyRow(field.label, field.value, `cf-${field.id}`, {
                mono: field.hidden,
                masked: field.hidden,
                revealed: Boolean(revealedCustomIds[field.id]),
                onToggleReveal: () =>
                  setRevealedCustomIds((prev) => ({
                    ...prev,
                    [field.id]: !prev[field.id],
                  })),
              })
            )}
          </div>
        )}

        {/* Notes */}
        {entry.notes && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold text-[var(--neu-text-muted)]">Notes</h3>
              <button
                type="button"
                onClick={() => triggerCopy(entry.notes, 'notes', 'Notes')}
                className="text-xs font-medium text-[var(--neu-accent)] hover:underline"
              >
                {copiedField === 'notes' ? 'Copied' : 'Copy notes'}
              </button>
            </div>
            <div className="neu-inset rounded-[16px] p-4 text-sm text-[var(--neu-text)] whitespace-pre-wrap leading-relaxed">
              {entry.notes}
            </div>
          </div>
        )}

        {/* Empty details fallback */}
        {!entry.username &&
          !entry.password &&
          !entry.totpSecret &&
          !entry.url &&
          !entry.cardholderName &&
          !entry.cardNumber &&
          !entry.cardExpiry &&
          !entry.cardCvv &&
          !entry.cardPin &&
          !entry.fullName &&
          !entry.email &&
          !entry.phone &&
          !entry.address &&
          !entry.idNumber &&
          entry.customFields.length === 0 &&
          !entry.notes && (
            <div className="neu-inset-sm rounded-[16px] px-4 py-6 text-center space-y-2">
              <p className="text-xs text-[var(--neu-text-muted)]">
                No details saved for this entry yet.
              </p>
              {!entry.trashedAt && (
                <button
                  type="button"
                  onClick={() => onEdit(entry)}
                  className="text-xs font-semibold text-[var(--neu-accent)] hover:underline"
                >
                  Edit entry to add details
                </button>
              )}
            </div>
          )}

        {/* Password History */}
        {entry.category === 'login' &&
          entry.passwordHistory &&
          entry.passwordHistory.length > 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="neu-btn w-full px-4 py-3 rounded-[15px] text-xs font-semibold flex items-center justify-between"
              >
                <span className="flex items-center gap-2 text-[var(--neu-text-muted)]">
                  <History className="w-4 h-4 text-[var(--neu-accent)]" />
                  <span>Password History ({entry.passwordHistory.length})</span>
                </span>
                {showHistory ? (
                  <ChevronUp className="w-4 h-4 text-[var(--neu-text-muted)]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[var(--neu-text-muted)]" />
                )}
              </button>

              {showHistory && (
                <div className="mt-3 space-y-2">
                  {entry.passwordHistory.map((hist, index) => {
                    const isRevealed = Boolean(revealedHistoryIndices[index]);
                    return (
                      <div
                        key={`${hist.changedAt}-${index}`}
                        className="neu-inset-sm rounded-[14px] px-4 py-2.5 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-xs text-[var(--neu-text)] truncate">
                            {isRevealed
                              ? hist.password
                              : '•'.repeat(Math.min(Math.max(hist.password.length, 8), 16))}
                          </div>
                          <div className="text-[11px] text-[var(--neu-text-muted)]">
                            Replaced {new Date(hist.changedAt).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setRevealedHistoryIndices((prev) => ({
                                ...prev,
                                [index]: !prev[index],
                              }))
                            }
                            aria-label={isRevealed ? 'Hide historic password' : 'Show historic password'}
                            className="neu-btn w-8 h-8 rounded-[10px] flex items-center justify-center text-[var(--neu-text-muted)]"
                          >
                            {isRevealed ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              triggerCopy(hist.password, `hist-${index}`, 'Previous Password')
                            }
                            className="neu-btn px-2.5 py-1.5 rounded-[10px] text-xs font-medium"
                          >
                            {copiedField === `hist-${index}` ? 'Copied' : 'Copy'}
                          </button>
                          {!entry.trashedAt && (
                            <button
                              type="button"
                              onClick={() => onRestorePasswordHistory(entry, hist.password)}
                              className="neu-btn px-2.5 py-1.5 rounded-[10px] text-xs font-medium text-[var(--neu-accent)]"
                            >
                              Restore
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
      </div>
    </div>
  );
};
