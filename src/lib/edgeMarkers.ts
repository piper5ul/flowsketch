import type { ArrowStyle, ConnectorData, StrokeWidth } from '../types.js';
import { DEFAULT_END_ARROW, DEFAULT_START_ARROW, DEFAULT_STROKE_WIDTH } from './defaults.js';

/**
 * Arrowhead size, in px, for each line width. An arrowhead is sized rather
 * than scaled by the stroke: SVG's default `markerUnits` would multiply the
 * two, leaving a bold line wearing an arrow four times the area of a thin
 * line's rather than the deliberate step below.
 */
const MARKER_SIZE_PX: Record<StrokeWidth, number> = { 1: 10, 2: 13, 3: 17 };

/** An arrowhead that draws something — every style but `none`. */
export type VisibleArrowStyle = Exclude<ArrowStyle, 'none'>;

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
export function markerDefsForEdges(edges: { data?: ConnectorData }[]): MarkerDef[] {
  const byId = new Map<string, MarkerDef>();

  for (const edge of edges) {
    if (!edge.data) continue;
    const { start, end, color, size } = resolve(edge.data);
    for (const style of [start, end]) {
      if (style === 'none') continue;
      const id = markerId(style, color, size);
      if (!byId.has(id)) byId.set(id, { id, style, color, size });
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
