import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Last-resort error boundary around the app shell. If a render throws
 * (e.g. malformed vault data slipped past normalization), the user gets
 * a recovery screen instead of a blank window.
 */
export class ErrorBoundary extends React.Component<
  React.PropsWithChildren,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="h-screen w-screen bg-[var(--neu-bg)] text-[var(--neu-text)] flex items-center justify-center p-6">
        <div className="neu-raised rounded-[20px] p-8 max-w-md w-full text-center space-y-3">
          <h1 className="text-lg font-bold">Something went wrong</h1>
          <p className="text-sm text-[var(--neu-text-muted)] leading-relaxed">
            The app hit an unexpected error. Your vault file was not changed.
            Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="neu-btn-primary px-5 h-11 rounded-[14px] text-xs font-semibold"
          >
            Reload the app
          </button>
        </div>
      </div>
    );
  }
}
