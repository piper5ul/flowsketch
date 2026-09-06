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
      nodeColor={nodeColor}
      nodeStrokeWidth={0}
      nodeBorderRadius={3}
      maskColor="rgba(24, 26, 36, 0.08)"
      maskStrokeColor="rgba(24, 26, 36, 0.18)"
      offsetScale={2}
    />
  );
}
