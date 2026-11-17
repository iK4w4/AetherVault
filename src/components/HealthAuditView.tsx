import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  CopyCheck,
  GitMerge,
  HeartPulse,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AuditIssueType, DuplicateGroup, HealthReport, VaultEntry } from '../types/vault';

interface HealthAuditViewProps {
  report: HealthReport;
  totpProtectedCount: number;
  onFixEntry: (entryId: string) => void;
  onMergeDuplicates: (primaryId: string, secondaryIds: string[]) => Promise<void>;
}

export const HealthAuditView: React.FC<HealthAuditViewProps> = ({
  report,
  totpProtectedCount,
  onFixEntry,
  onMergeDuplicates,
}) => {
  const [filterType, setFilterType] = useState<AuditIssueType | 'all'>('all');
  const [mergingGroup, setMergingGroup] = useState<DuplicateGroup | null>(null);
  const [selectedPrimaryId, setSelectedPrimaryId] = useState<string>('');
  const [mergingBusy, setMergingBusy] = useState(false);

  useEffect(() => {
    if (!mergingGroup) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !mergingBusy) {
        e.stopPropagation();
        setMergingGroup(null);
      }
    };
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [mergingGroup, mergingBusy]);

  const scoreColor =
    report.score >= 85
      ? 'var(--neu-success)'
      : report.score >= 60
      ? 'var(--neu-warning)'
      : 'var(--neu-danger)';

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - report.score / 100);

  const filteredIssues =
    filterType === 'all'
      ? report.issues
      : report.issues.filter((i) => i.type === filterType);

  const openMergeModal = (group: DuplicateGroup) => {
    setMergingGroup(group);
    const sorted = [...group.entries].sort((a, b) => {
      if (Boolean(b.totpSecret) !== Boolean(a.totpSecret)) {
        return b.totpSecret ? 1 : -1;
      }
      return b.updatedAt - a.updatedAt;
    });
    setSelectedPrimaryId(sorted[0]?.id || '');
  };

  const confirmMerge = async () => {
    if (!mergingGroup || !selectedPrimaryId) return;
    setMergingBusy(true);
    try {
      const secondaryIds = mergingGroup.entries
        .filter((e) => e.id !== selectedPrimaryId)
        .map((e) => e.id);
      await onMergeDuplicates(selectedPrimaryId, secondaryIds);
      setMergingGroup(null);
    } finally {
      setMergingBusy(false);
    }
  };

  const issueIcon = (type: AuditIssueType) => {
    switch (type) {
      case 'weak':
        return <ShieldAlert className="w-4 h-4 text-[var(--neu-warning)]" />;
      case 'reused':
        return <CopyCheck className="w-4 h-4 text-[var(--neu-warning)]" />;
      case 'old':
        return <Clock className="w-4 h-4 text-[var(--neu-text-muted)]" />;
    }
  };

  const categoryCards: {
    id: AuditIssueType;
    label: string;
    count: number;
    tone: string;
  }[] = [
    { id: 'weak', label: 'Weak', count: report.weakCount, tone: 'var(--neu-warning)' },
    { id: 'reused', label: 'Reused', count: report.reusedCount, tone: 'var(--neu-warning)' },
    { id: 'old', label: 'Aging (>180d)', count: report.oldCount, tone: 'var(--neu-text-muted)' },
  ];

  return (
    <div className="flex-1 h-full overflow-y-auto pr-1 neu-scroll-fade">
      <div className="max-w-4xl mx-auto space-y-6 pt-3 pb-8">
        {/* Top Score Summary Card */}
        <div className="neu-raised rounded-[22px] p-6 lg:p-8 flex flex-col md:flex-row items-center gap-8">
          <div className="relative flex items-center justify-center shrink-0 w-36 h-36 neu-inset rounded-full">
            <svg className="-rotate-90 w-32 h-32" viewBox="0 0 128 128">
              <circle
                cx="64"
                cy="64"
                r={radius}
                fill="none"
                stroke="var(--neu-divider)"
                strokeWidth="10"
              />
              <circle
                cx="64"
                cy="64"
                r={radius}
                fill="none"
                stroke={scoreColor}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                style={{ transition: 'stroke-dashoffset 500ms ease' }}
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <span
                className="font-mono text-3xl font-bold leading-none"
                style={{ color: scoreColor }}
              >
                {report.score}
              </span>
              <span className="text-[11px] font-medium text-[var(--neu-text-muted)] mt-1">
                Vault Score
              </span>
            </div>
          </div>

          <div className="flex-1 space-y-4 w-full">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold text-[var(--neu-text)] flex items-center gap-2">
                  <HeartPulse className="w-5 h-5 text-[var(--neu-accent)]" />
                  <span>Password Health Audit</span>
                </h1>
                <p className="text-xs text-[var(--neu-text-muted)] mt-1">
                  Offline analysis across {report.totalLogins}{' '}
                  {report.totalLogins === 1 ? 'login' : 'logins'} · Sorted by risk priority
                </p>
              </div>
              {report.totalLogins > 0 && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--neu-text-muted)]">
                  <ShieldCheck className="w-4 h-4 text-[var(--neu-accent)]" />
                  <span className="font-mono">
                    {totpProtectedCount}/{report.totalLogins}
                  </span>
                  <span>2FA protected</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {categoryCards.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() =>
                    setFilterType((prev) => (prev === cat.id ? 'all' : cat.id))
                  }
                  className={`rounded-[16px] p-3.5 text-left transition-all ${
                    filterType === cat.id ? 'neu-inset-sm' : 'neu-raised-xs'
                  }`}
                >
                  <div
                    className="font-mono text-2xl font-bold"
                    style={{ color: cat.count > 0 ? cat.tone : 'var(--neu-success)' }}
                  >
                    {cat.count}
                  </div>
                  <div className="text-xs font-medium text-[var(--neu-text-muted)] mt-0.5 whitespace-nowrap">
                    {cat.label}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Duplicate Sites Section */}
        {report.duplicates.length > 0 && (
          <div className="neu-raised rounded-[22px] p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <GitMerge className="w-5 h-5 text-[var(--neu-warning)]" />
                <div>
                  <h2 className="text-base font-semibold text-[var(--neu-text)]">
                    Duplicate Sites Detected
                  </h2>
                  <p className="text-xs text-[var(--neu-text-muted)]">
                    Multiple entries point to the same domain. Merge them to keep your vault tidy.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              {report.duplicates.map((group) => (
                <div
                  key={group.domain}
                  className="neu-inset-sm rounded-[16px] px-4 py-3.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--neu-text)]">
                      {group.domain}
                    </div>
                    <div className="text-xs text-[var(--neu-text-muted)] truncate">
                      {group.entries.map((e) => e.title).join(' · ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openMergeModal(group)}
                    className="neu-btn px-4 py-2 rounded-[12px] text-xs font-semibold text-[var(--neu-accent)] whitespace-nowrap shrink-0 flex items-center gap-1.5"
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                    <span>Review & Merge ({group.entries.length})</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Flagged Password Issues */}
        <div className="neu-raised rounded-[22px] p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-[var(--neu-text)]">
              {filterType === 'all'
                ? 'All Security Findings'
                : `${filterType.charAt(0).toUpperCase() + filterType.slice(1)} Passwords`}
            </h2>
            {filterType !== 'all' && (
              <button
                type="button"
                onClick={() => setFilterType('all')}
                className="text-xs font-semibold text-[var(--neu-accent)] hover:underline"
              >
                Show all findings
              </button>
            )}
          </div>

          {filteredIssues.length === 0 ? (
            <div className="neu-inset-sm rounded-[18px] p-8 flex flex-col items-center text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-[var(--neu-success)]" />
              <div className="text-sm font-semibold text-[var(--neu-text)]">
                {report.totalLogins === 0
                  ? 'No logins to audit yet'
                  : 'No issues found in this category'}
              </div>
              <p className="text-xs text-[var(--neu-text-muted)]">
                {report.totalLogins === 0
                  ? 'Add login entries to check for weak, reused, or aging passwords.'
                  : 'Your credentials look clean and resilient.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredIssues.map((issue) => (
                <div
                  key={issue.id}
                  className="neu-inset-sm rounded-[16px] px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="neu-raised-xs w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0 mt-0.5">
                      {issueIcon(issue.type)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--neu-text)]">
                          {issue.entryTitle}
                        </span>
                        <span aria-hidden="true" className="text-[var(--neu-text-subtle)]">·</span>
                        <span
                          className="text-xs font-semibold"
                          style={{
                            color:
                              issue.severity === 'critical'
                                ? 'var(--neu-danger)'
                                : issue.severity === 'high'
                                ? 'var(--neu-warning)'
                                : 'var(--neu-text-muted)',
                          }}
                        >
                          {issue.title}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--neu-text-muted)] mt-0.5">
                        {issue.username ? `${issue.username} · ` : ''}
                        {issue.description}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onFixEntry(issue.entryId)}
                    className="neu-btn px-4 py-2 rounded-[12px] text-xs font-semibold text-[var(--neu-accent)] flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start sm:self-center"
                  >
                    <span>Fix Now</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Merge Duplicates Modal */}
      {mergingGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/25 dark:bg-black/50 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !mergingBusy) setMergingGroup(null);
          }}
        >
          <div className="neu-raised w-full max-w-lg rounded-[22px] p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-[var(--neu-text)]">
                  Merge {mergingGroup.domain}
                </h3>
                <p className="text-xs text-[var(--neu-text-muted)] mt-0.5">
                  Select which entry to keep as primary. Tags, notes, custom fields, and missing 2FA secrets will be combined; duplicates move to Trash.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMergingGroup(null)}
                aria-label="Close merge dialog"
                className="neu-btn w-9 h-9 rounded-[12px] flex items-center justify-center text-[var(--neu-text-muted)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1 pt-1 neu-scroll-fade">
              {mergingGroup.entries.map((entry: VaultEntry) => (
                <label
                  key={entry.id}
                  className={`block rounded-[15px] p-3.5 cursor-pointer transition-all ${
                    selectedPrimaryId === entry.id ? 'neu-inset-sm' : 'neu-raised-xs'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="primary-merge"
                      checked={selectedPrimaryId === entry.id}
                      onChange={() => setSelectedPrimaryId(entry.id)}
                      className="accent-[var(--neu-accent)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-[var(--neu-text)] truncate">
                        {entry.title}
                      </div>
                      <div className="text-xs text-[var(--neu-text-muted)] truncate">
                        {entry.username || 'No username'} · Updated{' '}
                        {new Date(entry.updatedAt).toLocaleDateString()}
                        {entry.totpSecret ? ' · Has 2FA' : ''}
                        {entry.passwordLength != null
                          ? ` · ${entry.passwordLength} chars`
                          : entry.password
                            ? ` · ${entry.password.length} chars`
                            : ' · No password'}
                      </div>
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => setMergingGroup(null)}
                disabled={mergingBusy}
                className="neu-btn px-5 py-2.5 rounded-[14px] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmMerge}
                disabled={mergingBusy || !selectedPrimaryId}
                className="neu-btn-primary px-5 py-2.5 rounded-[14px] text-xs font-semibold flex items-center gap-1.5"
              >
                <GitMerge className="w-3.5 h-3.5" />
                <span>{mergingBusy ? 'Merging...' : 'Merge Entries'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
