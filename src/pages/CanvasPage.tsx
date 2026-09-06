import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from '../components/Canvas';
import { ReauthDialog } from '../components/ReauthDialog';
import { Toasts } from '../components/Toasts';
import { TooltipProvider } from '../components/Tooltip';
import { useDiagramStore } from '../store/useDiagramStore';
import { api, setUnauthorizedHandler } from '../lib/api';
import { useSession } from '../lib/authClient';
import { createAutosaver } from '../lib/autosave';
import { renderDiagramPng } from '../lib/exportImage';
import { backfillBase64Images, findBase64ImageNodes } from '../lib/imageBackfill';
import { THUMBNAIL_MAX_SIDE, createThumbnailScheduler } from '../lib/thumbnail';
import { toastError } from '../store/useToastStore';

const AUTOSAVE_DELAY_MS = 2000;

export function CanvasPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadDiagram = useDiagramStore((s) => s.loadDiagram);
  const saveStatus = useDiagramStore((s) => s.saveStatus);
  // A viewer's copy: nothing below this may write, so autosave, the thumbnail
  // scheduler and the image backfill are all left unarmed.
  const readOnly = useDiagramStore((s) => s.readOnly);
  const { data: session } = useSession();
  /** The diagram whose image backfill has already been started on this page. */
  const backfilled = useRef<string | null>(null);

  // A 401 elsewhere in the app means "go and sign in"; here it means "the edits
  // on screen have nowhere to go yet", and navigating would be what loses them.
  // The dialog below is shown off `saveStatus` instead.
  useEffect(() => {
    setUnauthorizedHandler(() => {});
    return () => setUnauthorizedHandler(null);
  }, []);

  /**
   * Moves an old diagram's inline base64 images into `/api/images`, behind the
   * canvas the user is already looking at. Never blocks the load: the diagram
   * renders those nodes either way, and a failed upload just leaves one where
   * it was for the next open to try again.
   */
  const runImageBackfill = useCallback(async (diagramId: string) => {
    // Once per diagram per page. The effect that starts this is re-run by
    // StrictMode's double mount, and two runs racing would upload every image
    // twice — the second pass reads the same base64 the first has not replaced
    // yet, and the loser's bytes are left on disk with nothing referencing them.
    if (backfilled.current === diagramId) return;
    backfilled.current = diagramId;

    const { nodes } = useDiagramStore.getState();
    const candidates = findBase64ImageNodes(nodes);
    if (candidates.length === 0) return;

    const patches = await backfillBase64Images(nodes);
    // /d/A -> /d/B while the uploads were in flight: these patches are A's.
    if (useDiagramStore.getState().diagramId !== diagramId) return;
    useDiagramStore.getState().applyImageBackfill(patches);
    // One message for the whole run, not one per image.
    if (patches.length < candidates.length) {
      toastError('Some images could not be moved to storage. They still work — we will try again next time.');
    }
  }, []);

  const onReauthenticated = useCallback(() => {
    // The save that hit the expired session is retried straight away; a
    // success clears `unauthorized`, which is what rearms autosave.
    void useDiagramStore.getState().saveDiagram();
  }, []);

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
        // `updatedAt` is the version every save from here on is guarded by.
        loadDiagram(diagram.id, diagram.title, diagram.starred, diagram.data, diagram.updatedAt, {
          role: diagram.role,
          // Only ever sent to the owner; everyone else loads a `null` and is
          // never told whether a public link exists.
          shareToken: diagram.shareToken ?? null,
        });
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
    if (loading || loadError || !id || readOnly) return;

    const autosaver = createAutosaver({
      save: async () => {
        const outcome = await useDiagramStore.getState().saveDiagram();
        // Neither a conflict nor an expired session is transient: another
        // attempt would be refused in exactly the same way, so the autosaver
        // stands down and the banner (or the re-auth dialog) takes over. It is
        // rearmed by the next edit once the status is no longer one of those.
        if (outcome === 'conflict' || outcome === 'unauthorized') {
          autosaver.cancel();
          return;
        }
        // `saveDiagram` reports a failure through `saveStatus` rather than by
        // rejecting — its other callers `void` it, where a rejection would be
        // unhandled. The autosaver retries on a rejection, so the outcome is
        // translated back into one here.
        if (outcome === 'error') throw new Error('Save failed');
      },
      delayMs: AUTOSAVE_DELAY_MS,
      // `idle` / `pending` / `saving` are already reflected by `saveDiagram`;
      // only the autosaver knows that another attempt is coming.
      onStateChange: (state) => {
        if (state === 'retrying' || state === 'error') useDiagramStore.setState({ saveStatus: state });
      },
    });

    // The dashboard card's preview. Rate-limited rather than debounced: one
    // rasterisation of the whole canvas per interval, not one per edit.
    //
    // A capture reads whatever canvas is on screen, so /d/A -> /d/B (which
    // re-runs this effect rather than remounting) could otherwise render B and
    // store it as A's thumbnail. Both ends of the capture check the store still
    // holds this diagram.
    const isCurrent = () => useDiagramStore.getState().diagramId === id;
    const thumbnails = createThumbnailScheduler({
      render: () =>
        isCurrent()
          ? renderDiagramPng({ pixelRatio: 1, maxSide: THUMBNAIL_MAX_SIDE, preserveSelection: true })
          : Promise.resolve(null),
      save: async (thumbnail) => {
        if (!isCurrent()) return;
        const saved = await api.saveDiagram(id, { thumbnail });
        // A thumbnail is written through the same `PUT`, so it bumps the row's
        // `updatedAt` like any edit. The conflict guard has to follow it, or
        // the next real save would be refused as stale by this tab's own
        // decoration.
        if (isCurrent() && saved?.updatedAt) useDiagramStore.getState().noteSaved(saved.updatedAt);
      },
    });

    const unsubscribe = useDiagramStore.subscribe((state, prev) => {
      // A pan is a change worth saving on its own — the viewport is stored with
      // the diagram — so it schedules a save like any edit.
      if (
        state.nodes === prev.nodes &&
        state.edges === prev.edges &&
        state.title === prev.title &&
        state.viewport === prev.viewport
      ) {
        return;
      }
      // Autosave stays down until the conflict is resolved or the session is
      // renewed; scheduling here would only queue a save the server refuses.
      if (state.saveStatus !== 'conflict' && state.saveStatus !== 'unauthorized') {
        autosaver.schedule();
      }
      // Neither a retitle nor a pan changes the picture, so only shape edits
      // mark the thumbnail stale.
      if (state.nodes !== prev.nodes || state.edges !== prev.edges) thumbnails.markDirty();
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

    // Started only once the subscription above exists, so the patches it
    // applies schedule a save rather than sitting there until the next edit.
    void runImageBackfill(id);

    return () => {
      window.removeEventListener('pagehide', onPageHide);
      unsubscribe();
      // Navigating away inside the debounce window must not drop the edit.
      void autosaver.flush();
      // Best-effort: the capture reads the live canvas, so it only produces a
      // thumbnail while the viewport is still mounted. `renderDiagramPng`
      // returns null once it is gone, which the scheduler treats as "nothing
      // to save" rather than an error.
      void thumbnails.flush();
    };
  }, [loading, loadError, id, readOnly, runImageBackfill]);

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
          {saveStatus === 'unauthorized' && (
            // `session` is the one that just expired: better-auth keeps the
            // last response it read, so the address is usually still there to
            // prefill. An empty string is a normal outcome, not a failure.
            <ReauthDialog
              defaultEmail={session?.user.email ?? ''}
              onSuccess={onReauthenticated}
            />
          )}
        </div>
        <Toasts />
      </ReactFlowProvider>
    </TooltipProvider>
  );
}
