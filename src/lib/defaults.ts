/**
 * Defaults for freshly created elements. One home for the values the canvas,
 * the store and the toolbars all have to agree on.
 */
import type { ConnectorData, ConnectorKind } from '../types';

/** Every connector starts this colour, and it is the fallback when data is missing. */
export const DEFAULT_EDGE_STROKE = '#6B7080';

/** The `data` bag a brand-new connector starts with: grey, solid, one end arrow. */
export function makeEdgeData(connectorType: ConnectorKind): ConnectorData {
  return {
    connectorType,
    stroke: DEFAULT_EDGE_STROKE,
    strokeStyle: 'solid',
    label: '',
    startArrow: false,
    endArrow: true,
  };
}
