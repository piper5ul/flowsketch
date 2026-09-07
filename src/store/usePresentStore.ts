import { create } from 'zustand';
import { slidesOf } from '../lib/presentation';
import { useDiagramStore } from './useDiagramStore';

/**
 * Presentation mode: whether it is running and which slide is up.
 *
 * Deliberately outside `useDiagramStore`, for the same reason the search and
 * comment stores are: presenting is something a reader does *to* a diagram, not
 * part of one. Nothing here is serialized, saved, or pushed onto the undo
 * stack — the running order is, and that lives on the frames themselves as
 * `slideOrder` (see `setSlideOrder`).
 *
 * The deck is read from the diagram store rather than copied into this one, so
 * a frame renamed, moved or deleted while a presentation is up cannot leave the
 * index pointing past the end.
 *
 * **The ends clamp, they do not wrap.** A find bar cycles because a search is a
 * loop the reader is walking round; a deck is not — walking off the end of a
 * presentation and landing back on slide 1 is a way of losing your place, and
 * ⌘F's wrap-around has a counter next to it that says so where a slide does not.
 */
export interface PresentState {
  active: boolean;
  /** Index into the current deck; meaningless while `active` is false. */
  index: number;
  /**
   * Starts presenting at `index` (the first slide by default), clamped to the
   * deck. A board with no frames has no deck and cannot be presented, so this
   * does nothing at all there rather than opening an empty overlay.
   */
  start: (index?: number) => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
}

/** How many slides the open diagram has right now. */
function slideCount(): number {
  return slidesOf(useDiagramStore.getState().nodes).length;
}

function clampIndex(index: number, count: number): number {
  return Math.min(Math.max(Math.trunc(index), 0), Math.max(0, count - 1));
}

/** Steps the active slide by `delta`, stopping at either end of the deck. */
function step(delta: 1 | -1) {
  return () =>
    usePresentStore.setState((state) => {
      if (!state.active) return {};
      return { index: clampIndex(state.index + delta, slideCount()) };
    });
}

export const usePresentStore = create<PresentState>((set) => ({
  active: false,
  index: 0,
  start: (index = 0) => {
    const count = slideCount();
    if (count === 0) return;
    set({ active: true, index: clampIndex(index, count) });
  },
  stop: () => set({ active: false, index: 0 }),
  next: step(1),
  prev: step(-1),
  goTo: (index) =>
    set((state) => (state.active ? { index: clampIndex(index, slideCount()) } : {})),
}));
