/**
 * Defaults for freshly created elements. One home for the values the canvas,
 * the store and the toolbars all have to agree on.
 */
import type { ArrowStyle, ConnectorData, ConnectorKind, StrokeWidth } from '../types.js';

/** Every connector starts this colour, and it is the fallback when data is missing. */
export const DEFAULT_EDGE_STROKE = '#6B7080';

/**
 * What a connector without a `strokeWidth` is drawn at — every diagram saved
 * before the setting existed, so this is the one width that must not change.
 */
export const DEFAULT_STROKE_WIDTH: StrokeWidth = 2;

/** The line width, in px, behind each of the three settings. */
export const CONNECTOR_STROKE_PX: Record<StrokeWidth, number> = { 1: 1.5, 2: 2.5, 3: 4 };

/**
 * What each end of a connector wears when it does not say. A connector points
 * at what it connects to, so only the target end carries an arrowhead.
 */
export const DEFAULT_START_ARROW: ArrowStyle = 'none';
export const DEFAULT_END_ARROW: ArrowStyle = 'arrow';

/** The `data` bag a brand-new connector starts with: grey, solid, one end arrow. */
export function makeEdgeData(connectorType: ConnectorKind): ConnectorData {
  return {
    connectorType,
    stroke: DEFAULT_EDGE_STROKE,
    strokeStyle: 'solid',
    label: '',
    startArrowStyle: DEFAULT_START_ARROW,
    endArrowStyle: DEFAULT_END_ARROW,
  };
}
