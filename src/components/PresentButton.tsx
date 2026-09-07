import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Play } from 'lucide-react';
import { useDiagramStore } from '../store/useDiagramStore';
import { usePresentStore } from '../store/usePresentStore';
import { isFrameNode } from '../lib/nodeKinds';
import { moveSlide, slidesOf } from '../lib/presentation';

/**
 * The TopBar's Present control: a button that starts the deck, and a caret next
 * to it for the one thing about a presentation that is not a view — the order
 * the slides run in.
 *
 * Hidden entirely on a board with no frames, which is exactly the gate the
 * `view.present` command carries: a diagram with no sections has no deck.
 * Offered to viewers, because presenting is looking (see
 * `READ_ONLY_COMMAND_IDS`); "Arrange slides" is not, and is withheld from one.
 */
export function PresentButton() {
  // A boolean rather than the node array: this sits in the top bar and must not
  // re-render on every keystroke into a shape's label.
  const hasFrames = useDiagramStore((s) => s.nodes.some((n) => isFrameNode(n)));
  const readOnly = useDiagramStore((s) => s.readOnly);
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  const start = useCallback(() => {
    setMenuOpen(false);
    usePresentStore.getState().start();
  }, []);

  if (!hasFrames) return null;

  return (
    <div ref={ref} className="pointer-events-auto relative">
      <div className="flex items-center gap-0.5 rounded-2xl bg-panel/95 px-2 py-1.5 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-line-subtle backdrop-blur">
        <button
          onClick={start}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-ink-700 hover:bg-hover"
        >
          <Play size={15} /> Present
        </button>
        {/* The order is a property of the diagram, so only somebody who can
            edit it is offered the panel; a viewer gets the button alone. */}
        {!readOnly && (
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Presentation options"
            aria-expanded={menuOpen}
            className="flex h-6 w-5 items-center justify-center rounded-lg text-ink-700/60 hover:bg-hover hover:text-ink-700"
          >
            <ChevronDown size={14} />
          </button>
        )}
      </div>
      {menuOpen && <SlideOrderPanel onPresent={start} />}
    </div>
  );
}

/**
 * "Arrange slides": every frame on the board, in the order it will be
 * presented, with a pair of buttons that move one up or down.
 *
 * The list is **derived from the store on every render** rather than held as
 * local state — `setSlideOrder` writes `slideOrder` onto the frames, so the
 * next render already shows the new order, and there is no second copy to keep
 * in step with a collaborator moving a frame at the same time. Buttons rather
 * than drag and drop: this is a handful of rows, and a keyboard reaches them.
 */
function SlideOrderPanel({ onPresent }: { onPresent: () => void }) {
  const nodes = useDiagramStore((s) => s.nodes);
  const setSlideOrder = useDiagramStore((s) => s.setSlideOrder);
  const slides = useMemo(() => slidesOf(nodes), [nodes]);
  const ids = useMemo(() => slides.map((slide) => slide.id), [slides]);

  const move = useCallback(
    (index: number, delta: 1 | -1) => setSlideOrder(moveSlide(ids, index, delta)),
    [ids, setSlideOrder],
  );

  return (
    <div className="panel-in absolute right-0 top-full mt-2 flex w-64 flex-col gap-0.5 rounded-xl bg-ink-950 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)]">
      <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">
        Arrange slides
      </div>
      <ol className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        {slides.map((slide, index) => (
          <li key={slide.id} className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[13px] text-white/85 hover:bg-white/5">
            <span className="w-4 shrink-0 tabular-nums text-white/40">{index + 1}</span>
            <button
              type="button"
              onClick={() => usePresentStore.getState().start(index)}
              className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
            >
              {slide.title}
            </button>
            <MoveButton
              label={`Move ${slide.title} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp size={13} />
            </MoveButton>
            <MoveButton
              label={`Move ${slide.title} down`}
              disabled={index === slides.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown size={13} />
            </MoveButton>
          </li>
        ))}
      </ol>
      <div className="mx-1 my-0.5 h-px bg-white/10" />
      <button
        onClick={onPresent}
        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10"
      >
        <Play size={15} /> Start presenting
      </button>
    </div>
  );
}

function MoveButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
    >
      {children}
    </button>
  );
}
