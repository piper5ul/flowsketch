import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useReactFlow, useStore, useViewport } from '@xyflow/react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useDiagramStore } from '../store/useDiagramStore';
import { usePresentStore } from '../store/usePresentStore';
import { maskRects, slideScreenRect, slidesOf } from '../lib/presentation';

/** How long the board takes to travel from one slide to the next. */
const SLIDE_MS = 300;
/** How long it takes to go back to where the presenter was before they started. */
const RESTORE_MS = 200;

/**
 * Presentation mode: one slide per frame, everything outside the frame masked
 * out in the frame's own colour.
 *
 * **It is mounted from `Canvas`, inside the React Flow provider**, because the
 * slide *is* the board: a slide change is `fitView` onto that frame's node, so
 * the shapes, connectors and images on it are the ones already rendered rather
 * than a second renderer that would have to agree with the first (the reason
 * `HistoryPanel`'s preview is not React Flow is the same reason this one is).
 *
 * **The mask is computed in screen space, not drawn on the board.** Four opaque
 * bands around the frame's box under the live viewport transform — see
 * `maskRects` — which is what "objects that extend past the edge of the section
 * are clipped" means without touching a single node: a shape half out of its
 * frame keeps its position, its parentage and its place in the export, and is
 * simply painted over while that slide is up. A board-space clip would have to
 * be a real element in the diagram, and the transform is right there in
 * `useViewport()` and updates every animation frame, so the mask tracks the fit
 * animation exactly.
 *
 * The overlay covers the flow container rather than the window (`absolute`
 * inside `Canvas`'s wrapper, not `fixed`): the viewport transform is relative to
 * that container, and the public `/s/:token` page puts a header of its own above
 * it — window coordinates would put the mask out by the height of that header.
 */
export function PresentMode() {
  const index = usePresentStore((s) => s.index);
  const next = usePresentStore((s) => s.next);
  const prev = usePresentStore((s) => s.prev);
  const goTo = usePresentStore((s) => s.goTo);
  const stop = usePresentStore((s) => s.stop);
  const nodes = useDiagramStore((s) => s.nodes);
  const slides = useMemo(() => slidesOf(nodes), [nodes]);
  const slide = slides[index];

  const { fitView, getViewport, setViewport } = useReactFlow();
  const viewport = useViewport();
  // The flow container's own size — the coordinate space the transform above is
  // expressed in, and therefore the one the mask has to be clamped to.
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);

  // Where the presenter was before they started. Captured on mount (this
  // component is mounted only while a presentation is running) and put back on
  // the way out, so presenting is not a way of losing your place on the board.
  const restoreRef = useRef(getViewport());
  useEffect(() => {
    const viewportBefore = restoreRef.current;
    return () => {
      void setViewport(viewportBefore, { duration: RESTORE_MS });
    };
  }, [setViewport]);

  // The slide is framed by pointing `fitView` at the frame's own node. No
  // padding: the frame's edge is the edge of the slide, which is what the mask
  // is drawn against.
  // Re-run on a size change as well as on a slide change: a window resized
  // mid-talk (or the share page's header folding away as the presentation
  // starts) changes what "fitted" means, and the mask is drawn against the
  // frame either way.
  const slideId = slide?.id;
  useEffect(() => {
    if (!slideId) return;
    void fitView({ nodes: [{ id: slideId }], padding: 0, duration: SLIDE_MS });
  }, [slideId, fitView, width, height]);

  // A deck that empties under the presentation — the last frame deleted by a
  // collaborator — has nothing left to show.
  useEffect(() => {
    if (slides.length === 0) stop();
  }, [slides.length, stop]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const handlers: Record<string, () => void> = {
        ArrowRight: next,
        ArrowDown: next,
        ' ': next,
        PageDown: next,
        ArrowLeft: prev,
        ArrowUp: prev,
        PageUp: prev,
        Home: () => goTo(0),
        End: () => goTo(slides.length - 1),
        Escape: stop,
      };
      const handler = handlers[event.key];
      if (!handler) return;
      event.preventDefault();
      handler();
    }
    // Captured, so a presentation takes its keys before anything the canvas
    // would otherwise do with them — Escape clears a selection, Space is
    // hold-to-pan, and the arrows nudge.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [next, prev, goTo, stop, slides.length]);

  const onControlClick = useCallback((event: React.MouseEvent) => {
    // The overlay itself advances the deck; the controls are not "somewhere on
    // the slide" and must not do both.
    event.stopPropagation();
  }, []);

  if (!slide) return null;

  const hole = slideScreenRect(slide.rect, viewport);
  const bands = maskRects(hole, { width, height });

  return (
    <div
      data-testid="present-overlay"
      role="region"
      aria-label={`Presenting: ${slide.title}`}
      className="absolute inset-0 z-50 cursor-pointer select-none"
      onClick={next}
      onContextMenu={(event) => event.preventDefault()}
    >
      {bands.map((band, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="absolute"
          // The frame's own colour, so the slide reads as a card of that
          // section rather than as a window cut in the canvas — Whimsical uses
          // a section's background when presenting it.
          style={{ ...band, background: slide.background }}
        />
      ))}

      <div
        role="group"
        aria-label="Presentation controls"
        onClick={onControlClick}
        className="pointer-events-auto absolute bottom-6 left-1/2 flex -translate-x-1/2 cursor-default items-center gap-1 rounded-2xl bg-ink-950/90 px-2 py-1.5 text-white shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)] backdrop-blur"
      >
        <ControlButton label="Previous slide" disabled={index === 0} onClick={prev}>
          <ChevronLeft size={16} />
        </ControlButton>
        <span aria-live="polite" className="px-2 text-[13px] font-medium tabular-nums text-white/85">
          {index + 1} / {slides.length}
        </span>
        <ControlButton
          label="Next slide"
          disabled={index >= slides.length - 1}
          onClick={next}
        >
          <ChevronRight size={16} />
        </ControlButton>
        <span className="mx-1 h-5 w-px bg-white/15" />
        <ControlButton label="Exit presentation" onClick={stop}>
          <X size={16} />
        </ControlButton>
      </div>
    </div>
  );
}

function ControlButton({
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
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-xl text-white/80 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
