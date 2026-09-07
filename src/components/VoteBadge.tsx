import clsx from 'clsx';
import { useDiagramStore } from '../store/useDiagramStore';
import { canVote, voteCount, votesBy } from '../lib/voting';

/**
 * The dots on one shape, and the two buttons that put them there.
 *
 * **What it shows depends on where the round is**, which is the whole point of
 * hiding the totals until voting closes:
 *
 * - Round open: *your own* dots, as filled circles, plus a `+` to spend another
 *   and a `−` to take one back. Nobody's count but yours is drawn, so seeing
 *   which shape is winning cannot steer the vote.
 * - Round closed and revealed: the total, as a number, for every reader —
 *   including a viewer and the public `/s/:token` page. A revealed count is part
 *   of what the board says, which is also why it is left **in** the image
 *   export; the two buttons are not, and carry `.vote-affordance` so
 *   `exportImage.ts` leaves them out.
 * - Neither: nothing at all, and a board that has never been voted on renders
 *   exactly what it always did.
 *
 * The buttons are `nodrag nopan` and swallow their `pointerdown`, so voting on a
 * shape neither selects it nor drags it — clicking a dot is about the round, not
 * about the drawing.
 */
export function VoteBadge({ nodeId }: { nodeId: string }) {
  const voting = useDiagramStore((s) => s.voting);
  const viewerId = useDiagramStore((s) => s.viewerId);
  const readOnly = useDiagramStore((s) => s.readOnly);
  // Numbers, never the node: a fresh object per call would re-render every
  // shape on every store update. A board with no round pays two lookups.
  const mine = useDiagramStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId);
    return node ? votesBy(node, s.viewerId) : 0;
  });
  const total = useDiagramStore((s) => {
    if (!s.voting?.revealed) return 0;
    const node = s.nodes.find((n) => n.id === nodeId);
    return node ? voteCount(node) : 0;
  });
  const canAdd = useDiagramStore((s) => canVote(s.voting, s.nodes, s.viewerId));

  if (!voting) return null;

  if (voting.revealed) {
    if (total === 0) return null;
    return (
      <span
        className="vote-badge absolute -right-2 -top-2 z-10 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent-500 px-1.5 text-[11px] font-bold leading-none text-white shadow-sm"
        aria-label={`${total} ${total === 1 ? 'vote' : 'votes'}`}
      >
        {total}
      </span>
    );
  }

  // The round is open. A reader who cannot write to the document (a viewer, the
  // public page) has nothing to place and nothing of their own to show.
  if (!voting.active || readOnly || !viewerId) return null;

  return (
    <div className="vote-badge absolute -right-2 -top-2 z-10 flex items-center gap-0.5 rounded-full bg-panel px-1 py-0.5 shadow-sm ring-1 ring-line">
      {mine > 0 && (
        <>
          <span className="flex items-center gap-0.5 px-0.5" aria-label={`Your votes: ${mine}`}>
            {Array.from({ length: Math.min(mine, 5) }, (_, i) => (
              <span key={i} className="h-2 w-2 rounded-full bg-accent-500" />
            ))}
            {mine > 5 && <span className="text-[10px] font-bold text-ink-700">+{mine - 5}</span>}
          </span>
          <VoteAffordance
            label="Remove your vote"
            onClick={() => useDiagramStore.getState().removeVote(nodeId)}
          >
            −
          </VoteAffordance>
        </>
      )}
      <VoteAffordance
        label="Vote for this shape"
        disabled={!canAdd}
        onClick={() => useDiagramStore.getState().toggleVote(nodeId)}
      >
        +
      </VoteAffordance>
    </div>
  );
}

function VoteAffordance({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      // `nodrag nopan` is React Flow's own escape hatch, and the swallowed
      // pointerdown is what stops the click selecting the shape underneath.
      className={clsx(
        'vote-affordance nodrag nopan flex h-5 w-5 items-center justify-center rounded-full text-[13px] font-bold leading-none text-ink-700 transition',
        disabled ? 'opacity-25' : 'hover:bg-hover',
      )}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
