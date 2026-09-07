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
import { PresentButton } from '../components/PresentButton';
import { TimerButton } from '../components/TimerButton';
import { Toasts } from '../components/Toasts';
import { TooltipProvider } from '../components/Tooltip';
import { usePresentStore } from '../store/usePresentStore';
import { api } from '../lib/api';
import { migrateDiagramData } from '../lib/diagramMigrations';
import { rewriteSharedDiagram } from '../lib/sharedView';
import { SHARED_POLL_MS, liveBoardPatch, liveBoardStateOf } from '../lib/sharedPoll';
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

  useLiveBoardPoll(token, state === 'ready');

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
          <SharedHeader title={title} />
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

/**
 * Keep the board's timer and its round of voting up to date while this page is
 * open — see `src/lib/sharedPoll.ts` for why those two and nothing else.
 *
 * Stops while the tab is hidden and catches up the moment it comes back: a
 * background tab that went on polling would be requests nobody is reading, and
 * a reader returning to the tab wants the current countdown rather than the one
 * from thirty seconds' time. A failed poll is not reported — the next one is
 * along shortly, and a shared board that flashed an error every half minute
 * because a laptop's wifi dropped would be worse than a stale timer.
 */
function useLiveBoardPoll(token: string | undefined, ready: boolean) {
  useEffect(() => {
    if (!token || !ready) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const shared = await api.getSharedDiagram(token);
        if (cancelled) return;
        const { voting, timer: shown } = useDiagramStore.getState();
        const patch = liveBoardPatch({ voting, timer: shown }, liveBoardStateOf(shared.data));
        // `setState` rather than an action, for the reason the document binding
        // uses one: this is the board's own state arriving from elsewhere, not
        // an edit anybody made here, so it takes no history entry and is not
        // gated on the page's read-only-ness.
        if (patch) useDiagramStore.setState(patch);
      } catch {
        // Offline, rate-limited, or the link has just been revoked. The board
        // on screen is still the board; the next poll will say.
      }
    };

    const start = () => {
      if (timer === null) timer = setInterval(() => void poll(), SHARED_POLL_MS);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        return;
      }
      void poll();
      start();
    };

    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [token, ready]);
}

/**
 * This page's own slim top bar, and the one thing on it that is not a label:
 * Present. Presenting a shared board is looking at it — the same reason the
 * command is on `READ_ONLY_COMMAND_IDS` — and the button renders nothing at all
 * when the diagram has no frames to make slides of.
 *
 * The whole header folds away while a presentation is running, so a slide fills
 * the window here as it does in the app. `PresentMode` re-fits on the size
 * change that causes.
 */
function SharedHeader({ title }: { title: string }) {
  const presenting = usePresentStore((s) => s.active);
  if (presenting) return null;

  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-panel/90 px-4 py-2.5 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-[14px] font-semibold text-ink-900">{title}</h1>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-hover-strong px-2 py-0.5 text-xs font-medium text-ink-700">
          <Eye size={12} /> View only · Shared with you
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {/* The board's countdown. Read-only like everything else here, and it
            renders nothing when there is no timer. This page opens no socket,
            so what it shows is the timer as the snapshot held it — an end time,
            so it still counts down correctly from here — and `useLiveBoardPoll`
            re-reads that field (and the round of voting beside it) every 30 s,
            so a timer started after the page loaded turns up on its own. */}
        <TimerButton />
        <PresentButton />
        <Link
          to="/login"
          className="text-[13px] font-medium text-ink-600 transition hover:text-accent-600"
        >
          Made with FlowSketch — Sign in
        </Link>
      </div>
    </header>
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
