import React from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';

const GITHUB_URL = 'https://github.com/iK4w4';
const YOUTUBE_URL = 'https://www.youtube.com/@iK4w4';

function openExternal(url: string, onError?: (message: string) => void) {
  void openUrl(url).catch(() => onError?.('Could not open the link.'));
}

const GithubIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

const YoutubeIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

/**
 * Creator watermark — "Made by iK4w4" with GitHub and YouTube links.
 * Lives in the sidebar footer and at the bottom of the lock screen.
 * A failed open is reported through `onError` instead of failing
 * silently — a dead-looking button is worse than an error message.
 */
export const CreatorLinks: React.FC<{ onError?: (message: string) => void }> = ({
  onError,
}) => (
  <div className="flex items-center justify-center gap-2 text-[var(--neu-text-subtle)] select-none">
    <span className="text-[11px] font-medium">Made by iK4w4</span>
    <span aria-hidden="true" className="text-[11px]">
      ·
    </span>
    <button
      type="button"
      onClick={() => openExternal(GITHUB_URL, onError)}
      data-tip="GitHub — iK4w4"
      aria-label="iK4w4 on GitHub"
      className="neu-btn w-7 h-7 rounded-[9px] flex items-center justify-center text-[var(--neu-text-muted)] hover:text-[var(--neu-accent)] transition-colors"
    >
      <GithubIcon />
    </button>
    <button
      type="button"
      onClick={() => openExternal(YOUTUBE_URL, onError)}
      data-tip="YouTube — @iK4w4"
      aria-label="iK4w4 on YouTube"
      className="neu-btn w-7 h-7 rounded-[9px] flex items-center justify-center text-[var(--neu-text-muted)] hover:text-[var(--neu-accent)] transition-colors"
    >
      <YoutubeIcon />
    </button>
  </div>
);
