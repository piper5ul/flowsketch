/**
 * Where a connector is drawn, worked out from the board — the half of
 * `ConnectorEdge` that reads other nodes.
 *
 * It is kept out of the component for one reason: every connector used to
 * subscribe to the whole node array and re-route itself on every frame of any
 * drag anywhere on the board. Here the answer is a flat bag of numbers and
 * stable references, so the component can select it with a shallow equality
 * and re-render only when *its* line moves; and the board-wide work (a lookup
 * by id, every node's box in board coordinates, the obstacle list) is done
 * once per node array (`boardGeometry`) instead of once per connector.
 */
import {
  anchorToPoint,
  floatingEdgeSides,
  standoff,
  type EdgeAnchor,
  type Rect,
} from './edgeGeometry';
import { freeEndSide, lookupOf } from './connectorGesture';
import { CONNECTOR_STANDOFF_PX, DEFAULT_END_ARROW, DEFAULT_START_ARROW } from './defaults';
import { markerDepthPx } from './edgeMarkers';
import { isAnchorNode, isGroupNode } from './nodeKinds';
import { absolutePosition } from './nodeTree';
import { orthoRouteMemo, type RouteMemo, type RoutePoint } from './orthoRouter';
import type { ConnectorData, Direction, ShapeData } from '../types';

/** What this module needs to know about a node. */
export interface GeometryNode {
  id: string;
  type?: string;
  parentId?: string;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  measured?: { width?: number; height?: number };
  hidden?: boolean;
  data: Pick<ShapeData, 'shape' | 'fill' | 'stroke'>;
}

export interface BoardGeometry<N extends GeometryNode> {
  byId: ReadonlyMap<string, N>;
  /** A node's box in board coordinates (zero-sized while it has no size). */
  rectOf(node: N): Rect;
  /**
   * Every node a connector is routed round, in array order: a group is an
   * invisible handle on its members (they are the obstacles), a floating
   * arrow's anchor is not a shape, and a hidden node is not on the board.
   */
  obstacles: readonly { id: string; rect: Rect }[];
}

const boards = new WeakMap<readonly GeometryNode[], BoardGeometry<GeometryNode>>();

/**
 * The board-wide half, computed once per node array. The store replaces the
 * array on every change to any node, so the array itself is the version.
 */
export function boardGeometry<N extends GeometryNode>(nodes: readonly N[]): BoardGeometry<N> {
  const cached = boards.get(nodes);
  if (cached) return cached as unknown as BoardGeometry<N>;
  const byId = lookupOf(nodes);
  const rects = new Map<N, Rect>();
  const rectOf = (n: N): Rect => {
    let rect = rects.get(n);
    if (!rect) {
      const { x, y } = absolutePosition(n, byId);
      rect = { x, y, width: n.width ?? n.measured?.width ?? 0, height: n.height ?? n.measured?.height ?? 0 };
      rects.set(n, rect);
    }
    return rect;
  };
  const obstacles = nodes
    .filter((n) => !n.hidden && !isAnchorNode(n.data) && !isGroupNode(n))
    .map((n) => ({ id: n.id, rect: rectOf(n) }));
  const geometry: BoardGeometry<N> = { byId, rectOf, obstacles };
  boards.set(nodes, geometry as unknown as BoardGeometry<GeometryNode>);
  return geometry;
}

/** Everything `ConnectorEdge` draws with that depends on other nodes. */
export interface ConnectorGeometry<N extends GeometryNode> {
  sourceNode: N;
  targetNode: N;
  /** Where the line starts and ends, stood off the shapes. */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourceSide: Direction;
  targetSide: Direction;
  /** An elbow's corners — the same array while the route is unchanged. */
  routed: RoutePoint[] | undefined;
}

function centreOf(r: Rect) {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * A connector's geometry, or `null` while either end's node is missing (a
 * delete or an undo in flight). `memo` carries the router's memory between
 * calls for this one connector; pass the same object every time.
 */
export function connectorGeometry<N extends GeometryNode>(
  nodes: readonly N[],
  source: string,
  target: string,
  data: ConnectorData | undefined,
  memo: { current: RouteMemo | null },
): ConnectorGeometry<N> | null {
  const board = boardGeometry(nodes);
  const sourceNode = board.byId.get(source);
  const targetNode = board.byId.get(target);
  if (!sourceNode || !targetNode) return null;
  const sourceRect = board.rectOf(sourceNode);
  const targetRect = board.rectOf(targetNode);

  const floating = floatingEdgeSides(sourceRect, targetRect);
  let sourceAnchor: EdgeAnchor = data?.sourceAnchor ?? { side: floating.sourcePos, t: 0.5 };
  let targetAnchor: EdgeAnchor = data?.targetAnchor ?? { side: floating.targetPos, t: 0.5 };
  // A free end (one end on a shape, the other on an invisible anchor) is
  // approached along the axis the attached end leaves on — see `freeEndSide`.
  // It is decided here, per render, rather than stored: it changes as the end
  // is dragged round, and nothing else needs to know it.
  const sourceFree = isAnchorNode(sourceNode.data);
  const targetFree = isAnchorNode(targetNode.data);
  if (targetFree && !sourceFree) {
    const point = anchorToPoint(sourceAnchor, sourceRect);
    targetAnchor = { side: freeEndSide({ point, side: sourceAnchor.side }, centreOf(targetRect)), t: 0.5 };
  } else if (sourceFree && !targetFree) {
    const point = anchorToPoint(targetAnchor, targetRect);
    sourceAnchor = { side: freeEndSide({ point, side: targetAnchor.side }, centreOf(sourceRect)), t: 0.5 };
  }
  // The line stops a few px clear of each shape (see `CONNECTOR_STANDOFF_PX`)
  // — a floating arrow's ends are anchors with no shape to stand clear of —
  // and then a head's depth short of that, so the head's tip, not the line's
  // round-capped end, is what reaches the standoff (see `MARKER_GEOMETRY`).
  const s = standoff(
    anchorToPoint(sourceAnchor, sourceRect),
    sourceAnchor.side,
    (sourceFree ? 0 : CONNECTOR_STANDOFF_PX) + markerDepthPx(data?.startArrowStyle ?? DEFAULT_START_ARROW, data?.strokeWidth),
  );
  const t = standoff(
    anchorToPoint(targetAnchor, targetRect),
    targetAnchor.side,
    (targetFree ? 0 : CONNECTOR_STANDOFF_PX) + markerDepthPx(data?.endArrowStyle ?? DEFAULT_END_ARROW, data?.strokeWidth),
  );

  // Only an elbow is routed around the other shapes; the other two kinds run
  // straight from anchor to anchor and need nothing from the router. A frame
  // is drawn, so it is walked round like a shape (one that holds either end is
  // exempt — the router lets a route out of the box it starts in).
  let routed: RoutePoint[] | undefined;
  if ((data?.connectorType ?? 'elbow') === 'elbow') {
    const result = orthoRouteMemo(
      {
        source: s,
        sourceSide: sourceAnchor.side,
        sourceRect,
        target: t,
        targetSide: targetAnchor.side,
        targetRect,
        obstacles: board.obstacles.filter((o) => o.id !== source && o.id !== target).map((o) => o.rect),
        vertices: data?.waypoints ?? [],
      },
      memo.current,
    );
    memo.current = result.memo;
    routed = result.points;
  } else {
    memo.current = null;
  }

  return {
    sourceNode,
    targetNode,
    sx: s.x,
    sy: s.y,
    tx: t.x,
    ty: t.y,
    sourceSide: sourceAnchor.side,
    targetSide: targetAnchor.side,
    routed,
  };
}
