import { MarkerType, type EdgeMarkerType } from '@xyflow/react';
import type { ConnectorData, StrokeWidth } from '../types';
import { DEFAULT_STROKE_WIDTH } from './defaults';

/**
 * Arrowhead size, in px, for each line width. An arrowhead is sized rather
 * than scaled by the stroke: SVG's default `markerUnits` would multiply the
 * two, leaving a bold line wearing an arrow four times the area of a thin
 * line's rather than the deliberate step below.
 */
const MARKER_SIZE_PX: Record<StrokeWidth, number> = { 1: 8, 2: 10, 3: 14 };

/**
 * Arrowheads are top-level edge fields (`markerStart`/`markerEnd`), not
 * `data`, so React Flow can generate a correctly-colored `<marker>` def per
 * edge. Call this whenever stroke color, width or arrow visibility changes.
 *
 * Lives here rather than in the store so the migration layer can reach it
 * without importing the store.
 */
export function computeMarkers(
  data: Pick<ConnectorData, 'stroke' | 'startArrow' | 'endArrow' | 'strokeWidth'>,
): {
  markerStart?: EdgeMarkerType;
  markerEnd?: EdgeMarkerType;
} {
  const size = MARKER_SIZE_PX[data.strokeWidth ?? DEFAULT_STROKE_WIDTH];
  const marker: EdgeMarkerType = { type: MarkerType.ArrowClosed, color: data.stroke, width: size, height: size };
  return {
    markerStart: data.startArrow ? marker : undefined,
    markerEnd: data.endArrow ? marker : undefined,
  };
}
