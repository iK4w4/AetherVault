import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { CustomField, EntryCategory, VaultEntry } from '../types/vault';
import { createId } from '../utils/importers';
import {
  detectCardBrand,
  formatCardNumberGroups,
  generatePassphrase,
  generateRandomPassword,
  isValidLuhnCard,
} from '../utils/password';
import { formatTotpStorage, isValidTotpSecret } from '../utils/totp';
import { MasterPasswordPrompt } from './ConfirmDialog';
import { StrengthMeter } from './StrengthMeter';
import { TotpWidget } from './TotpWidget';

interface EntryEditorModalProps {
  open: boolean;
  initialEntry: VaultEntry | null;
  defaultCategory?: EntryCategory;
  prefillPassword?: string;
  existingTags?: string[];
  unlockedViaRecovery?: boolean;
  onSave: (entryData: VaultEntry, previousPassword?: string) => Promise<void>;
  onClose: () => void;
  onCopy: (value: string, label: string) => void;
}

export const EntryEditorModal: React.FC<EntryEditorModalProps> = ({
  open,
  initialEntry,
  defaultCategory = 'login',
  prefillPassword = '',
  existingTags = [],
  unlockedViaRecovery = false,
  onSave,
  onClose,
  onCopy,
}) => {
  const [category, setCategory] = useState<EntryCategory>(defaultCategory);
  const [title, setTitle] = useState('');
  const [favorite, setFavorite] = useState(false);

  // Login
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [url, setUrl] = useState('');
  const [totpSecret, setTotpSecret] = useState('');

  // Inline smart generator popover
  const [showInlineGen, setShowInlineGen] = useState(false);
  const [genMode, setGenMode] = useState<'chars' | 'words'>('chars');
  const [genLength, setGenLength] = useState(20);
  const [genWordCount, setGenWordCount] = useState(5);
  const [genError, setGenError] = useState('');

  // Card
  const [cardholderName, setCardholderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardPin, setCardPin] = useState('');
  const [showCardSecrets, setShowCardSecrets] = useState(false);

  // Identity
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [idNumber, setIdNumber] = useState('');

  // Shared
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [copiedPw, setCopiedPw] = useState(false);
  const [askMasterPassword, setAskMasterPassword] = useState(false);
  const [pendingEntry, setPendingEntry] = useState<{
    entry: VaultEntry;
    previousPassword?: string;
  } | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      // Don't leave secrets in state after the modal closes.
      setPassword('');
      setTotpSecret('');
      setCardCvv('');
      setCardPin('');
      return;
    }
    setErrors({});
    setAskMasterPassword(false);
    setPendingEntry(null);
    setShowPassword(false);
    setShowCardSecrets(false);
    setShowInlineGen(false);

    if (initialEntry) {
      setCategory(initialEntry.category);
      setTitle(initialEntry.title);
      setFavorite(initialEntry.favorite);
      setUsername(initialEntry.username || '');
      setPassword(initialEntry.password || '');
      setUrl(initialEntry.url || '');
      setTotpSecret(initialEntry.totpSecret || '');
      setCardholderName(initialEntry.cardholderName || '');
      setCardNumber(initialEntry.cardNumber || '');
      setCardExpiry(initialEntry.cardExpiry || '');
      setCardCvv(initialEntry.cardCvv || '');
      setCardPin(initialEntry.cardPin || '');
      setFullName(initialEntry.fullName || '');
      setEmail(initialEntry.email || '');
      setPhone(initialEntry.phone || '');
      setAddress(initialEntry.address || '');
      setIdNumber(initialEntry.idNumber || '');
      setNotes(initialEntry.notes || '');
      setTags(initialEntry.tags || []);
      setCustomFields(initialEntry.customFields || []);
    } else {
      setCategory(prefillPassword ? 'login' : defaultCategory);
      setTitle('');
      setFavorite(false);
      setUsername('');
      setPassword(prefillPassword || '');
      setUrl('');
      setTotpSecret('');
      setCardholderName('');
      setCardNumber('');
      setCardExpiry('');
      setCardCvv('');
      setCardPin('');
      setFullName('');
      setEmail('');
      setPhone('');
      setAddress('');
      setIdNumber('');
      setNotes('');
      setTags([]);
      setCustomFields([]);
    }
    setTagInput('');
    setTimeout(() => titleInputRef.current?.focus(), 40);
  }, [open, initialEntry, defaultCategory, prefillPassword]);

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};
    if (!title.trim()) {
      nextErrors.title = 'Please enter a title for this entry.';
    }
    if (category === 'login') {
      if (url.trim() && /\s/.test(url.trim())) {
        nextErrors.url = 'Website URL cannot contain spaces.';
      }
      if (totpSecret.trim() && !isValidTotpSecret(totpSecret)) {
        nextErrors.totpSecret =
          'Enter a valid Base32 secret (A-Z, 2-7) or an otpauth:// authenticator URI.';
      }
    }
    if (category === 'card' && cardExpiry.trim()) {
      const match = cardExpiry.trim().match(/^(\d{2})\/(\d{2,4})$/);
      if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) {
        nextErrors.cardExpiry = 'Use MM/YY format with a valid month (01–12).';
      }
    }
    if (category === 'identity' && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      nextErrors.email = 'Enter a valid email address.';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const prepareSave = () => {
    if (!validate()) return;
    const now = Date.now();
    const extraTags = tagInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const cleanedTags = Array.from(
      new Set([...tags, ...extraTags].map((t) => t.trim()).filter(Boolean))
    );

    const passwordModified =
      category === 'login' &&
      (!initialEntry || (initialEntry.password || '') !== password);

    const passwordChangedFromExisting =
      category === 'login' &&
      Boolean(initialEntry) &&
      Boolean(initialEntry?.password) &&
      initialEntry?.password !== password;

    const updatedHistory = [...(initialEntry?.passwordHistory || [])];
    if (passwordChangedFromExisting && initialEntry?.password) {
      updatedHistory.unshift({
        password: initialEntry.password,
        changedAt: now,
      });
    }

    const normalizedTotp = formatTotpStorage(totpSecret);

    const built: VaultEntry = {
      id: initialEntry?.id || createId(),
      category,
      title: title.trim(),
      favorite,
      tags: cleanedTags,
      notes,
      customFields: customFields.filter((f) => f.label.trim() || f.value.trim()),
      createdAt: initialEntry?.createdAt || now,
      updatedAt: now,
      trashedAt: initialEntry?.trashedAt || null,
      ...(category === 'login'
        ? {
            username: username.trim(),
            password,
            passwordUpdatedAt: passwordModified
              ? now
              : initialEntry?.passwordUpdatedAt || now,
            passwordHistory: updatedHistory.slice(0, 15),
            url: url.trim(),
            totpSecret: normalizedTotp,
          }
        : {}),
      ...(category === 'card'
        ? {
            cardholderName: cardholderName.trim(),
            cardNumber: cardNumber.trim(),
            cardExpiry: cardExpiry.trim(),
            cardCvv: cardCvv.trim(),
            cardPin: cardPin.trim(),
          }
        : {}),
      ...(category === 'identity'
        ? {
            fullName: fullName.trim(),
            email: email.trim(),
            phone: phone.trim(),
            address: address.trim(),
            idNumber: idNumber.trim(),
          }
        : {}),
    };

    setPendingEntry({
      entry: built,
      previousPassword: passwordChangedFromExisting ? initialEntry?.password : undefined,
    });
    setAskMasterPassword(true);
  };

  const prepareSaveRef = useRef(prepareSave);
  const onCloseRef = useRef(onClose);
  prepareSaveRef.current = prepareSave;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || askMasterPassword) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        prepareSaveRef.current();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, askMasterPassword]);

  if (!open) return null;

  const handleAddTag = (raw: string) => {
    const parts = raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      setTags((prev) => Array.from(new Set([...prev, ...parts])));
    }
    setTagInput('');
  };

  const handleQuickGenerate = async () => {
    try {
      const generated =
        genMode === 'chars'
          ? await generateRandomPassword({
              length: genLength,
              uppercase: true,
              lowercase: true,
              numbers: true,
              symbols: true,
              excludeAmbiguous: false,
            })
          : await generatePassphrase({
              wordCount: genWordCount,
              separator: '-',
              capitalize: false,
              includeNumber: true,
            });
      setGenError('');
      setPassword(generated);
      setShowPassword(true);
    } catch (err) {
      setGenError(
        err instanceof Error ? err.message : 'Could not generate a password.'
      );
    }
  };

  const handleCopyPw = () => {
    if (!password) return;
    onCopy(password, 'Password');
    setCopiedPw(true);
    setTimeout(() => setCopiedPw(false), 1500);
  };

  const addCustomField = () => {
    setCustomFields((prev) => [
      ...prev,
      { id: createId(), label: '', value: '', hidden: false },
    ]);
  };

  const updateCustomField = (id: string, patch: Partial<CustomField>) => {
    setCustomFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch } : f))
    );
  };

  const removeCustomField = (id: string) => {
    setCustomFields((prev) => prev.filter((f) => f.id !== id));
  };

  const categories: { id: EntryCategory; label: string }[] = [
    { id: 'login', label: 'Login' },
    { id: 'note', label: 'Secure Note' },
    { id: 'card', label: 'Card' },
    { id: 'identity', label: 'Identity' },
  ];

  const cardDigits = cardNumber.replace(/\D/g, '');
  const cardBrand = detectCardBrand(cardNumber);
  const showLuhnWarning = cardDigits.length >= 13 && !isValidLuhnCard(cardNumber);

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/25 dark:bg-black/50 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-modal-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="neu-raised w-full max-w-2xl max-h-[90vh] rounded-[24px] flex flex-col overflow-hidden">
          <div className="px-6 py-5 flex items-center justify-between gap-4 border-b border-[var(--neu-divider)] shrink-0">
            <h2 id="editor-modal-title" className="text-lg font-semibold text-[var(--neu-text)]">
              {initialEntry ? 'Edit Entry' : 'New Vault Entry'}
            </h2>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setFavorite((v) => !v)}
                aria-label={favorite ? 'Remove favorite' : 'Mark as favorite'}
                className={`neu-btn w-9 h-9 rounded-[12px] flex items-center justify-center ${
                  favorite ? 'neu-btn-pressed' : ''
                }`}
              >
                <Star
                  className={`w-4 h-4 ${
                    favorite ? 'fill-amber-500 text-amber-500' : 'text-[var(--neu-text-muted)]'
                  }`}
                />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close editor"
                className="neu-btn w-9 h-9 rounded-[12px] flex items-center justify-center text-[var(--neu-text-muted)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              prepareSave();
            }}
            className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
          >
            {!initialEntry && (
              <div className="neu-inset-sm p-1.5 rounded-[16px] grid grid-cols-4 gap-1.5">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`py-2 rounded-[12px] text-xs font-semibold transition-all whitespace-nowrap ${
                      category === cat.id
                        ? 'neu-raised-xs text-[var(--neu-accent)]'
                        : 'text-[var(--neu-text-muted)] hover:text-[var(--neu-text)]'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="entry-title" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                Title
              </label>
              <input
                ref={titleInputRef}
                id="entry-title"
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (errors.title) setErrors((prev) => ({ ...prev, title: '' }));
                }}
                placeholder="e.g. GitHub, Corporate Card, Passport"
                spellCheck={false}
                autoComplete="off"
                className={`neu-input w-full rounded-[14px] px-4 py-3 text-sm ${
                  errors.title ? 'neu-input-error' : ''
                }`}
              />
              {errors.title && (
                <p className="text-xs font-medium text-[var(--neu-danger)]">{errors.title}</p>
              )}
            </div>

            {category === 'login' && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="entry-username" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                    Username or Email
                  </label>
                  <input
                    id="entry-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="name@example.com"
                    spellCheck={false}
                    autoComplete="off"
                    className="neu-input w-full rounded-[14px] px-4 py-3 text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="entry-password" className="text-xs font-medium text-[var(--neu-text-muted)]">
                      Password
                    </label>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setShowInlineGen((v) => !v)}
                        className="text-xs font-medium text-[var(--neu-text-muted)] hover:text-[var(--neu-text)] flex items-center gap-1"
                      >
                        <SlidersHorizontal className="w-3 h-3" />
                        <span>Options</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleQuickGenerate}
                        className="text-xs font-semibold text-[var(--neu-accent)] hover:underline flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Generate Strong Password</span>
                      </button>
                    </div>
                  </div>
                  {genError && (
                    <p role="alert" className="text-xs font-medium text-[var(--neu-danger)]">
                      {genError}
                    </p>
                  )}

                  {showInlineGen && (
                    <div className="neu-inset-sm rounded-[15px] p-3.5 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setGenMode('chars')}
                            className={`px-3 py-1 rounded-[9px] text-xs font-semibold ${
                              genMode === 'chars'
                                ? 'neu-raised-xs text-[var(--neu-accent)]'
                                : 'text-[var(--neu-text-muted)]'
                            }`}
                          >
                            Characters
                          </button>
                          <button
                            type="button"
                            onClick={() => setGenMode('words')}
                            className={`px-3 py-1 rounded-[9px] text-xs font-semibold ${
                              genMode === 'words'
                                ? 'neu-raised-xs text-[var(--neu-accent)]'
                                : 'text-[var(--neu-text-muted)]'
                            }`}
                          >
                            Passphrase
                          </button>
                        </div>
                        <span className="font-mono text-xs font-semibold text-[var(--neu-accent)]">
                          {genMode === 'chars' ? `${genLength} chars` : `${genWordCount} words`}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={genMode === 'chars' ? 10 : 3}
                          max={genMode === 'chars' ? 40 : 8}
                          value={genMode === 'chars' ? genLength : genWordCount}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            if (genMode === 'chars') setGenLength(val);
                            else setGenWordCount(val);
                          }}
                          className="neu-range flex-1"
                          style={
                            {
                              '--fill': `${
                                genMode === 'chars'
                                  ? ((genLength - 10) / 30) * 100
                                  : ((genWordCount - 3) / 5) * 100
                              }%`,
                            } as React.CSSProperties
                          }
                        />
                        <button
                          type="button"
                          onClick={handleQuickGenerate}
                          className="neu-btn px-3 py-1.5 rounded-[10px] text-xs font-semibold text-[var(--neu-accent)] whitespace-nowrap shrink-0"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="relative flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        id="entry-password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter or generate password"
                        className="neu-input w-full rounded-[14px] px-4 py-3 pr-11 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-[10px] flex items-center justify-center text-[var(--neu-text-muted)]"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={!password}
                      onClick={handleCopyPw}
                      aria-label="Copy password"
                      className="neu-btn w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
                    >
                      {copiedPw ? (
                        <Check className="w-4 h-4 text-[var(--neu-success)]" />
                      ) : (
                        <Copy className="w-4 h-4 text-[var(--neu-text-muted)]" />
                      )}
                    </button>
                  </div>
                  <StrengthMeter password={password} />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="entry-url" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                    Website URL
                  </label>
                  <input
                    id="entry-url"
                    type="text"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      if (errors.url) setErrors((prev) => ({ ...prev, url: '' }));
                    }}
                    placeholder="https://example.com"
                    spellCheck={false}
                    autoComplete="off"
                    className={`neu-input w-full rounded-[14px] px-4 py-3 text-sm ${
                      errors.url ? 'neu-input-error' : ''
                    }`}
                  />
                  {errors.url && (
                    <p className="text-xs font-medium text-[var(--neu-danger)]">{errors.url}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <label htmlFor="entry-totp" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                    Authenticator Secret (Base32 or otpauth:// URI)
                  </label>
                  <input
                    id="entry-totp"
                    type="text"
                    value={totpSecret}
                    onChange={(e) => {
                      setTotpSecret(e.target.value);
                      if (errors.totpSecret) setErrors((prev) => ({ ...prev, totpSecret: '' }));
                    }}
                    placeholder="e.g. JBSWY3DPEHPK3PXP or otpauth://totp/..."
                    className={`neu-input w-full rounded-[14px] px-4 py-3 font-mono text-sm ${
                      errors.totpSecret ? 'neu-input-error' : ''
                    }`}
                  />
                  {errors.totpSecret && (
                    <p className="text-xs font-medium text-[var(--neu-danger)]">
                      {errors.totpSecret}
                    </p>
                  )}
                  {totpSecret.trim() && isValidTotpSecret(totpSecret) && (
                    <TotpWidget
                      compact
                      secret={totpSecret}
                      onCopy={(code) => onCopy(code, '2FA Code')}
                    />
                  )}
                </div>
              </div>
            )}

            {category === 'card' && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="card-holder" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                    Cardholder Name
                  </label>
                  <input
                    id="card-holder"
                    type="text"
                    value={cardholderName}
                    onChange={(e) => setCardholderName(e.target.value)}
                    placeholder="ELENA VANCE"
                    className="neu-input w-full rounded-[14px] px-4 py-3 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="card-number" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                      Card Number
                    </label>
                    {cardBrand && (
                      <span className="text-xs font-medium text-[var(--neu-accent)]">
                        {cardBrand}
                      </span>
                    )}
                  </div>
                  <input
                    id="card-number"
                    type="text"
                    inputMode="numeric"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(formatCardNumberGroups(e.target.value))}
                    placeholder="4532 0000 0000 0000"
                    className="neu-input w-full rounded-[14px] px-4 py-3 font-mono text-sm"
                  />
                  {showLuhnWarning && (
                    <p className="text-xs text-[var(--neu-warning)]">
                      Card number fails standard Luhn check — double-check digits.
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor="card-expiry" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                      Expiry
                    </label>
                    <input
                      id="card-expiry"
                      type="text"
                      inputMode="numeric"
                      maxLength={5}
                      value={cardExpiry}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                        const formatted =
                          digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
                        setCardExpiry(formatted);
                        if (errors.cardExpiry) setErrors((prev) => ({ ...prev, cardExpiry: '' }));
                      }}
                      placeholder="MM/YY"
                      className={`neu-input w-full rounded-[14px] px-4 py-3 font-mono text-sm ${
                        errors.cardExpiry ? 'neu-input-error' : ''
                      }`}
                    />
                    {errors.cardExpiry && (
                      <p className="text-xs font-medium text-[var(--neu-danger)]">
                        {errors.cardExpiry}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="card-cvv" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                        CVV
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowCardSecrets((v) => !v)}
                        className="text-[11px] font-medium text-[var(--neu-accent)] hover:underline"
                      >
                        {showCardSecrets ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <input
                      id="card-cvv"
                      type={showCardSecrets ? 'text' : 'password'}
                      inputMode="numeric"
                      value={cardCvv}
                      onChange={(e) => setCardCvv(e.target.value)}
                      placeholder="123"
                      className="neu-input w-full rounded-[14px] px-4 py-3 font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="card-pin" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                      PIN
                    </label>
                    <input
                      id="card-pin"
                      type={showCardSecrets ? 'text' : 'password'}
                      inputMode="numeric"
                      value={cardPin}
                      onChange={(e) => setCardPin(e.target.value)}
                      placeholder="0000"
                      className="neu-input w-full rounded-[14px] px-4 py-3 font-mono text-sm"
                    />
                  </div>
                </div>
              </div>
            )}

            {category === 'identity' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <label htmlFor="id-fullname" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                      Full Name
                    </label>
                    <input
                      id="id-fullname"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="neu-input w-full rounded-[14px] px-4 py-3 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="id-email" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                      Email
                    </label>
                    <input
                      id="id-email"
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (errors.email) setErrors((prev) => ({ ...prev, email: '' }));
                      }}
                      className={`neu-input w-full rounded-[14px] px-4 py-3 text-sm ${
                        errors.email ? 'neu-input-error' : ''
                      }`}
                    />
                    {errors.email && (
                      <p className="text-xs font-medium text-[var(--neu-danger)]">{errors.email}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="id-phone" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                      Phone
                    </label>
                    <input
                      id="id-phone"
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="neu-input w-full rounded-[14px] px-4 py-3 font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="id-num" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                      ID / Passport Number
                    </label>
                    <input
                      id="id-num"
                      type="text"
                      value={idNumber}
                      onChange={(e) => setIdNumber(e.target.value)}
                      className="neu-input w-full rounded-[14px] px-4 py-3 font-mono text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="id-address" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                    Address
                  </label>
                  <input
                    id="id-address"
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="neu-input w-full rounded-[14px] px-4 py-3 text-sm"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="entry-tags" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                Tags
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTags((prev) => prev.filter((item) => item !== t))}
                    className="neu-btn px-3 py-1.5 rounded-[10px] text-xs font-medium flex items-center gap-1.5"
                  >
                    <Tag className="w-3 h-3 text-[var(--neu-accent)]" />
                    <span>{t}</span>
                    <X className="w-3 h-3 text-[var(--neu-text-muted)]" />
                  </button>
                ))}
                <input
                  id="entry-tags"
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      handleAddTag(tagInput);
                    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
                      setTags((prev) => prev.slice(0, -1));
                    }
                  }}
                  placeholder="Add tag & press Enter..."
                  spellCheck={false}
                  autoComplete="off"
                  className="neu-input flex-1 min-w-[160px] rounded-[12px] px-3.5 py-2 text-xs"
                />
              </div>
              {existingTags.filter((t) => !tags.includes(t)).length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-[11px] text-[var(--neu-text-subtle)] mr-1">
                    Suggestions:
                  </span>
                  {existingTags
                    .filter((t) => !tags.includes(t))
                    .slice(0, 8)
                    .map((sug) => (
                      <button
                        key={sug}
                        type="button"
                        onClick={() => handleAddTag(sug)}
                        className="text-[11px] font-medium text-[var(--neu-text-muted)] hover:text-[var(--neu-accent)] transition-colors px-1.5 py-0.5 rounded-[7px]"
                      >
                        + {sug}
                      </button>
                    ))}
                </div>
              )}
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--neu-text-muted)]">
                  Custom Fields
                </span>
                <button
                  type="button"
                  onClick={addCustomField}
                  className="text-xs font-semibold text-[var(--neu-accent)] hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Field</span>
                </button>
              </div>
              {customFields.map((field) => (
                <div key={field.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={field.label}
                    onChange={(e) => updateCustomField(field.id, { label: e.target.value })}
                    placeholder="Label"
                    className="neu-input w-1/3 rounded-[12px] px-3 py-2.5 text-xs"
                  />
                  <input
                    type={field.hidden ? 'password' : 'text'}
                    value={field.value}
                    onChange={(e) => updateCustomField(field.id, { value: e.target.value })}
                    placeholder="Value"
                    className="neu-input flex-1 rounded-[12px] px-3 py-2.5 text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => updateCustomField(field.id, { hidden: !field.hidden })}
                    aria-label={field.hidden ? 'Show field value' : 'Mask field value'}
                    className="neu-btn w-9 h-9 rounded-[11px] flex items-center justify-center text-[var(--neu-text-muted)] shrink-0"
                  >
                    {field.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCustomField(field.id)}
                    aria-label="Remove custom field"
                    className="neu-btn w-9 h-9 rounded-[11px] flex items-center justify-center text-[var(--neu-text-muted)] hover:text-[var(--neu-danger)] shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="entry-notes" className="block text-xs font-medium text-[var(--neu-text-muted)]">
                Notes
              </label>
              <textarea
                id="entry-notes"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Recovery instructions, security questions, or private notes..."
                spellCheck={false}
                autoComplete="off"
                className="neu-input w-full rounded-[14px] px-4 py-3 text-sm resize-y"
              />
            </div>
          </form>

          <div className="px-6 py-4 border-t border-[var(--neu-divider)] flex items-center justify-between gap-3 shrink-0">
            <span className="text-xs text-[var(--neu-text-muted)]">
              Ctrl+S to save · Esc to close
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="neu-btn px-5 py-2.5 rounded-[14px] text-xs font-semibold whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={prepareSave}
                className="neu-btn-primary px-5 py-2.5 rounded-[14px] text-xs font-semibold whitespace-nowrap shrink-0"
              >
                Save Entry
              </button>
            </div>
          </div>
        </div>
      </div>

      <MasterPasswordPrompt
        open={askMasterPassword}
        title="Verify Master Password to Save"
        description="AetherVault confirms your master password before writing encrypted changes."
        actionLabel="Verify & Save"
        allowRecoveryFallback={unlockedViaRecovery}
        onCancel={() => setAskMasterPassword(false)}
        onVerified={async () => {
          if (!pendingEntry) return;
          await onSave(pendingEntry.entry, pendingEntry.previousPassword);
          setAskMasterPassword(false);
        }}
      />
    </>
  );
};
