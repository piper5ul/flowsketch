import { create } from 'zustand';
import { searchDiagram, type SearchHit, type SearchHitKind } from '../lib/search';
import { useDiagramStore } from './useDiagramStore';

/**
 * The find bar's state: what was typed, what it matched, and which match the
 * board is currently framing.
 *
 * Deliberately outside `useDiagramStore`, for the same reason the comment store
 * is: a search is something a reader is doing *to* a diagram, not part of one.
 * Nothing here is serialized, saved, or pushed onto the undo stack — the one
 * thing it does write to the diagram is the selection, and that is done by the
 * bar itself (`SearchBar.tsx`), which is also where the viewport is moved.
 *
 * `hits` are recomputed on every keystroke rather than kept in step with the
 * board: a query is answered against the diagram as it stood when it was typed,
 * which is the moment the user asked.
 */
export interface SearchState {
  open: boolean;
  query: string;
  hits: SearchHit[];
  /** Index into `hits`, or `-1` when there is nothing to point at. */
  activeIndex: number;
  /** Opens the bar. Its input autofocuses on mount, so this is all it takes. */
  openSearch: () => void;
  /** Sets the query and re-runs it, moving back to the first hit. */
  setQuery: (query: string) => void;
  /** The next hit, wrapping past the end. */
  next: () => void;
  /** The previous hit, wrapping past the start. */
  prev: () => void;
  /** Closes the bar and drops every highlight. The selection is left alone. */
  close: () => void;
}

/** Advances the active hit by `delta`, wrapping in both directions. */
function step(delta: 1 | -1) {
  return () =>
    useSearchStore.setState((state) => {
      const count = state.hits.length;
      if (count === 0) return {};
      return { activeIndex: (state.activeIndex + delta + count) % count };
    });
}

export const useSearchStore = create<SearchState>((set) => ({
  open: false,
  query: '',
  hits: [],
  activeIndex: -1,
  openSearch: () => set({ open: true }),
  setQuery: (query) => {
    const { nodes, edges } = useDiagramStore.getState();
    const hits = searchDiagram(nodes, edges, query);
    set({ query, hits, activeIndex: hits.length > 0 ? 0 : -1 });
  },
  next: step(1),
  prev: step(-1),
  close: () => set({ open: false, query: '', hits: [], activeIndex: -1 }),
}));

/** How a shape or connector is drawn while a search is running, if at all. */
export type SearchHighlight = 'hit' | 'active';

/**
 * Whether `id` is one of the current hits, and whether it is *the* one.
 *
 * Exported as a plain function so it can be tested without a renderer; the hook
 * below is the one the canvas uses. It returns a string (or `undefined`) rather
 * than an object on purpose — zustand compares with `Object.is`, so a node that
 * is not part of the search never re-renders while one is being typed.
 */
export function highlightOf(
  state: SearchState,
  kind: SearchHitKind,
  id: string,
): SearchHighlight | undefined {
  if (!state.open) return undefined;
  const index = state.hits.findIndex((hit) => hit.kind === kind && hit.id === id);
  if (index < 0) return undefined;
  return index === state.activeIndex ? 'active' : 'hit';
}

/** `highlightOf` against the live store — what `data-search-hit` is set from. */
export function useSearchHighlight(kind: SearchHitKind, id: string): SearchHighlight | undefined {
  return useSearchStore((state) => highlightOf(state, kind, id));
}
