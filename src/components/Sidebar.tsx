import React from 'react';
import {
  CreditCard,
  FileText,
  Globe,
  HeartPulse,
  KeyRound,
  Lock,
  Minimize2,
  Moon,
  Settings,
  ShieldCheck,
  Star,
  Sun,
  Trash2,
  UserCheck,
  Wand2,
} from 'lucide-react';
import { SidebarSection, ThemeMode } from '../types/vault';
import { CreatorLinks } from './CreatorLinks';
import { NeumorphicLogo } from './NeumorphicLogo';

interface SidebarProps {
  activeSection: SidebarSection;
  onSelectSection: (section: SidebarSection) => void;
  counts: Record<SidebarSection, number>;
  auditIssueCount: number;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onLockVault: () => void;
  onHideToTray: () => void;
  onOpenLinkError?: (message: string) => void;
}

interface NavItemConfig {
  id: SidebarSection;
  label: string;
  icon: React.FC<{ className?: string }>;
  badge?: number;
  badgeTone?: 'muted' | 'danger';
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSelectSection,
  counts,
  auditIssueCount,
  theme,
  onToggleTheme,
  onLockVault,
  onHideToTray,
  onOpenLinkError,
}) => {
  const vaultItems: NavItemConfig[] = [
    { id: 'all', label: 'All Items', icon: KeyRound, badge: counts.all },
    { id: 'favorites', label: 'Favorites', icon: Star, badge: counts.favorites },
    { id: 'totp', label: '2FA Codes', icon: ShieldCheck, badge: counts.totp },
  ];

  const categoryItems: NavItemConfig[] = [
    { id: 'login', label: 'Logins', icon: Globe, badge: counts.login },
    { id: 'note', label: 'Secure Notes', icon: FileText, badge: counts.note },
    { id: 'card', label: 'Cards', icon: CreditCard, badge: counts.card },
    { id: 'identity', label: 'Identities', icon: UserCheck, badge: counts.identity },
  ];

  const toolItems: NavItemConfig[] = [
    {
      id: 'audit',
      label: 'Health Audit',
      icon: HeartPulse,
      badge: auditIssueCount,
      badgeTone: auditIssueCount > 0 ? 'danger' : 'muted',
    },
    { id: 'generator', label: 'Generator', icon: Wand2 },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'trash', label: 'Trash', icon: Trash2, badge: counts.trash },
  ];

  const renderItem = (item: NavItemConfig) => {
    const active = activeSection === item.id;
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        type="button"
        aria-current={active ? 'page' : undefined}
        onClick={() => onSelectSection(item.id)}
        className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-[14px] text-sm font-medium transition-all whitespace-nowrap shrink-0 ${
          active
            ? 'neu-inset-sm text-[var(--neu-accent)] font-semibold'
            : 'text-[var(--neu-text-muted)] hover:text-[var(--neu-text)]'
        }`}
      >
        <span className="flex items-center gap-3 min-w-0">
          <Icon className="w-4 h-4 shrink-0" />
          <span className="truncate">{item.label}</span>
        </span>
        {typeof item.badge === 'number' && item.badge > 0 && (
          <span
            className="font-mono text-xs tabular-nums shrink-0"
            style={{
              color:
                item.badgeTone === 'danger'
                  ? 'var(--neu-danger)'
                  : active
                  ? 'var(--neu-accent)'
                  : 'var(--neu-text-subtle)',
            }}
          >
            {item.badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside className="w-[250px] shrink-0 h-full flex flex-col p-4 select-none">
      {/* Brand header — pinned at the top, never scrolls away */}
      <div className="flex items-center gap-3 px-1 pt-1 pb-4 border-b border-[var(--neu-divider)] shrink-0">
          <NeumorphicLogo size="sm" />
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold leading-tight tracking-tight text-[var(--neu-text)] truncate">
              AetherVault
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="neu-btn w-8 h-8 rounded-[10px] flex items-center justify-center text-[var(--neu-text-muted)] hover:text-[var(--neu-text)] shrink-0"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 py-5">
        <nav aria-label="Vault navigation" className="space-y-5">
          <div className="space-y-1">{vaultItems.map(renderItem)}</div>

          <div className="space-y-1">
            <div className="px-3.5 pb-1 text-xs font-medium text-[var(--neu-text-subtle)]">
              Categories
            </div>
            {categoryItems.map(renderItem)}
          </div>

          <div className="space-y-1">
            <div className="px-3.5 pb-1 text-xs font-medium text-[var(--neu-text-subtle)]">
              Tools
            </div>
            {toolItems.map(renderItem)}
          </div>
        </nav>
      </div>

      {/* Bottom Desktop Controls */}
      <div className="pt-4 space-y-2.5 border-t border-[var(--neu-divider)] shrink-0">
        <button
          type="button"
          onClick={onLockVault}
          data-tip="Lock Vault (Ctrl+L)"
          className="neu-btn w-full px-3.5 py-2.5 rounded-[14px] text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
        >
          <Lock className="w-3.5 h-3.5 text-[var(--neu-accent)]" />
          <span>Lock Vault</span>
        </button>
        <button
          type="button"
          onClick={onHideToTray}
          data-tip="Minimize to System Tray"
          className="w-full px-3 py-2 rounded-[12px] text-xs font-medium text-[var(--neu-text-muted)] hover:text-[var(--neu-text)] flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
        >
          <Minimize2 className="w-3.5 h-3.5" />
          <span>Hide to Tray</span>
        </button>
      </div>

      {/* Creator watermark */}
      <div className="pt-3 shrink-0">
        <CreatorLinks onError={onOpenLinkError} />
      </div>
    </aside>
  );
};
