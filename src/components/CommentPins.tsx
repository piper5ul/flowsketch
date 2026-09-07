/**
 * The numbered pins that put a conversation where it happened.
 *
 * Rendered through `ViewportPortal`, so a pin lives inside
 * `.react-flow__viewport` and is panned and zoomed by the same transform as the
 * board — a pin positioned outside it would have to re-implement that transform
 * and would drift the moment either one changed. The cost of being in there is
 * that it is also inside what the image export captures, which is why every pin
 * carries `comment-pin` and that class is on the export's exclusion list: a
 * discussion is not part of the drawing.
 *
 * A pin is `nodrag nopan` because it sits over the board: without those,
 * pressing one starts a canvas pan and the click never lands.
 */
import { ViewportPortal } from '@xyflow/react';
import { useMemo } from 'react';
import { pinPosition, threadNumbers, visibleThreads } from '../lib/comments';
import { useCommentStore } from '../store/useCommentStore';
import { useDiagramStore } from '../store/useDiagramStore';

export function CommentPins() {
  const threads = useCommentStore((s) => s.threads);
  const filter = useCommentStore((s) => s.filter);
  const activeThreadId = useCommentStore((s) => s.activeThreadId);
  const openPanel = useCommentStore((s) => s.openPanel);
  const nodes = useDiagramStore((s) => s.nodes);

  // The same filter the panel is showing, so the board and the list never
  // disagree about which conversations are being had: a resolved thread's pin
  // comes back only when the user asks to see resolved ones.
  const shown = useMemo(() => visibleThreads(threads, filter), [threads, filter]);
  const numbers = useMemo(() => threadNumbers(threads), [threads]);

  return (
    <ViewportPortal>
      {shown.map((thread) => {
        const at = pinPosition(thread, nodes);
        if (!at) return null;
        const number = numbers.get(thread.id) ?? 0;
        return (
          <button
            key={thread.id}
            type="button"
            aria-label={`Comment thread ${number}`}
            aria-pressed={activeThreadId === thread.id}
            onClick={() => openPanel(thread.id)}
            className="comment-pin nodrag nopan"
            style={{ position: 'absolute', left: at.x, top: at.y }}
            data-resolved={thread.resolved ? 'true' : undefined}
          >
            {number}
          </button>
        );
      })}
    </ViewportPortal>
  );
}
