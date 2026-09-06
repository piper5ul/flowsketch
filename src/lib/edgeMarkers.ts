import { MarkerType, type EdgeMarkerType } from '@xyflow/react';
import type { ConnectorData } from '../types';

/**
 * Arrowheads are top-level edge fields (`markerStart`/`markerEnd`), not
 * `data`, so React Flow can generate a correctly-colored `<marker>` def per
 * edge. Call this whenever stroke color or arrow visibility changes.
 *
 * Lives here rather than in the store so the migration layer can reach it
 * without importing the store.
 */
export function computeMarkers(data: Pick<ConnectorData, 'stroke' | 'startArrow' | 'endArrow'>): {
  markerStart?: EdgeMarkerType;
  markerEnd?: EdgeMarkerType;
} {
  const marker: EdgeMarkerType = { type: MarkerType.ArrowClosed, color: data.stroke, width: 10, height: 10 };
  return {
    markerStart: data.startArrow ? marker : undefined,
    markerEnd: data.endArrow ? marker : undefined,
  };
}
