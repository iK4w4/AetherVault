import React, { useEffect, useState } from 'react';
import { Maximize2, Minus, Minimize2, ShieldCheck, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** Current Tauri window, or null outside the desktop app (browser preview). */
function appWindow() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

/**
 * Custom title bar for the frameless window (decorations: false).
 * The left area is the OS drag region; the window controls sit outside it
 * so their clicks always land. Rendered at the top of every app state
 * (main view, lock screen) so the window is always draggable
 * and closable — there is no native title bar anymore.
 */
export const TitleBar: React.FC = () => {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = appWindow();
    if (!win) return;
    let unlisten: (() => void) | undefined;
    win.isMaximized().then(setMaximized).catch(() => undefined);
    win
      .onResized(() => {
        win.isMaximized().then(setMaximized).catch(() => undefined);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <header className="h-10 shrink-0 flex items-stretch bg-[var(--neu-bg)] border-b border-[var(--neu-divider)] select-none relative z-40">
      <div
        data-tauri-drag-region
        onDoubleClick={() => void appWindow()?.toggleMaximize()}
        className="flex-1 min-w-0 flex items-center gap-2.5 pl-4 pr-2"
      >
        <span className="shrink-0 w-5 h-5 rounded-[6px] bg-[var(--neu-accent)]/10 flex items-center justify-center">
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--neu-accent)]" />
        </span>
        <span className="text-xs font-bold tracking-tight text-[var(--neu-text)] truncate">
          AetherVault
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--neu-text-subtle)] truncate">
          Local Vault
        </span>
      </div>
      <div className="flex items-stretch shrink-0">
        <button
          type="button"
          onClick={() => void appWindow()?.minimize()}
          aria-label="Minimize"
          data-tip="Minimize"
          data-tip-pos="below"
          className="w-11 flex items-center justify-center text-[var(--neu-text-muted)] hover:text-[var(--neu-text)] hover:bg-black/[0.04] dark:hover:bg-white/10 transition-colors"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => void appWindow()?.toggleMaximize()}
          aria-label={maximized ? 'Restore' : 'Maximize'}
          data-tip={maximized ? 'Restore' : 'Maximize'}
          data-tip-pos="below"
          className="w-11 flex items-center justify-center text-[var(--neu-text-muted)] hover:text-[var(--neu-text)] hover:bg-black/[0.04] dark:hover:bg-white/10 transition-colors"
        >
          {maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => void appWindow()?.close()}
          aria-label="Close"
          data-tip="Close"
          data-tip-pos="below"
          className="w-11 flex items-center justify-center text-[var(--neu-text-muted)] hover:text-white hover:bg-[#e81123] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
