import React, { useEffect, useState } from 'react';
import { Check, Copy, Plus, RefreshCw, Wand2 } from 'lucide-react';
import { generatePassphrase, generateRandomPassword } from '../utils/password';
import { NeuSwitch } from './NeuSwitch';
import { StrengthMeter } from './StrengthMeter';

interface PasswordGeneratorViewProps {
  onCopy: (value: string, label: string) => void;
  onUseInNewEntry?: (password: string) => void;
}

export const PasswordGeneratorView: React.FC<PasswordGeneratorViewProps> = ({
  onCopy,
  onUseInNewEntry,
}) => {
  const [mode, setMode] = useState<'password' | 'passphrase'>('password');

  // Password mode
  const [length, setLength] = useState(20);
  const [uppercase, setUppercase] = useState(true);
  const [lowercase, setLowercase] = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);

  // Passphrase mode
  const [wordCount, setWordCount] = useState(5);
  const [separator, setSeparator] = useState('-');
  const [capitalize, setCapitalize] = useState(false);
  const [includeNumber, setIncludeNumber] = useState(true);

  const [generated, setGenerated] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [copiedMain, setCopiedMain] = useState(false);
  const [copiedHistIdx, setCopiedHistIdx] = useState<number | null>(null);
  const [generateError, setGenerateError] = useState('');

  const regenSeqRef = React.useRef(0);

  const regenerate = async () => {
    const seq = ++regenSeqRef.current;
    try {
      const next =
        mode === 'password'
          ? await generateRandomPassword({
              length,
              uppercase,
              lowercase,
              numbers,
              symbols,
              excludeAmbiguous,
            })
          : await generatePassphrase({
              wordCount,
              separator,
              capitalize,
              includeNumber,
            });
      // Ignore stale results if the options changed while generating.
      if (seq !== regenSeqRef.current) return;
      setGenerateError('');
      setGenerated(next);
      setHistory((prev) => [next, ...prev.filter((p) => p !== next)].slice(0, 6));
    } catch (err) {
      if (seq !== regenSeqRef.current) return;
      setGenerateError(
        err instanceof Error ? err.message : 'Could not generate a password.'
      );
      setGenerated('');
    }
  };

  useEffect(() => {
    void regenerate();
  }, [
    mode,
    length,
    uppercase,
    lowercase,
    numbers,
    symbols,
    excludeAmbiguous,
    wordCount,
    separator,
    capitalize,
    includeNumber,
  ]);

  const handleCopyMain = () => {
    if (!generated) return;
    onCopy(generated, 'Generated Password');
    setCopiedMain(true);
    setTimeout(() => setCopiedMain(false), 1600);
  };

  const enabledPoolCount = [uppercase, lowercase, numbers, symbols].filter(Boolean).length;

  return (
    <div className="flex-1 h-full overflow-y-auto pr-1 neu-scroll-fade">
      <div className="max-w-3xl mx-auto space-y-6 pt-3 pb-8">
        <div className="neu-raised rounded-[22px] p-6 lg:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="neu-inset-sm w-12 h-12 rounded-[16px] flex items-center justify-center shrink-0">
                <Wand2 className="w-5 h-5 text-[var(--neu-accent)]" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-[var(--neu-text)]">
                  Password Generator
                </h1>
                <p className="text-xs text-[var(--neu-text-muted)]">
                  Cryptographically random offline generation
                </p>
              </div>
            </div>

            <div className="neu-inset-sm p-1 rounded-[14px] flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMode('password')}
                className={`px-4 py-2 rounded-[11px] text-xs font-semibold transition-all whitespace-nowrap ${
                  mode === 'password'
                    ? 'neu-raised-xs text-[var(--neu-accent)]'
                    : 'text-[var(--neu-text-muted)]'
                }`}
              >
                Characters
              </button>
              <button
                type="button"
                onClick={() => setMode('passphrase')}
                className={`px-4 py-2 rounded-[11px] text-xs font-semibold transition-all whitespace-nowrap ${
                  mode === 'passphrase'
                    ? 'neu-raised-xs text-[var(--neu-accent)]'
                    : 'text-[var(--neu-text-muted)]'
                }`}
              >
                Passphrase
              </button>
            </div>
          </div>

          {/* Output Display */}
          <div className="neu-inset rounded-[18px] p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="font-mono text-lg sm:text-xl font-semibold text-[var(--neu-text)] break-all select-all leading-relaxed">
                {generated}
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => void regenerate()}
                  aria-label="Generate new password"
                  className="neu-btn w-11 h-11 rounded-[14px] flex items-center justify-center text-[var(--neu-text-muted)] hover:text-[var(--neu-accent)]"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleCopyMain}
                  disabled={!generated}
                  className="neu-btn-primary px-5 h-11 rounded-[14px] text-xs font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  {copiedMain ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            {generateError && (
              <p role="alert" className="text-xs font-medium text-[var(--neu-danger)]">
                {generateError}
              </p>
            )}
            <StrengthMeter password={generated} showCrackTime />

            {onUseInNewEntry && (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => onUseInNewEntry(generated)}
                  disabled={!generated}
                  className="neu-btn px-4 py-2 rounded-[12px] text-xs font-semibold text-[var(--neu-accent)] flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Save as New Login</span>
                </button>
              </div>
            )}
          </div>

          {/* Options */}
          {mode === 'password' ? (
            <div className="space-y-5">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-sm">
                  <label htmlFor="pw-length-slider" className="font-medium text-[var(--neu-text)]">
                    Length
                  </label>
                  <span className="font-mono font-semibold text-[var(--neu-accent)]">
                    {length} characters
                  </span>
                </div>
                <input
                  id="pw-length-slider"
                  type="range"
                  min={8}
                  max={64}
                  value={length}
                  onChange={(e) => setLength(Number(e.target.value))}
                  className="neu-range w-full"
                  style={{ '--fill': `${((length - 8) / (64 - 8)) * 100}%` } as React.CSSProperties}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <NeuSwitch
                  label="Uppercase (A–Z)"
                  checked={uppercase}
                  onChange={setUppercase}
                  disabled={uppercase && enabledPoolCount === 1}
                />
                <NeuSwitch
                  label="Lowercase (a–z)"
                  checked={lowercase}
                  onChange={setLowercase}
                  disabled={lowercase && enabledPoolCount === 1}
                />
                <NeuSwitch
                  label="Numbers (0–9)"
                  checked={numbers}
                  onChange={setNumbers}
                  disabled={numbers && enabledPoolCount === 1}
                />
                <NeuSwitch
                  label="Symbols (!@#$%)"
                  checked={symbols}
                  onChange={setSymbols}
                  disabled={symbols && enabledPoolCount === 1}
                />
              </div>

              <NeuSwitch
                label="Exclude ambiguous characters"
                description="Avoids 0, O, 1, l, and I for easier manual reading"
                checked={excludeAmbiguous}
                onChange={setExcludeAmbiguous}
              />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-sm">
                  <label htmlFor="pp-words-slider" className="font-medium text-[var(--neu-text)]">
                    Word Count
                  </label>
                  <span className="font-mono font-semibold text-[var(--neu-accent)]">
                    {wordCount} words
                  </span>
                </div>
                <input
                  id="pp-words-slider"
                  type="range"
                  min={3}
                  max={10}
                  value={wordCount}
                  onChange={(e) => setWordCount(Number(e.target.value))}
                  className="neu-range w-full"
                  style={{ '--fill': `${((wordCount - 3) / (10 - 3)) * 100}%` } as React.CSSProperties}
                />
              </div>

              <div className="space-y-2">
                <span className="block text-sm font-medium text-[var(--neu-text)]">
                  Word Separator
                </span>
                <div className="grid grid-cols-4 gap-2.5">
                  {[
                    { val: '-', label: 'Dash (-)' },
                    { val: '.', label: 'Dot (.)' },
                    { val: '_', label: 'Underscore (_)' },
                    { val: ' ', label: 'Space' },
                  ].map((sep) => (
                    <button
                      key={sep.val}
                      type="button"
                      onClick={() => setSeparator(sep.val)}
                      className={`py-2.5 px-3 rounded-[12px] text-xs font-medium whitespace-nowrap transition-all ${
                        separator === sep.val
                          ? 'neu-inset-sm text-[var(--neu-accent)] font-semibold'
                          : 'neu-btn text-[var(--neu-text-muted)]'
                      }`}
                    >
                      {sep.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <NeuSwitch
                  label="Capitalize words"
                  checked={capitalize}
                  onChange={setCapitalize}
                />
                <NeuSwitch
                  label="Include a number"
                  checked={includeNumber}
                  onChange={setIncludeNumber}
                />
              </div>
            </div>
          )}
        </div>

        {/* Session Generated History */}
        {history.length > 1 && (
          <div className="neu-raised rounded-[22px] p-6 space-y-3">
            <h2 className="text-sm font-semibold text-[var(--neu-text)]">
              Recent This Session
            </h2>
            <div className="space-y-2">
              {history.slice(1).map((item, idx) => (
                <div
                  key={`${item}-${idx}`}
                  className="neu-inset-sm rounded-[14px] px-4 py-2.5 flex items-center justify-between gap-3"
                >
                  <span className="font-mono text-xs text-[var(--neu-text)] truncate">
                    {item}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onCopy(item, 'Password');
                      setCopiedHistIdx(idx);
                      setTimeout(() => setCopiedHistIdx(null), 1500);
                    }}
                    className="neu-btn px-3 py-1.5 rounded-[10px] text-xs font-medium whitespace-nowrap shrink-0"
                  >
                    {copiedHistIdx === idx ? 'Copied' : 'Copy'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
