import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { signIn, useSession } from '../lib/authClient';

export function LoginPage() {
  const { data: session, isPending } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isPending) return <LoadingScreen />;
  if (session) return <Navigate to="/" replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message || 'Invalid credentials');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-ink-950">Whimsy</h1>
          <p className="mt-1 text-sm text-ink-600">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-6 shadow-[0_10px_40px_-10px_rgba(20,20,50,0.15)] ring-1 ring-black/[0.04]">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-ink-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full rounded-lg border border-black/10 bg-canvas px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
            />
          </label>

          <label className="mb-6 block">
            <span className="mb-1 block text-sm font-medium text-ink-700">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-black/10 bg-canvas px-3 py-2 text-sm text-ink-900 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
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

        <p className="mt-4 text-center text-sm text-ink-600">
          Don't have an account?{' '}
          <Link to="/signup" className="font-medium text-accent-500 hover:text-accent-600">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="text-sm text-ink-600">Loading...</div>
    </div>
  );
}
