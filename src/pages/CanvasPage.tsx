import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from '../components/Canvas';
import { Toasts } from '../components/Toasts';
import { TooltipProvider } from '../components/Tooltip';
import { useDiagramStore } from '../store/useDiagramStore';
import { api } from '../lib/api';
import { createAutosaver } from '../lib/autosave';

const AUTOSAVE_DELAY_MS = 2000;

export function CanvasPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadDiagram = useDiagramStore((s) => s.loadDiagram);

  useEffect(() => {
    if (!id) return;
    // Route param changes (/d/A -> /d/B) reuse this component, so the load has
    // to re-run per id. `cancelled` discards a response that arrives after the
    // id moved on, and makes StrictMode's double-invocation harmless.
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    api.getDiagram(id)
      .then((diagram) => {
        if (cancelled) return;
        // Throws when the row was written by a newer build of the app; that is
        // worth telling the user about rather than bouncing them silently.
        loadDiagram(diagram.id, diagram.title, diagram.starred, diagram.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof Error && err.message.includes('newer version')) {
          setLoadError(err.message);
          setLoading(false);
          return;
        }
        navigate('/', { replace: true });
      });

    return () => { cancelled = true; };
  }, [id, loadDiagram, navigate]);

  useEffect(() => {
    if (loading || loadError || !id) return;

    const autosaver = createAutosaver({
      save: () => useDiagramStore.getState().saveDiagram(),
      delayMs: AUTOSAVE_DELAY_MS,
    });

    const unsubscribe = useDiagramStore.subscribe((state, prev) => {
      if (state.nodes === prev.nodes && state.edges === prev.edges && state.title === prev.title) return;
      autosaver.schedule();
    });

    // The tab can go away without unmounting the page (close, back/forward
    // cache, mobile app switch). `pagehide` is the reliable hook there, and the
    // save must be keepalive so the browser lets it finish during unload.
    const onPageHide = () => {
      if (!autosaver.isPending()) return;
      autosaver.cancel();
      void useDiagramStore.getState().saveDiagram({ keepalive: true });
    };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.removeEventListener('pagehide', onPageHide);
      unsubscribe();
      // Navigating away inside the debounce window must not drop the edit.
      void autosaver.flush();
    };
  }, [loading, loadError, id]);

  // Autosave is never armed in this branch, so the unreadable diagram cannot be
  // overwritten by this build.
  if (loadError) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
        <div className="text-sm font-medium text-ink-900">This diagram was saved by a newer version</div>
        <div className="max-w-md text-sm text-ink-600">{loadError}</div>
        <button
          type="button"
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-ink-700 hover:bg-gray-50"
          onClick={() => navigate('/')}
        >
          Back to diagrams
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-canvas">
        <div className="text-sm text-ink-600">Loading diagram...</div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <ReactFlowProvider>
        <div className="h-screen w-screen overflow-hidden">
          <Canvas />
        </div>
        <Toasts />
      </ReactFlowProvider>
    </TooltipProvider>
  );
}
