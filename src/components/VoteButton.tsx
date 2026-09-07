import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleDot, Eye, SortDesc, Trash2 } from 'lucide-react';
import { useDiagramStore } from '../store/useDiagramStore';
import {
  DEFAULT_DOTS_PER_PERSON,
  MAX_DOTS_PER_PERSON,
  MIN_DOTS_PER_PERSON,
  dotsLeft,
  voteCounts,
} from '../lib/voting';

/**
 * The TopBar's Vote control: start a round of dot voting, see how many dots you
 * have left, close the round to reveal the totals, and sort the board by them.
 *
 * Withheld from a viewer and from the public share page, which is the one place
 * this deliberately departs from commenting. A comment has an API of its own and
 * a viewer may write one; a **vote is diagram data**, and a viewer's connection
 * to the document is one-way at both ends — the binding pushes nothing for a
 * read-only board and Hocuspocus would refuse the update anyway. A dot they
 * could place but nobody would ever see is worse than no button. What a viewer
 * does get is the round's *result*: revealed totals are drawn on the shapes for
 * every reader, here and on `/s/:token`.
 *
 * The panel is the whole of the round's chrome. There is no keyboard shortcut
 * and no command: starting a round is a rare, deliberate act, and the letters
 * left are worth more elsewhere.
 */
export function VoteButton() {
  const readOnly = useDiagramStore((s) => s.readOnly);
  const viewerId = useDiagramStore((s) => s.viewerId);
  const voting = useDiagramStore((s) => s.voting);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  // Nobody to attribute a dot to, or nothing this reader may write.
  if (readOnly || !viewerId) return null;

  return (
    <div ref={ref} className="pointer-events-auto relative">
      <div className="flex items-center gap-2 rounded-2xl bg-panel/95 px-2 py-1.5 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-line-subtle backdrop-blur">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          // Named explicitly, because the badge beside the word is part of the
          // button and would otherwise make the name change as dots are spent.
          aria-label="Voting"
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-ink-700 hover:bg-hover"
        >
          <CircleDot size={15} /> Vote
          {voting?.active && <DotsLeftBadge dotsPerPerson={voting.dotsPerPerson} />}
        </button>
      </div>
      {open && <VotePanel onClose={() => setOpen(false)} />}
    </div>
  );
}

/** How many of your dots are still in hand, on the button itself. */
function DotsLeftBadge({ dotsPerPerson }: { dotsPerPerson: number }) {
  const left = useDiagramStore((s) => dotsLeft(s.nodes, s.viewerId, dotsPerPerson));
  return (
    <span
      aria-label={`${left} ${left === 1 ? 'dot' : 'dots'} left`}
      className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-white"
    >
      {left}
    </span>
  );
}

/**
 * A round has three states and the panel shows one of them: not started, open
 * (with the totals hidden), and closed (with them shown).
 *
 * "Start voting" from the closed state clears the previous round's dots first —
 * carrying them in would leave everybody's budget already spent, and the two
 * calls are deliberately separate in the store: clearing the dots is an edit to
 * the board and is undoable, opening a round is not (see `startVoting`).
 */
function VotePanel({ onClose }: { onClose: () => void }) {
  const voting = useDiagramStore((s) => s.voting);
  const votedCount = useDiagramStore((s) => voteCounts(s.nodes).size);
  const left = useDiagramStore((s) =>
    voting ? dotsLeft(s.nodes, s.viewerId, voting.dotsPerPerson) : 0,
  );
  const [dots, setDots] = useState(voting?.dotsPerPerson ?? DEFAULT_DOTS_PER_PERSON);

  const start = useCallback(() => {
    const store = useDiagramStore.getState();
    // A new round starts from nothing: last round's dots would count against
    // everybody's budget in this one.
    store.clearVotes();
    store.startVoting(dots);
  }, [dots]);

  return (
    <div
      role="dialog"
      aria-label="Voting"
      className="panel-in absolute right-0 top-full mt-2 flex w-64 flex-col gap-0.5 rounded-xl bg-ink-950 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)]"
    >
      <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">
        Dot voting
      </div>

      {voting?.active ? (
        <>
          <p className="px-2.5 pb-1.5 text-[13px] text-white/70">
            <span className="font-semibold text-white">{left}</span> of {voting.dotsPerPerson} dots
            left. Click a shape to spend one.
          </p>
          <button
            onClick={() => {
              useDiagramStore.getState().endVoting();
            }}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10"
          >
            <Eye size={15} /> End voting &amp; show totals
          </button>
        </>
      ) : (
        <>
          <label className="flex items-center justify-between px-2.5 py-1 text-[13px] text-white/70">
            <span>Dots per person</span>
            <input
              type="number"
              min={MIN_DOTS_PER_PERSON}
              max={MAX_DOTS_PER_PERSON}
              value={dots}
              onChange={(e) => setDots(Number(e.target.value))}
              aria-label="Dots per person"
              className="w-14 rounded-md bg-white/10 px-2 py-0.5 text-right text-[13px] text-white outline-none focus:ring-1 focus:ring-accent-500"
            />
          </label>
          <button
            onClick={start}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10"
          >
            <CircleDot size={15} /> Start voting
          </button>
        </>
      )}

      {votedCount > 0 && (
        <>
          <div className="mx-1 my-0.5 h-px bg-white/10" />
          <button
            onClick={() => {
              useDiagramStore.getState().sortByVotes();
              onClose();
            }}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10"
          >
            <SortDesc size={15} /> Sort by votes
          </button>
          <button
            onClick={() => useDiagramStore.getState().clearVotes()}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10"
          >
            <Trash2 size={15} /> Clear votes
          </button>
        </>
      )}
    </div>
  );
}
