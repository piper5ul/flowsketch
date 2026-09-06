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
import {
  buildConnectorPath,
  interpolatePolyline,
  type PathSegment,
  type Point,
} from '../lib/connectorPath';
import { manhattanRoute } from '../lib/manhattanRouter';
import { CONNECTOR_STROKE_PX, DEFAULT_EDGE_STROKE, DEFAULT_STROKE_WIDTH } from '../lib/defaults';
import { isAnchorNode } from '../lib/nodeKinds';
import type { ConnectorEdge as ConnectorEdgeType, ShapeNode } from '../store/useDiagramStore';
import { useDiagramStore, consumeSuppressBlur } from '../store/useDiagramStore';
import type { FontSize } from '../types';

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
// Polyline helpers for label positioning (`interpolatePolyline`, the other half
// of this pair, lives next to the geometry it measures).
// ---------------------------------------------------------------------------

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

/**
 * The point on `points` nearest to `p` — how a bend the router only passed
 * close to (it turns at right angles, so it rarely lands on one exactly) is
 * drawn on the line the user can see rather than beside it.
 */
function snapToPolyline(points: Point[], p: Point): Point {
  return interpolatePolyline(points, nearestTOnPolyline(points, p.x, p.y));
}

function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return total;
}

/** How close a handle may sit to the label before it is slid clear of it. */
const LABEL_CLEARANCE_PX = 16;

/**
 * The shortest run that gets a handle of its own. Anything shorter is mostly
 * covered by the joints at either end of it.
 */
const MIN_SEGMENT_PX = 28;

/**
 * A run's handle, moved out from under the label.
 *
 * The label (or, on a connector that has none, the button that adds one) sits
 * on the path and takes its own pointer events, so a handle underneath it
 * cannot be grabbed — and the run in the middle of a connector is exactly the
 * one a user reaches for first. A colliding handle slides along the path,
 * which keeps it on a curve rather than on the chord, and never past a third
 * of its own run.
 */
