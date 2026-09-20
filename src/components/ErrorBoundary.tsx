import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-8">
        <div className="max-w-md rounded-xl border border-line bg-panel p-8 text-center shadow-lg">
          <h1 className="mb-2 text-xl font-semibold text-ink-900">Something went wrong</h1>
          <p className="mb-6 text-sm text-ink-600">
            An unexpected error occurred. Reloading usually fixes it.
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              Reload
            </button>
            <button
              onClick={() => (window.location.href = '/')}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-hover"
            >
              Go to dashboard
            </button>
          </div>
          <details className="mt-6 text-left">
            <summary className="cursor-pointer text-xs text-ink-600 hover:text-ink-900">
              Error details
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-field p-3 text-xs text-ink-700">
              {this.state.error.message}
              {'\n'}
              {this.state.error.stack}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
