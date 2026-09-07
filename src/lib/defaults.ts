/**
 * Defaults for freshly created elements. One home for the values the canvas,
 * the store and the toolbars all have to agree on.
 */
import type { ArrowStyle, ConnectorData, ConnectorKind, StrokeWidth } from '../types.js';

/** Every connector starts this colour, and it is the fallback when data is missing. */
export const DEFAULT_EDGE_STROKE = '#788896';

/**
 * How far short of the shape a connector stops, in px. A line that runs right
 * up to the edge reads as part of the shape; six pixels of board between them
 * (the gap Whimsical leaves) makes it a line *between* two things. A floating
 * arrow's ends are 1×1 anchors with nothing to stand off from, so they get 0.
 */
export const CONNECTOR_STANDOFF_PX = 6;

/**
 * What a connector without a `strokeWidth` is drawn at — every diagram saved
 * before the setting existed, so this is the one width that must not change.
 */
export const DEFAULT_STROKE_WIDTH: StrokeWidth = 2;

/** The line width, in px, behind each of the three settings. */
export const CONNECTOR_STROKE_PX: Record<StrokeWidth, number> = { 1: 2.5, 2: 4, 3: 6 };

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
