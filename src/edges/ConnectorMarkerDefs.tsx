/**
 * The `<marker>` defs every connector's arrowheads point at.
 *
 * React Flow generates defs only for its own two marker types, so the five
 * styles a connector can wear are drawn here instead, one def per distinct
 * style/colour/size across the diagram (see `markerDefsForEdges`).
 *
 * It renders through `ViewportPortal` rather than as a plain child of
 * `<ReactFlow>`: the image export captures `.react-flow__viewport`, and defs
 * outside that subtree would leave every arrowhead missing from the file.
 */
import { ViewportPortal } from '@xyflow/react';
import { useMemo } from 'react';
import { markerDefsForEdges, type MarkerDef, type VisibleArrowStyle } from '../lib/edgeMarkers';
import { useDiagramStore } from '../store/useDiagramStore';

/**
 * Every shape is drawn in this box, tip to the right, and `REF_X` names the
 * point in it that lands on the connector's endpoint.
 */
const VIEW_BOX = '0 0 10 10';

const REF_X: Record<VisibleArrowStyle, number> = {
  // The tip of the head sits on the endpoint...
  arrow: 10,
  diamond: 10,
  open: 9.5,
  // ...and a circle rests against it, so it reads as a terminal, not a joint.
  circle: 9,
};

function MarkerShape({ style, color }: { style: VisibleArrowStyle; color: string }) {
  switch (style) {
    case 'arrow':
      // Wider than it is long — 13px across by 10px deep on a regular line,
      // the proportions measured off Whimsical's — with a hairline stroke of
      // its own colour so the corners are soft rather than cut. The path is
      // inset by half that stroke, so the painted extent is still the full
      // box and the tip still lands on `REF_X`.
      return (
        <path
          d="M 2.5 0.5 L 9.5 5 L 2.5 9.5 Z"
          fill={color}
          stroke={color}
          strokeWidth={1}
          strokeLinejoin="round"
        />
      );
    case 'open':
      return (
        <path
          d="M 2 0.5 L 9.5 5 L 2 9.5"
          fill="none"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'circle':
      return <circle cx={5} cy={5} r={4} fill={color} />;
    case 'diamond':
      return <path d="M 0 5 L 5 0 L 10 5 L 5 10 Z" fill={color} />;
  }
}

function Marker({ id, style, color, size }: MarkerDef) {
  return (
    <marker
      id={id}
      viewBox={VIEW_BOX}
      refX={REF_X[style]}
      refY={5}
      markerWidth={size}
      markerHeight={size}
      // `strokeWidth` (the default) would scale the marker by the line's width
      // on top of the size it was already given — see `MARKER_SIZE_PX`.
      markerUnits="userSpaceOnUse"
      // One def serves both ends: the start end draws it reversed.
      orient="auto-start-reverse"
    >
      <MarkerShape style={style} color={color} />
    </marker>
  );
}

export function ConnectorMarkerDefs() {
  const edges = useDiagramStore((s) => s.edges);
  const defs = useMemo(() => markerDefsForEdges(edges), [edges]);

  return (
    <ViewportPortal>
      {/* Definitions only — nothing here paints, so it takes no space. */}
      <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          {defs.map((def) => (
            <Marker key={def.id} {...def} />
          ))}
        </defs>
      </svg>
    </ViewportPortal>
  );
}