function clearOfLabel(segment: PathSegment, points: Point[], label: Point): Point {
  const { handle } = segment;
  if (Math.hypot(handle.x - label.x, handle.y - label.y) >= LABEL_CLEARANCE_PX) return handle;
  const total = polylineLength(points);
  if (total < 1) return handle;
  const shift = Math.min(LABEL_CLEARANCE_PX + 8, segment.length / 3) / total;
  const t = nearestTOnPolyline(points, handle.x, handle.y);
  // Towards the source, unless that is the end the handle is already near.
  return interpolatePolyline(points, t > shift ? t - shift : t + shift);
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
  const setEdgeWaypointTransient = useDiagramStore((s) => s.setEdgeWaypointTransient);
  const insertEdgeWaypoint = useDiagramStore((s) => s.insertEdgeWaypoint);
  const removeEdgeWaypoint = useDiagramStore((s) => s.removeEdgeWaypoint);
  const editingEdgeId = useDiagramStore((s) => s.editingEdgeId);
  const setEditingEdgeId = useDiagramStore((s) => s.setEditingEdgeId);
  const { screenToFlowPosition } = useReactFlow();
  const editing = editingEdgeId === id;
  const labelRef = useRef<HTMLDivElement>(null);
  const pathPointsRef = useRef<Point[]>([]);

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

  /** Follows the pointer for as long as a drag lasts, then tidies up after it. */
  const trackPointer = useCallback((onMove: (flow: Point) => void) => {
    const move = (ev: PointerEvent) => onMove(screenToFlowPosition({ x: ev.clientX, y: ev.clientY }));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [screenToFlowPosition]);

  /** Drags the bend at `index`; the pointer is where the bend goes. */
  const onBendPointerDown = useCallback(
    (index: number) => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const begin = historyOnce();
      trackPointer((flow) => {
        begin();
        setEdgeWaypointTransient(id, index, { x: flow.x, y: flow.y });
      });
    },
    [id, trackPointer, setEdgeWaypointTransient],
  );

  /**
   * Drags one run of the path. The first move drops a new bend where the handle
   * was — the one history entry the whole drag is worth — and carries on as
   * that bend's own drag, so a run is grabbed and pulled in a single gesture.
   *
   * An elbow only turns at right angles, so a run of one slides across itself
   * rather than following the pointer: a horizontal run moves up and down, a
   * vertical one side to side. That is what makes an elbow's segments slide.
   */
  const onSegmentPointerDown = useCallback(
    (index: number, segment: PathSegment, handle: Point, orthogonal: boolean) => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      let inserted = false;
      trackPointer((flow) => {
        const point = !orthogonal
          ? { x: flow.x, y: flow.y }
          : segment.orientation === 'h'
            ? { x: handle.x, y: flow.y }
            : { x: flow.x, y: handle.y };
        if (inserted) {
          setEdgeWaypointTransient(id, index, point);
        } else {
          inserted = true;
          insertEdgeWaypoint(id, index, point);
        }
      });
    },
    [id, trackPointer, insertEdgeWaypoint, setEdgeWaypointTransient],
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
  const waypoints = data?.waypoints ?? [];
  // Selection thickens the line by a hair on top of whatever width it is set to.
  const strokeWidth = CONNECTOR_STROKE_PX[data?.strokeWidth ?? DEFAULT_STROKE_WIDTH] + (selected ? 0.5 : 0);

  // Only an elbow is routed around the other shapes; the other two kinds run
  // straight from anchor to anchor and need nothing from the router.
  let routed: Point[] | undefined;
  if (connectorType === 'elbow') {
    const isVertical = (sourceAnchor.side === 'top' || sourceAnchor.side === 'bottom') &&
      (targetAnchor.side === 'top' || targetAnchor.side === 'bottom');
    const isHorizontal = (sourceAnchor.side === 'left' || sourceAnchor.side === 'right') &&
      (targetAnchor.side === 'left' || targetAnchor.side === 'right');
    const isCollinear = (isVertical && Math.abs(sx - tx) < 2) || (isHorizontal && Math.abs(sy - ty) < 2);

    routed = isCollinear && waypoints.length === 0
      ? []
      : manhattanRoute({
          sourceX: sx,
          sourceY: sy,
          targetX: tx,
          targetY: ty,
          sourceRect: rectOfNode(sourceNode),
          targetRect: rectOfNode(targetNode),
          obstacles: nodes.filter((n) => n.id !== source && n.id !== target).map(rectOfNode),
          vertices: waypoints,
          startDirections: [sourceAnchor.side],
          endDirections: [targetAnchor.side],
        }).points;
  }

  const { d: svgPathString, points: pathPoints, segments } = buildConnectorPath(connectorType, {
    source: { x: sx, y: sy },
    target: { x: tx, y: ty },
    sourceSide: sourceAnchor.side,
    targetSide: targetAnchor.side,
    waypoints,
    routed,
  });

  pathPointsRef.current = pathPoints;

  const labelT = data?.labelT ?? 0.5;
  const labelPos = interpolatePolyline(pathPoints, labelT);

  /**
   * Where a bend dragged out of the path at `at` belongs in the list: after
   * every bend the path already passes on its way there. On a straight or
   * curved connector that is simply the run's own index; on an elbow, whose
   * corners are the router's rather than the user's, counting along the path is
   * what keeps the list in the order the connector is drawn in.
   */
  const insertIndexAt = (at: Point) => {
    const t = nearestTOnPolyline(pathPoints, at.x, at.y);
    return waypoints.filter((w) => nearestTOnPolyline(pathPoints, w.x, w.y) < t).length;
  };

  // One grab handle per run of the path, in the middle of it. A run too short
  // to hold a handle without covering the joints at either end of it goes
  // without one.
  const segmentHandles = segments
    .map((segment, index) => {
      const at = clearOfLabel(segment, pathPoints, labelPos);
      return { segment, index, at, insertAt: insertIndexAt(at) };
    })
    .filter(({ segment }) => segment.length >= MIN_SEGMENT_PX);

  // A joint on every bend the connector has collected, drawn on the line even
  // when the router could only route near it.
  const bendJoints = waypoints.map((waypoint, index) => ({
    index,
    at: snapToPolyline(pathPoints, waypoint),
  }));

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
          {segmentHandles.map(({ segment, index, at, insertAt }) => (
            <div
              key={`segment-${index}`}
              style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
              className={`connector-joint-hit nodrag nopan connector-joint-hit--${segment.orientation}`}
              title="Drag to bend"
              onPointerDown={onSegmentPointerDown(insertAt, segment, at, connectorType === 'elbow')}
            >
              <div className={`connector-joint connector-joint--segment connector-joint--segment-${segment.orientation}`} />
            </div>
          ))}

          {bendJoints.map(({ index, at }) => (
            <div
              key={`bend-${index}`}
              style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}
              className="connector-joint-hit nodrag nopan"
              title="Double-click to remove this bend"
              onPointerDown={onBendPointerDown(index)}
              // Drops the bend. The joint sits where a double-click would
              // otherwise start editing the label (or drop a text shape on the
              // pane), so the event stops here either way.
              onDoubleClick={(e) => {
                e.stopPropagation();
                removeEdgeWaypoint(id, index);
              }}
            >
              <div className="connector-joint connector-joint--bend" />
            </div>
          ))}

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
