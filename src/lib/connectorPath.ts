/**
 * The geometry of a connector: one function that turns two anchor points (plus
 * whatever the router or the user contributed in between) into the `d` of the
 * rendered path, the point its bend handle sits on, and a polyline following it
 * for placing the label.
 *
 * Kept out of `ConnectorEdge` so the three shapes a connector can take are
 * testable without React Flow, a DOM, or a store.
 */
import { getBezierPath, getStraightPath, Position } from '@xyflow/react';
import type { ConnectorKind, Direction } from '../types';

export interface Point {
  x: number;
  y: number;
}

export interface ConnectorPathArgs {
  source: Point;
  target: Point;
  /** The side of each shape the connector leaves from — a curve's tangent. */
  sourceSide: Direction;
  targetSide: Direction;
  /** The one user-dragged bend, when the connector has one. */
  waypoint?: Point | null;
  /** Elbow only: the corners the router put between the two ends. */
  routed?: Point[];
}

export interface ConnectorPath {
  /** The `d` attribute of the rendered path. */
  d: string;
  /** Where the bend handle sits; the origin of the label's 0–1 offset. */
  center: Point;
  /** A polyline following the path, for interpolating the label along it. */
  points: Point[];
}

const POSITION: Record<Direction, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/** Radius of an elbow's rounded corners. */
const BORDER_RADIUS = 10;

/** How many segments a curve is flattened into for label interpolation. */
const CURVE_SAMPLES = 24;

/** An elbow polyline, with each corner replaced by a quadratic fillet. */
export function smoothStepPath(points: Point[]): string {
  if (points.length < 2) return '';
  const parts: string[] = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const d1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const d2 = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.min(BORDER_RADIUS, d1 / 2, d2 / 2);
    const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
    const len1 = Math.hypot(dx1, dy1) || 1;
    const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
    const len2 = Math.hypot(dx2, dy2) || 1;
    const ax = curr.x - (dx1 / len1) * r;
    const ay = curr.y - (dy1 / len1) * r;
    const bx = curr.x + (dx2 / len2) * r;
    const by = curr.y + (dy2 / len2) * r;
    parts.push(`L ${ax} ${ay}`);
    parts.push(`Q ${curr.x} ${curr.y} ${bx} ${by}`);
  }
  const last = points[points.length - 1];
  parts.push(`L ${last.x} ${last.y}`);
  return parts.join(' ');
}

/**
 * Absorbs the kinks grid snapping leaves in a routed path: a segment shorter
 * than 8px is straightened onto its neighbour, and the corner that leaves
 * behind is dropped. The two endpoints are never moved.
 *
 * Straightening rewrites points, so the input is copied first — the router's
 * output and the edge's own anchors are passed in by reference.
 */
export function cleanPath(input: Point[]): Point[] {
  if (input.length <= 2) return input;

  const pts = input.map((p) => ({ x: p.x, y: p.y }));
  const first = pts[0];
  const last = pts[pts.length - 1];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (Math.abs(a.x - b.x) > 0 && Math.abs(a.x - b.x) < 8) b.x = a.x;
    if (Math.abs(a.y - b.y) > 0 && Math.abs(a.y - b.y) < 8) b.y = a.y;
  }

  const result = [first];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const sameX = Math.abs(prev.x - curr.x) < 1 && Math.abs(curr.x - next.x) < 1;
    const sameY = Math.abs(prev.y - curr.y) < 1 && Math.abs(curr.y - next.y) < 1;
    if (!sameX && !sameY) result.push(curr);
  }
  result.push(last);
  return result;
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The point at `t` on the quadratic through `a` and `b` with control `c`. */
function quadraticAt(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

/** Flattens a quadratic into a polyline the label can be interpolated along. */
function sampleQuadratic(a: Point, c: Point, b: Point): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    points.push(quadraticAt(a, c, b, i / CURVE_SAMPLES));
  }
  return points;
}

/**
 * The quadratic control point that puts `mid` at the halfway mark of the curve
 * from `a` to `b`. Used to approximate React Flow's cubic with a quadratic:
 * both run between the same two anchors and through the same midpoint, which is
 * close enough to carry a label along the visible curve.
 *
 * Also what the bend drag commits: a curve's control point is not on the curve,
 * so storing the pointer as the waypoint would move the curve half as far as
 * the pointer went.
 */
export function controlThrough(a: Point, mid: Point, b: Point): Point {
  return { x: 2 * mid.x - (a.x + b.x) / 2, y: 2 * mid.y - (a.y + b.y) / 2 };
}

export function buildConnectorPath(kind: ConnectorKind, args: ConnectorPathArgs): ConnectorPath {
  const { source, target, sourceSide, targetSide, waypoint, routed } = args;

  if (kind === 'elbow') {
    const points = cleanPath([source, ...(routed ?? []), target]);
    return {
      d: smoothStepPath(points),
      // The router emits corners, not midpoints, so the handle goes on the
      // middle vertex rather than at half the path's length — except on a
      // corner-free run, where that vertex *is* the target and the bend handle
      // would sit under the endpoint handle.
      center: points.length === 2 ? midpoint(points[0], points[1]) : points[Math.floor(points.length / 2)],
      points,
    };
  }

  if (kind === 'curved') {
    // A dragged bend becomes the curve's control point; without one the curve
    // is React Flow's cubic, which leaves each shape square to its own side.
    if (waypoint) {
      return {
        d: `M ${source.x} ${source.y} Q ${waypoint.x} ${waypoint.y} ${target.x} ${target.y}`,
        center: quadraticAt(source, waypoint, target, 0.5),
        points: sampleQuadratic(source, waypoint, target),
      };
    }
    const [d, labelX, labelY] = getBezierPath({
      sourceX: source.x,
      sourceY: source.y,
      sourcePosition: POSITION[sourceSide],
      targetX: target.x,
      targetY: target.y,
      targetPosition: POSITION[targetSide],
    });
    const center = { x: labelX, y: labelY };
    return { d, center, points: sampleQuadratic(source, controlThrough(source, center, target), target) };
  }

  if (waypoint) {
    return {
      d: `M ${source.x} ${source.y} L ${waypoint.x} ${waypoint.y} L ${target.x} ${target.y}`,
      center: waypoint,
      points: [source, waypoint, target],
    };
  }

  const [d, labelX, labelY] = getStraightPath({
    sourceX: source.x,
    sourceY: source.y,
    targetX: target.x,
    targetY: target.y,
  });
  return { d, center: { x: labelX, y: labelY }, points: [source, target] };
}
