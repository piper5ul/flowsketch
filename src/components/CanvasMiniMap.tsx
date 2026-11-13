import { MiniMap } from '@xyflow/react';
import type { ShapeNode } from '../store/useDiagramStore';

/**
 * What a node with no usable fill is drawn as — a v0 row can reach the canvas
 * with an empty `data` bag, and an unpainted blob beats an invisible one.
 */
const FALLBACK_NODE_COLOR = '#d6d9e4';

/** Each shape shows in its own colour, so the map reads like the board does. */
function nodeColor(node: ShapeNode): string {
  const { fill } = node.data;
  return typeof fill === 'string' && fill.length > 0 ? fill : FALLBACK_NODE_COLOR;
}

/**
 * A hairline round every painted shape, so a white one still shows on the
 * map's white card. Nothing is outlined that paints nothing — a group, a
 * floating arrow's anchor — or the map would fill up with boxes and dots the
 * board does not show. The width is kept to a screen pixel by
 * `vector-effect` in `index.css`, whatever the map's scale.
 */
function nodeStrokeColor(node: ShapeNode): string {
  return nodeColor(node) === 'transparent' ? 'transparent' : 'var(--minimap-mask-stroke)';
}

/**
 * The card's size, in px. React Flow sizes the map's SVG — and the scale the
 * board is drawn at inside it — from the `style` it is handed, not from CSS,
 * so this has to match `.rf-minimap` in `index.css` or the SVG spills out of
 * the card.
 */
const MINIMAP_SIZE = { width: 176, height: 112 };

/**
 * The overview map, sitting directly above the bottom bar and wearing the same
 * card (`.react-flow__minimap.rf-minimap` in `index.css`, which also does the
 * positioning React Flow's own panel classes would otherwise own).
 *
 * Rendered only while the preference is on — a hidden minimap should cost
 * nothing, and it re-renders on every node move.
 */
export function CanvasMiniMap() {
  return (
    <MiniMap<ShapeNode>
      pannable
      zoomable
      ariaLabel="Diagram minimap"
      className="rf-minimap"
      style={MINIMAP_SIZE}
      nodeColor={nodeColor}
      nodeStrokeColor={nodeStrokeColor}
      nodeStrokeWidth={1}
      nodeBorderRadius={3}
      // The mask is chrome, so it follows the theme; the node colours below do
      // not — they are the shapes' own fills, which a theme never touches.
      maskColor="var(--minimap-mask)"
      maskStrokeColor="var(--minimap-mask-stroke)"
      offsetScale={2}
    />
  );
}
