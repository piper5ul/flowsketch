import { useCallback, useEffect, useRef } from 'react';
import { BaseEdge, EdgeLabelRenderer, useReactFlow, type EdgeProps } from '@xyflow/react';
import {
  anchorToPoint,
  distanceToRect,
  floatingEdgeSides,
  nearestAnchorOnRect,
  type EdgeAnchor,
  type Rect,
} from '../lib/edgeGeometry';
import { buildConnectorPath, controlThrough, type Point } from '../lib/connectorPath';
import { manhattanRoute } from '../lib/manhattanRouter';
import { DEFAULT_EDGE_STROKE } from '../lib/defaults';
import { isAnchorNode } from '../lib/nodeKinds';
import type { ConnectorEdge as ConnectorEdgeType, ShapeNode } from '../store/useDiagramStore';
import { useDiagramStore, consumeSuppressBlur } from '../store/useDiagramStore';
import type { ConnectorKind, FontSize } from '../types';

const FONT_SIZE_PX: Record<FontSize, number> = { small: 11, medium: 12, large: 15 };

const DASH_ARRAYS: Record<string, string | undefined> = {
  solid: undefined,
  dashed: '10 8',
  dotted: '1.5 7',
};

function rectOfNode(n: ShapeNode): Rect {
  return {
    x: n.position.x,
    y: n.position.y,
    width: n.width ?? n.measured?.width ?? 0,
    height: n.height ?? n.measured?.height ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Polyline interpolation helpers for label positioning
// ---------------------------------------------------------------------------

function interpolatePolyline(
  pts: { x: number; y: number }[],
  t: number,
): { x: number; y: number } {
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
  t = Math.max(0, Math.min(1, t));
  let total = 0;
  const segs: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segs.push(d);
    total += d;
  }
  if (total < 0.001) return pts[0];
  const target = t * total;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i] >= target) {
      const segT = segs[i] > 0 ? (target - acc) / segs[i] : 0;
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * segT,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * segT,
      };
    }
    acc += segs[i];
  }
  return pts[pts.length - 1];
}

function nearestTOnPolyline(
  pts: { x: number; y: number }[],
  px: number,
  py: number,
): number {
  let total = 0;
  const segs: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segs.push(d);
    total += d;
  }
  if (total < 0.001) return 0.5;
  let bestDist = Infinity;
  let bestT = 0.5;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const ax = pts[i].x, ay = pts[i].y;
    const bx = pts[i + 1].x, by = pts[i + 1].y;
    const dx = bx - ax, dy = by - ay;
    const len = segs[i];
    if (len < 0.001) { acc += len; continue; }
    let segT = ((px - ax) * dx + (py - ay) * dy) / (len * len);
    segT = Math.max(0, Math.min(1, segT));
    const projX = ax + dx * segT;
    const projY = ay + dy * segT;
    const dist = Math.hypot(px - projX, py - projY);
    if (dist < bestDist) {
      bestDist = dist;
      bestT = (acc + segT * len) / total;
    }
    acc += len;
  }
  return bestT;
}

// ---------------------------------------------------------------------------

/**
 * Records the one history entry a pointer drag is worth. Deferring it to the
 * first move (rather than pointerdown) keeps a click that never turns into a
 * drag from leaving an empty undo step behind.
 */
function historyOnce(): () => void {
  let started = false;
  return () => {
    if (started) return;
    started = true;
    useDiagramStore.getState().beginInteraction();
  };
}

