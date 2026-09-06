/**
 * `/s/:token` — a diagram behind a public link.
 *
 * The one route in the app that is not behind `ProtectedRoute`: the token *is*
 * the credential, so there is no session to check and nowhere to send someone
 * who has not got one. Everything here is read-only, and deliberately so at
 * three separate levels: the store is loaded with `readOnly`, the API offers no
 * write route that a token can reach, and the server would refuse one anyway.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { Eye } from 'lucide-react';
import { Canvas } from '../components/Canvas';
import { Toasts } from '../components/Toasts';
import { TooltipProvider } from '../components/Tooltip';
import { api } from '../lib/api';
import { migrateDiagramData } from '../lib/diagramMigrations';
import { rewriteSharedDiagram } from '../lib/sharedView';
import { useDiagramStore } from '../store/useDiagramStore';

type LoadState = 'loading' | 'ready' | 'gone' | 'unreadable';

export function SharedPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<LoadState>('loading');
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setState('loading');

    api
      .getSharedDiagram(token)
      .then((shared) => {
        if (cancelled) return;
        // Migrated here rather than left to `loadDiagram`, because the image
        // rewrite has to run over nodes this build understands — and migrating
        // twice is free: the second pass sees the version stamp and does nothing.
        const data = rewriteSharedDiagram(migrateDiagramData(shared.data), token);
        setTitle(shared.title);
        useDiagramStore
          .getState()
          .loadDiagram(shared.id, shared.title, false, data, shared.updatedAt, {
            // No role at all: whoever is reading this is not signed in to it.
            readOnly: true,
          });
        setState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // A revoked token and one that never existed are the same 404, which is
        // the whole point of revoking it.
        const message = err instanceof Error ? err.message : '';
        setState(message.includes('404') ? 'gone' : 'unreadable');
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state === 'loading') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-canvas">
        <div className="text-sm text-ink-600">Loading diagram...</div>
      </div>
    );
  }

  if (state !== 'ready') {
    return (
      <UnavailablePage
        heading={state === 'gone' ? 'This link is no longer active' : 'This diagram could not be loaded'}
        detail={
          state === 'gone'
            ? 'The owner has turned the public link off, or it never pointed anywhere. Ask them for a new one.'
            : 'Something went wrong fetching it. Try again in a moment.'
        }
      />
    );
  }

  return (
    <TooltipProvider>
      <ReactFlowProvider>
        <div className="flex h-screen w-screen flex-col overflow-hidden">
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-panel/90 px-4 py-2.5 backdrop-blur">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="truncate text-[14px] font-semibold text-ink-900">{title}</h1>
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-hover-strong px-2 py-0.5 text-xs font-medium text-ink-700">
                <Eye size={12} /> View only · Shared with you
              </span>
            </div>
            <Link
              to="/login"
              className="shrink-0 text-[13px] font-medium text-ink-600 transition hover:text-accent-600"
            >
              Made with FlowSketch — Sign in
            </Link>
          </header>
          <div className="relative min-h-0 flex-1">
            {/* The same canvas the app uses, without its editing top bar: this
                page has a header of its own, and the title, star, Share and
                History it carries all belong to a signed-in reader. */}
            <Canvas topBar={false} />
          </div>
        </div>
        <Toasts />
      </ReactFlowProvider>
    </TooltipProvider>
  );
}

function UnavailablePage({ heading, detail }: { heading: string; detail: string }) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
      <h1 className="text-base font-semibold text-ink-900">{heading}</h1>
      <p className="max-w-md text-sm text-ink-600">{detail}</p>
      <Link
        to="/login"
        className="mt-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-600"
      >
        Go to FlowSketch
      </Link>
    </div>
  );
}
