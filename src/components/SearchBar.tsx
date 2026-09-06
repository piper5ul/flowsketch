import { useCallback, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { useDiagramStore } from '../store/useDiagramStore';
import { useSearchStore } from '../store/useSearchStore';

/**
 * How the board moves to a hit: close enough to read, never blown up past
 * life size, and briefly enough that the cycle keeps up with a held Enter.
 */
const FRAME_MS = 200;
const FRAME_MAX_ZOOM = 1.2;

/**
 * The find bar, opened by ⌘F (`view.find`).
 *
 * Offered on every board, read-only ones and the public share page included:
 * finding something is looking, not editing, which is why the command is on
 * `READ_ONLY_COMMAND_IDS`.
 *
 * The store holds the query and the hits; this holds the two effects a hit has
 * on the board — it becomes the selection, and the viewport moves to it. Both
 * live here rather than in the store because both need the React Flow instance,
 * and because the selection is the diagram's state, not the search's.
 */
export function SearchBar({ belowTopBar }: { belowTopBar: boolean }) {
  const open = useSearchStore((s) => s.open);
  const query = useSearchStore((s) => s.query);
  const hits = useSearchStore((s) => s.hits);
  const activeIndex = useSearchStore((s) => s.activeIndex);
  const setQuery = useSearchStore((s) => s.setQuery);
  const next = useSearchStore((s) => s.next);
  const prev = useSearchStore((s) => s.prev);
  const close = useSearchStore((s) => s.close);
  const { fitView } = useReactFlow();

  // `activeIndex` is -1 with nothing to point at, which would index from the
  // wrong end of the array rather than off it.
  const active = activeIndex >= 0 ? hits[activeIndex] : undefined;

  // Selecting the hit as well as framing it is what lets the user carry on
  // with it — recolour it, delete it, nudge it — without reaching for the
  // mouse. Written straight through `setState`, the way every other deselect
  // in the app is: a selection is not an edit and pushes no history entry.
  useEffect(() => {
    if (!active) return;
    const { nodes, edges } = useDiagramStore.getState();
    const isNode = active.kind === 'node';
    useDiagramStore.setState({
      nodes: nodes.map((node) => ({ ...node, selected: isNode && node.id === active.id })),
      edges: edges.map((edge) => ({ ...edge, selected: !isNode && edge.id === active.id })),
    });

    // A connector has no box of its own to frame, so the board is framed on
    // the two shapes it runs between — which is the connector, plus what it
    // says about them.
    const edge = isNode ? undefined : edges.find((e) => e.id === active.id);
    const frame = isNode
      ? [{ id: active.id }]
      : edge
        ? [{ id: edge.source }, { id: edge.target }]
        : [];
    if (frame.length > 0) {
      void fitView({ nodes: frame, duration: FRAME_MS, maxZoom: FRAME_MAX_ZOOM });
    }
  }, [active, fitView]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) prev();
        else next();
        return;
      }
      // The canvas's own handler steps aside for anything typed into a field,
      // so ⌘F pressed inside the bar would otherwise reach the browser's find.
      // It re-selects what is already typed, as a second ⌘F does everywhere.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        event.currentTarget.select();
      }
    },
    [close, next, prev],
  );

  if (!open) return null;

  const count =
    hits.length > 0 ? `${activeIndex + 1} of ${hits.length}` : query ? 'No results' : '';

  return (
    <div
      role="search"
      className={clsx(
        'pointer-events-auto absolute right-4 z-20 flex items-center gap-1 rounded-2xl bg-panel/95 py-1.5 pl-3 pr-1.5 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-line-subtle backdrop-blur',
        // The editing top bar floats over the canvas at `top-4`; the share
        // page's header is in the flow above it, so there is nothing to clear.
        belowTopBar ? 'top-16' : 'top-4',
      )}
    >
      <Search size={14} className="shrink-0 text-ink-600/60" />
      <input
        // Mounted only while the bar is open, so this focuses it every time it
        // is opened rather than only the first time.
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find a shape or connector"
        aria-label="Find on canvas"
        className="w-52 bg-transparent text-[13px] text-ink-900 outline-none placeholder:text-ink-600/40"
      />
      <span
        // Announced as it changes, because the count is the only feedback a
        // reader who cannot see the ring on the board gets.
        aria-live="polite"
        className="shrink-0 tabular-nums px-1 text-[12px] text-ink-600/70"
      >
        {count}
      </span>
      <StepButton label="Previous match" disabled={hits.length === 0} onClick={prev}>
        <ChevronUp size={15} />
      </StepButton>
      <StepButton label="Next match" disabled={hits.length === 0} onClick={next}>
        <ChevronDown size={15} />
      </StepButton>
      <StepButton label="Close find" onClick={close}>
        <X size={15} />
      </StepButton>
    </div>
  );
}

function StepButton({
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
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-700/60 transition hover:bg-hover hover:text-ink-700 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