export function ConnectorEdge({ id, source, target, data, selected, markerStart, markerEnd }: EdgeProps<ConnectorEdgeType>) {
  const nodes = useDiagramStore((s) => s.nodes);
  const updateEdgeData = useDiagramStore((s) => s.updateEdgeData);
  const updateEdgeDataTransient = useDiagramStore((s) => s.updateEdgeDataTransient);
  const moveNodesTransient = useDiagramStore((s) => s.moveNodesTransient);
  const reconnectEdgeEndpoint = useDiagramStore((s) => s.reconnectEdgeEndpoint);
  const editingEdgeId = useDiagramStore((s) => s.editingEdgeId);
  const setEditingEdgeId = useDiagramStore((s) => s.setEditingEdgeId);
  const { screenToFlowPosition } = useReactFlow();
  const editing = editingEdgeId === id;
  const labelRef = useRef<HTMLDivElement>(null);
  const pathPointsRef = useRef<Point[]>([]);
  // What the bend drag needs from the render that laid the path out. Held in a
  // ref because the handler is a `useCallback` declared before the geometry —
  // the endpoint nodes may be missing, so the layout runs after an early return.
  const dragRef = useRef<{ kind: ConnectorKind; source: Point; target: Point } | null>(null);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => labelRef.current?.focus());
      });
    }
  }, [editing]);

  const commit = useCallback(() => {
    if (consumeSuppressBlur()) return;
    setEditingEdgeId(null);
    updateEdgeData(id, { label: labelRef.current?.innerText ?? '' });
  }, [id, updateEdgeData, setEditingEdgeId]);

  const onWaypointPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const begin = historyOnce();
      const onMove = (ev: PointerEvent) => {
        begin();
        const flow = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        const layout = dragRef.current;
        // A curve is pulled by a control point off the curve; the other kinds
        // pass through the waypoint, so the pointer is the waypoint.
        const waypoint = layout?.kind === 'curved'
          ? controlThrough(layout.source, flow, layout.target)
          : { x: flow.x, y: flow.y };
        updateEdgeDataTransient(id, { waypoint });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [id, screenToFlowPosition, updateEdgeDataTransient],
  );

  const onEndpointPointerDown = useCallback(
    (end: 'source' | 'target') => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const otherId = end === 'source' ? target : source;
      const candidates = nodes.filter((n) => n.id !== otherId);
      const begin = historyOnce();
      const onMove = (ev: PointerEvent) => {
        if (candidates.length === 0) return;
        begin();
        const flow = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        let best = candidates[0];
        let bestDist = Infinity;
        for (const n of candidates) {
          const d = distanceToRect(flow.x, flow.y, rectOfNode(n));
          if (d < bestDist) {
            bestDist = d;
            best = n;
          }
        }
        const anchor = nearestAnchorOnRect(flow.x, flow.y, rectOfNode(best));
        reconnectEdgeEndpoint(id, end, best.id, anchor);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [id, source, target, nodes, screenToFlowPosition, reconnectEdgeEndpoint],
  );

  const onLabelPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (editing) return;
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      const begin = historyOnce();
      const onMove = (ev: PointerEvent) => {
        if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return;
        dragging = true;
        begin();
        ev.preventDefault();
        const flow = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        const t = nearestTOnPolyline(pathPointsRef.current, flow.x, flow.y);
        updateEdgeDataTransient(id, { labelT: t });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [id, editing, screenToFlowPosition, updateEdgeDataTransient],
  );

  const sourceNode = nodes.find((n) => n.id === source);
  const targetNode = nodes.find((n) => n.id === target);

  // Primitive deps so the hook can be declared unconditionally (rules-of-hooks)
  // even when one endpoint node is missing during a delete/undo transition.
  const srcX = sourceNode?.position.x;
  const srcY = sourceNode?.position.y;
  const tgtX = targetNode?.position.x;
  const tgtY = targetNode?.position.y;

  const onEdgeDragDown = useCallback(
    (e: React.PointerEvent<SVGPathElement>) => {
      if (srcX === undefined || srcY === undefined || tgtX === undefined || tgtY === undefined) return;
      e.stopPropagation();
      e.preventDefault();
      const startPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const srcPos = { x: srcX, y: srcY };
      const tgtPos = { x: tgtX, y: tgtY };

      const begin = historyOnce();
      const onMove = (ev: PointerEvent) => {
        begin();
        const pos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        const dx = pos.x - startPos.x;
        const dy = pos.y - startPos.y;
        moveNodesTransient({
          [source]: { x: srcPos.x + dx, y: srcPos.y + dy },
          [target]: { x: tgtPos.x + dx, y: tgtPos.y + dy },
        });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [source, target, srcX, srcY, tgtX, tgtY, screenToFlowPosition, moveNodesTransient],
  );

  if (!sourceNode || !targetNode) return null;

  const isFloatingArrow = isAnchorNode(sourceNode.data) && isAnchorNode(targetNode.data);

  const floating = floatingEdgeSides(rectOfNode(sourceNode), rectOfNode(targetNode));
  const sourceAnchor: EdgeAnchor = data?.sourceAnchor ?? { side: floating.sourcePos, t: 0.5 };
  const targetAnchor: EdgeAnchor = data?.targetAnchor ?? { side: floating.targetPos, t: 0.5 };
  const { x: sx, y: sy } = anchorToPoint(sourceAnchor, rectOfNode(sourceNode));
  const { x: tx, y: ty } = anchorToPoint(targetAnchor, rectOfNode(targetNode));

  const stroke = data?.stroke ?? DEFAULT_EDGE_STROKE;
  const strokeStyle = data?.strokeStyle ?? 'solid';
  const connectorType = data?.connectorType ?? 'elbow';
  const waypoint = data?.waypoint ?? null;
  const strokeWidth = selected ? 3 : 2.5;

  // Only an elbow is routed around the other shapes; the other two kinds run
  // straight from anchor to anchor and need nothing from the router.
  let routed: Point[] | undefined;
  if (connectorType === 'elbow') {
    const isVertical = (sourceAnchor.side === 'top' || sourceAnchor.side === 'bottom') &&
      (targetAnchor.side === 'top' || targetAnchor.side === 'bottom');
    const isHorizontal = (sourceAnchor.side === 'left' || sourceAnchor.side === 'right') &&
      (targetAnchor.side === 'left' || targetAnchor.side === 'right');
    const isCollinear = (isVertical && Math.abs(sx - tx) < 2) || (isHorizontal && Math.abs(sy - ty) < 2);

    routed = isCollinear && !waypoint
      ? []
      : manhattanRoute({
          sourceX: sx,
          sourceY: sy,
          targetX: tx,
          targetY: ty,
          sourceRect: rectOfNode(sourceNode),
          targetRect: rectOfNode(targetNode),
          obstacles: nodes.filter((n) => n.id !== source && n.id !== target).map(rectOfNode),
          vertices: waypoint ? [waypoint] : [],
          startDirections: [sourceAnchor.side],
          endDirections: [targetAnchor.side],
        }).points;
  }

  const { d: svgPathString, center, points: pathPoints } = buildConnectorPath(connectorType, {
    source: { x: sx, y: sy },
    target: { x: tx, y: ty },
    sourceSide: sourceAnchor.side,
    targetSide: targetAnchor.side,
    waypoint,
    routed,
  });
  const edgeCenterX = center.x;
  const edgeCenterY = center.y;

  // Grab handles for the individual runs of an elbow. The other kinds have no
  // straight runs to grab, so their only handle is the bend at the centre.
  const segmentHandles: { x: number; y: number; orientation: 'h' | 'v' }[] = [];
  if (connectorType === 'elbow') {
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const p1 = pathPoints[i];
      const p2 = pathPoints[i + 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      if (Math.hypot(dx, dy) < 28) continue;
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      if (Math.hypot(mx - edgeCenterX, my - edgeCenterY) < 10) continue;
      segmentHandles.push({ x: mx, y: my, orientation: Math.abs(dx) > Math.abs(dy) ? 'h' : 'v' });
    }
  }

  pathPointsRef.current = pathPoints;
  dragRef.current = { kind: connectorType, source: { x: sx, y: sy }, target: { x: tx, y: ty } };

  const labelT = data?.labelT ?? 0.5;
  const labelPos = interpolatePolyline(pathPoints, labelT);

  return (
    <>
      <BaseEdge
        id={id}
        path={svgPathString}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={40}
        style={{
          stroke: selected ? 'var(--color-accent-500)' : stroke,
          strokeWidth,
          strokeDasharray: DASH_ARRAYS[strokeStyle],
        }}
      />

      {selected && isFloatingArrow && (
        <path
          d={svgPathString}
          fill="none"
          stroke="transparent"
          strokeWidth={40}
          style={{ cursor: 'grab', pointerEvents: 'stroke' }}
          onPointerDown={onEdgeDragDown}
        />
      )}

      {selected && (
        <EdgeLabelRenderer>
          <div
            style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${sx}px, ${sy}px)` }}
            className="connector-joint-hit nodrag nopan"
            onPointerDown={onEndpointPointerDown('source')}
          >
            <div className="connector-joint connector-joint--endpoint" />
          </div>
          <div
            style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px)` }}
            className="connector-joint-hit nodrag nopan"
            onPointerDown={onEndpointPointerDown('target')}
          >
            <div className="connector-joint connector-joint--endpoint" />
          </div>
          {segmentHandles.map((h, i) => (
            <div
              key={i}
              style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${h.x}px, ${h.y}px)` }}
              className={`connector-joint-hit nodrag nopan connector-joint-hit--${h.orientation}`}
              onPointerDown={onWaypointPointerDown}
            >
              <div className={`connector-joint connector-joint--segment connector-joint--segment-${h.orientation}`} />
            </div>
          ))}

          {/* Bend-point handle at geometric center — hidden for floating arrows (they use whole-edge drag instead) */}
          {!isFloatingArrow && (
            <div
              style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${edgeCenterX}px, ${edgeCenterY}px)` }}
              className="connector-joint-hit nodrag nopan"
              title={waypoint ? 'Double-click to reset the route' : undefined}
              onPointerDown={onWaypointPointerDown}
              // Undoes a dragged bend. The handle sits where a double-click
              // would otherwise start editing the label (or drop a text shape
              // on the pane), so the event stops here either way.
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (waypoint) updateEdgeData(id, { waypoint: null });
              }}
            >
              <div className="connector-joint connector-joint--bend" />
            </div>
          )}

        </EdgeLabelRenderer>
      )}

      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelPos.x}px, ${labelPos.y}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          {(editing || data?.label) && (
            <div
              ref={labelRef}
              contentEditable={editing}
              suppressContentEditableWarning
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              onPointerDown={selected && !editing ? onLabelPointerDown : undefined}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingEdgeId(id);
                requestAnimationFrame(() => labelRef.current?.focus());
              }}
              data-placeholder="Add label"
              className={`rounded-md border bg-canvas px-1.5 py-0.5 font-medium text-ink-700 outline-none whitespace-pre-wrap ${
                editing
                  ? 'border-accent-500'
                  : selected
                    ? 'border-accent-400/50'
                    : 'border-transparent'
              }`}
              style={{
                backgroundColor: 'var(--color-canvas)',
                fontSize: FONT_SIZE_PX[data?.labelFontSize ?? 'medium'],
                fontWeight: data?.labelBold ? 700 : 500,
                fontStyle: data?.labelItalic ? 'italic' : 'normal',
                cursor: selected && !editing ? 'grab' : undefined,
              }}
            >
              {data?.label}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>

      {/* With no label there is no element to click, so a selected connector
          offers a small target that opens the label editor. Selecting the edge
          mounts the joint handles into this same portal afterwards, so the
          target carries its own z-index to stay above the mid-path handle. */}
      {selected && !editing && !data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelPos.x}px, ${labelPos.y}px)`,
              pointerEvents: 'all',
              zIndex: 1,
            }}
            className="nodrag nopan"
          >
            <button
              type="button"
              title="Add label"
              className="connector-label-target"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setEditingEdgeId(id);
              }}
            />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
