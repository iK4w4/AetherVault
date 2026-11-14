import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ClipboardPaste, Copy, Scissors, WholeWord } from 'lucide-react';

interface MenuItem {
  id: string;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
  disabled?: boolean;
  action: () => void;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** Set a value on a React-controlled input/textarea so React sees the change. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function insertAtCursor(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  setNativeValue(el, next);
  const pos = start + text.length;
  requestAnimationFrame(() => {
    try {
      el.setSelectionRange(pos, pos);
    } catch {
      /* not focusable — ignore */
    }
  });
}

async function pasteInto(el: HTMLInputElement | HTMLTextAreaElement) {
  let text = '';
  try {
    text = await invoke<string>('read_clipboard');
  } catch {
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
  }
  if (text) insertAtCursor(el, text);
}

function copyViaClipboardApi(text: string) {
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

/**
 * The app's own right-click menu.
 *
 * Shows editing actions over text fields, Copy / Select All over a
 * selection, and nothing at all over empty space. Mount once, at the
 * root of the app.
 *
 * Copy/Cut go through the app's auto-clearing copy (same as the Copy
 * buttons), so a copied secret is swept after the TTL instead of
 * sitting in clipboard history forever. `onCopy` is the App's
 * copy-with-auto-clear; without it the menu falls back to the plain
 * clipboard write (browser preview only).
 */
interface ContextMenuProviderProps {
  onCopy?: (value: string, label: string) => void;
}

export const ContextMenuProvider: React.FC<ContextMenuProviderProps> = ({ onCopy }) => {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setMenu(null), []);

  const copyText = useCallback(
    (text: string) => {
      if (onCopy) onCopy(text, 'Copied text');
      else copyViaClipboardApi(text);
    },
    [onCopy]
  );

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-context-menu]')) {
        e.preventDefault();
        return;
      }
      const editable = target?.closest(
        'input, textarea, [contenteditable="true"]',
      ) as HTMLInputElement | HTMLTextAreaElement | null;
      const selection = window.getSelection()?.toString() ?? '';

      let items: MenuItem[] | null = null;
      if (editable) {
        const hasSelection =
          editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement
            ? (editable.selectionStart ?? 0) !== (editable.selectionEnd ?? 0)
            : selection.length > 0;
        items = [
          {
            id: 'cut',
            label: 'Cut',
            shortcut: 'Ctrl+X',
            icon: <Scissors className="w-4 h-4" />,
            disabled: !hasSelection,
            action: () => {
              // Cut = copy through the auto-clearing copy, then delete
              // the selection from the field.
              if (
                editable instanceof HTMLInputElement ||
                editable instanceof HTMLTextAreaElement
              ) {
                const start = editable.selectionStart ?? 0;
                const end = editable.selectionEnd ?? 0;
                const text = editable.value.slice(start, end);
                if (!text) return;
                copyText(text);
                setNativeValue(editable, editable.value.slice(0, start) + editable.value.slice(end));
                try {
                  editable.setSelectionRange(start, start);
                } catch {
                  /* not focusable — ignore */
                }
              } else {
                try {
                  document.execCommand('cut');
                } catch {
                  /* clipboard blocked — ignore */
                }
              }
            },
          },
          {
            id: 'copy',
            label: 'Copy',
            shortcut: 'Ctrl+C',
            icon: <Copy className="w-4 h-4" />,
            disabled: !hasSelection,
            action: () => {
              const text =
                editable instanceof HTMLInputElement ||
                editable instanceof HTMLTextAreaElement
                  ? editable.value.slice(
                      editable.selectionStart ?? 0,
                      editable.selectionEnd ?? 0
                    )
                  : window.getSelection()?.toString() ?? '';
              if (text) copyText(text);
            },
          },
          {
            id: 'paste',
            label: 'Paste',
            shortcut: 'Ctrl+V',
            icon: <ClipboardPaste className="w-4 h-4" />,
            action: () => void pasteInto(editable),
          },
          {
            id: 'select-all',
            label: 'Select All',
            shortcut: 'Ctrl+A',
            icon: <WholeWord className="w-4 h-4" />,
            action: () => {
              try {
                editable.focus();
                if (editable instanceof HTMLInputElement) editable.select();
                else if (editable instanceof HTMLTextAreaElement) editable.select();
                else document.execCommand('selectAll');
              } catch {
                /* ignore */
              }
            },
          },
        ];
      } else if (selection) {
        items = [
          {
            id: 'copy',
            label: 'Copy',
            shortcut: 'Ctrl+C',
            icon: <Copy className="w-4 h-4" />,
            action: () => {
              if (selection) copyText(selection);
            },
          },
          {
            id: 'select-all',
            label: 'Select All',
            shortcut: 'Ctrl+A',
            icon: <WholeWord className="w-4 h-4" />,
            action: () => {
              try {
                document.execCommand('selectAll');
              } catch {
                /* ignore */
              }
            },
          },
        ];
      }

      e.preventDefault();
      if (!items) {
        setMenu(null);
        return;
      }
      // Clamp to the viewport so the menu never runs off-screen.
      const w = 224;
      const h = items.length * 37 + 14;
      const x = Math.min(e.clientX, window.innerWidth - w - 8);
      const y = Math.min(e.clientY, window.innerHeight - h - 8);
      setMenu({ x: Math.max(8, x), y: Math.max(8, y), items });
    };

    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onScroll = () => close();

    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [close, copyText]);

  if (!menu) return null;

  return (
    <div
      ref={menuRef}
      data-context-menu
      role="menu"
      className="neu-raised fixed z-[200] w-56 rounded-[14px] p-1.5"
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            close();
            item.action();
          }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-[13px] font-medium text-left transition-colors ${
            item.disabled
              ? 'opacity-40 cursor-not-allowed'
              : 'text-[var(--neu-text)] hover:bg-[var(--neu-accent-soft)] hover:text-[var(--neu-accent)]'
          }`}
        >
          <span className="shrink-0 text-[var(--neu-text-muted)]">{item.icon}</span>
          <span className="flex-1">{item.label}</span>
          <span className="text-[11px] text-[var(--neu-text-subtle)] font-mono">
            {item.shortcut}
          </span>
        </button>
      ))}
    </div>
  );
};
