import { useState, type FormEvent } from 'react';
import { signIn } from '../lib/authClient';

/**
 * Signs the user back in without leaving the canvas.
 *
 * A session that expires mid-edit used to bounce the tab to `/login`, throwing
 * away everything that had not been autosaved yet. The edits are only in memory,
 * so the one thing this must not do is navigate: the user signs in here, and the
 * save that was refused is retried against the diagram still on screen.
 */
export function ReauthDialog({
  defaultEmail = '',
  onSuccess,
}: {
  /** The address of the session that just expired, when the client still knows it. */
  defaultEmail?: string;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message || 'Invalid credentials');
        return;
      }
      onSuccess();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-ink-950/30 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-label="Session expired"
        className="w-full max-w-sm rounded-2xl bg-panel p-6 shadow-[0_10px_40px_-10px_rgba(20,20,50,0.35)] ring-1 ring-line"
      >
        <h2 className="text-[15px] font-semibold text-ink-900">Your session expired</h2>
        <p className="mb-4 mt-1 text-sm text-ink-600">
          Sign in to save your changes. Nothing on the canvas has been lost.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-danger-wash px-3 py-2 text-sm text-danger-ink">{error}</div>
        )}

        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium text-ink-700">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-lg border border-line-strong bg-field px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
          />
        </label>

        <label className="mb-6 block">
          <span className="mb-1 block text-sm font-medium text-ink-700">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            className="w-full rounded-lg border border-line-strong bg-field px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-600 disabled:opacity-60"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
