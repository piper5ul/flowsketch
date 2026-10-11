import type { ArrowStyle, ConnectorData, StrokeWidth } from '../types.js';
import { DEFAULT_END_ARROW, DEFAULT_START_ARROW, DEFAULT_STROKE_WIDTH } from './defaults.js';

/**
 * Arrowhead size, in px, for each line width. An arrowhead is sized rather
 * than scaled by the stroke: SVG's default `markerUnits` would multiply the
 * two, leaving a bold line wearing an arrow four times the area of a thin
 * line's rather than the deliberate step below.
 */
export const MARKER_SIZE_PX: Record<StrokeWidth, number> = { 1: 10, 2: 13, 3: 17 };

/** An arrowhead that draws something — every style but `none`. */
export type VisibleArrowStyle = Exclude<ArrowStyle, 'none'>;

/**
 * Where each marker sits on its line. Every shape is drawn in a 10×10 box
 * with its tip at x = 10; `refX` is the point in that box that lands on the
 * path's end, so the shape extends `depth` (as a fraction of the marker's
 * size) *beyond* the line, toward the shape it points at. The line stops
 * where the head begins — Whimsical's way — instead of running through the
 * head to the tip, where a round-capped 4px line pokes out past the point.
 */
export const MARKER_GEOMETRY: Record<VisibleArrowStyle, { refX: number; depth: number }> = {
  arrow: { refX: 2, depth: 0.8 },
  open: { refX: 2, depth: 0.8 },
  diamond: { refX: 0, depth: 1 },
  circle: { refX: 1, depth: 0.8 },
  halfcircle: { refX: 5, depth: 0.5 },
  dot: { refX: 5, depth: 0.5 },
  // A bar stands across the line's end and reaches no further.
  bar: { refX: 5, depth: 0 },
};

/**
 * How far past the path's end a marker of `style` reaches, in px, for a line
 * of `width` — what an endpoint is pushed out by so the head's tip, not the
 * line's end, lands where the connector was aimed. Nothing for `none`.
 */
export function markerDepthPx(style: ArrowStyle | undefined, width: StrokeWidth | undefined): number {
  const s = style ?? 'none';
  if (s === 'none') return 0;
  return MARKER_GEOMETRY[s].depth * MARKER_SIZE_PX[width ?? DEFAULT_STROKE_WIDTH];
}

/** One `<marker>` for `ConnectorMarkerDefs` to render. */
export interface MarkerDef {
  /** What `markerStart`/`markerEnd` point at. */
  id: string;
  style: VisibleArrowStyle;
  color: string;
  /** Side of the marker's box, in px. */
  size: number;
}

/** The `ConnectorData` fields an arrowhead is derived from. */
type MarkerSource = Pick<ConnectorData, 'stroke' | 'startArrowStyle' | 'endArrowStyle' | 'strokeWidth'>;

/**
 * The id of the one marker that draws this style at this colour and size.
 *
 * Two connectors that want the same arrowhead therefore share a def, and the
 * id doubles as the dedupe key. Colours are folded into the id rather than
 * inherited via `context-stroke`, which Safari does not implement for markers.
 */
export function markerId(style: VisibleArrowStyle, color: string, size: number): string {
  // Not one-to-one: `rgb(1, 23, 4)` and `rgb(12, 3, 4)` share an id. The picker only writes hex, and stored Yjs edges carry these ids verbatim, so the format stays.
  return `fs-${style}-${color.replace(/[^a-zA-Z0-9]/g, '')}-${size}`;
}

/** The style, colour and size each end of a connector is drawn with. */
function resolve(data: MarkerSource): { start: ArrowStyle; end: ArrowStyle; color: string; size: number } {
  return {
    start: data.startArrowStyle ?? DEFAULT_START_ARROW,
    end: data.endArrowStyle ?? DEFAULT_END_ARROW,
    color: data.stroke,
    size: MARKER_SIZE_PX[data.strokeWidth ?? DEFAULT_STROKE_WIDTH],
  };
}

/**
 * Arrowheads are top-level edge fields (`markerStart`/`markerEnd`), not
 * `data`, so React Flow can point each end at the right `<marker>`. Call this
 * whenever stroke colour, width or either arrowhead style changes.
 *
 * The value is the id of a def `ConnectorMarkerDefs` renders, not one of React
 * Flow's own marker descriptors: React Flow builds `arrow` and `arrowclosed`
 * only, and three of the five styles are neither. React Flow passes a string
 * marker straight through as `url(#…)` and generates no def of its own for it.
 *
 * Lives here rather than in the store so the migration layer can reach it
 * without importing the store.
 */
export function computeMarkers(data: MarkerSource): { markerStart?: string; markerEnd?: string } {
  const { start, end, color, size } = resolve(data);
  return {
    markerStart: start === 'none' ? undefined : markerId(start, color, size),
    markerEnd: end === 'none' ? undefined : markerId(end, color, size),
  };
}

/**
 * Every distinct marker the given connectors reference, once each — what
 * `ConnectorMarkerDefs` renders into the canvas. Ordered by id so the list is
 * stable across renders regardless of the order the edges arrive in.
 */
export const SELECTION_MARKER_COLOR = '#7c5cff';

type MarkerEdge = { data?: ConnectorData; selected?: boolean };

export function markerDefsForEdges(edges: readonly MarkerEdge[]): MarkerDef[] {
  const byId = new Map<string, MarkerDef>();

  for (const edge of edges) {
    if (!edge.data) continue;
    const { start, end, color, size } = resolve(edge.data);
    for (const style of [start, end]) {
      if (style === 'none') continue;
      const id = markerId(style, color, size);
      if (!byId.has(id)) byId.set(id, { id, style, color, size });
      if (edge.selected) {
        const selId = markerId(style, SELECTION_MARKER_COLOR, size);
        if (!byId.has(selId)) byId.set(selId, { id: selId, style, color: SELECTION_MARKER_COLOR, size });
      }
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * One object per distinct head, so the list of defs can be compared shallowly
 * and re-renders only when the set of heads on the board changes, not on every
 * frame an end or a bend is dragged. Keyed on the full (style, colour, size)
 * tuple and never on the id: two colours can share an id (see `markerId`), and
 * keying on it would hand one diagram's colour to another's def.
 *
 * The cache only buys reference equality, so it is bounded crudely: past
 * `MAX_CACHED_DEFS` distinct heads (a long session through many boards with
 * custom colours) it is emptied, which costs one re-render of the defs.
 */
const MAX_CACHED_DEFS = 512;
const defsByHead = new Map<string, MarkerDef>();
const defsByEdges = new WeakMap<readonly MarkerEdge[], MarkerDef[]>();

export function stableMarkerDefs(edges: readonly MarkerEdge[]): MarkerDef[] {
  let defs = defsByEdges.get(edges);
  if (!defs) {
    defs = markerDefsForEdges(edges).map((def) => {
      const head = `${def.style}\u0000${def.color}\u0000${def.size}`;
      const known = defsByHead.get(head);
      if (known) return known;
      if (defsByHead.size >= MAX_CACHED_DEFS) defsByHead.clear();
      defsByHead.set(head, def);
      return def;
    });
    defsByEdges.set(edges, defs);
  }
  return defs;
}
