/**
 * Who owns a connector drag in flight: this module, by edge id — never the
 * component that started it.
 *
 * React Flow remounts an edge that is still on the board in the middle of a
 * drag (re-pinning an end can move it to another z-level group), so a cancel
 * handle kept in a component ref would be stranded in the old instance, and
 * deleting the edge afterwards would cancel nothing. Here the drag is keyed by
 * the edge it moves and cancelled the moment that edge leaves the store —
 * deleted by a peer, undone — so its queued frame never writes into an edge
 * that is not there, and its `onEnd` clears the drag's flags.
 */
import { useDiagramStore } from './useDiagramStore';

const active = new Map<string, () => void>();
let unsubscribe: (() => void) | null = null;

function watch() {
  if (unsubscribe) return;
  unsubscribe = useDiagramStore.subscribe((state, previous) => {
    if (state.edges === previous.edges || active.size === 0) return;
    const present = new Set(state.edges.map((e) => e.id));
    for (const [edgeId, cancel] of [...active]) if (!present.has(edgeId)) cancel();
  });
}

/**
 * Registers the drag of `edgeId`, cancelling one already running on it.
 * `start` receives the function that removes the registration and must call
 * it when the drag ends; it returns the drag's cancel function.
 */
export function trackEdgeDrag(edgeId: string, start: (release: () => void) => () => void): void {
  active.get(edgeId)?.();
  watch();
  let cancel: (() => void) | null = null;
  let ended = false;
  const release = () => {
    ended = true;
    if (active.get(edgeId) === cancel) active.delete(edgeId);
  };
  cancel = start(release);
  if (!ended) active.set(edgeId, cancel);
}

/** How many drags are in flight — for tests. */
export function activeEdgeDragCount(): number {
  return active.size;
}
