/**
 * The geometry of a connector: one function that turns two anchor points (plus
 * whatever the router or the user contributed in between) into the `d` of the
 * rendered path, the runs its grab handles hang off, and a polyline following
 * it for placing the label.
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
  /** The user-dragged bends, in order from the source end to the target end. */
  waypoints?: Point[];
  /** Elbow only: the corners the router put between the two ends. */
  routed?: Point[];
}

/**
 * One run of the path, and the grab handle in the middle of it. Their order is
 * the path's own, so a run's index is the index a bend dragged out of it takes
 * in `waypoints`.
 */
export interface PathSegment {
  /** Where the handle sits: the middle of the run, on the drawn path. */
  handle: Point;
  /** Which way the run goes — an elbow's drag is constrained across it. */
  orientation: 'h' | 'v';
  /** The run's straight-line length, in px. */
  length: number;
}

export interface ConnectorPath {
  /** The `d` attribute of the rendered path. */
  d: string;
  /** A polyline following the path, for interpolating the label along it. */
  points: Point[];
  /** The runs between consecutive bends, each with the handle that grabs it. */
  segments: PathSegment[];
}

/** A cubic Bézier, as the four points that draw it. */
export interface CubicSegment {
  from: Point;
  c1: Point;
  c2: Point;
  to: Point;
}

const POSITION: Record<Direction, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/**
 * Radius of an elbow's rounded corners — measured off Whimsical's 4px
 * connector at 100%, where the centreline turns on roughly a 12px circle. It
 * is still clamped to half of the shorter neighbouring run, so a short jog
 * never folds over itself.
 */
const BORDER_RADIUS = 12;

/** How many segments a curve is flattened into for label interpolation. */
const CURVE_SAMPLES = 24;

/** The same, per run of a spline — one flattening for each bend it passes. */
const SPLINE_SAMPLES = 12;

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

/** The point at `t` on a cubic. */
function cubicAt(s: CubicSegment, t: number): Point {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return {
    x: a * s.from.x + b * s.c1.x + c * s.c2.x + d * s.to.x,
    y: a * s.from.y + b * s.c1.y + c * s.c2.y + d * s.to.y,
  };
}

/**
 * The quadratic control point that puts `mid` at the halfway mark of the curve
 * from `a` to `b`. Used to approximate React Flow's cubic with a quadratic:
 * both run between the same two anchors and through the same midpoint, which is
 * close enough to carry a label along the visible curve.
 */
export function controlThrough(a: Point, mid: Point, b: Point): Point {
  return { x: 2 * mid.x - (a.x + b.x) / 2, y: 2 * mid.y - (a.y + b.y) / 2 };
}

/**
 * A Catmull-Rom spline through every one of `points`, as the cubic Béziers that
 * draw it — one per run, in order.
 *
 * Catmull-Rom is the interpolating spline: unlike a plain Bézier through
 * control points, the curve *passes through* each point it is given, which is
 * what makes a dragged bend land under the pointer. Each run's control points
 * are its neighbours' tangent, a sixth of the way along, so the curve leaves
 * every bend heading for the next one. The two ends have no neighbour beyond
 * them and stand in for their own, which straightens the first and last run
 * rather than letting it overshoot.
 */
export function catmullRomToBezier(points: Point[]): CubicSegment[] {
  if (points.length < 2) return [];

  const segments: CubicSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const prev = points[i - 1] ?? points[i];
    const from = points[i];
    const to = points[i + 1];
    const next = points[i + 2] ?? points[i + 1];
    segments.push({
      from,
      c1: { x: from.x + (to.x - prev.x) / 6, y: from.y + (to.y - prev.y) / 6 },
      c2: { x: to.x - (next.x - from.x) / 6, y: to.y - (next.y - from.y) / 6 },
      to,
    });
  }
  return segments;
}

/** The `d` of a chain of cubics. */
function cubicPath(segments: CubicSegment[]): string {
  const first = segments[0];
  const parts = [`M ${first.from.x} ${first.from.y}`];
  for (const s of segments) {
    parts.push(`C ${s.c1.x} ${s.c1.y}, ${s.c2.x} ${s.c2.y}, ${s.to.x} ${s.to.y}`);
  }
  return parts.join(' ');
}

/** Flattens a chain of cubics into one polyline, without repeating the joins. */
function sampleCubics(segments: CubicSegment[]): Point[] {
  const points: Point[] = [segments[0].from];
  for (const s of segments) {
    for (let i = 1; i <= SPLINE_SAMPLES; i++) {
      points.push(cubicAt(s, i / SPLINE_SAMPLES));
    }
  }
  return points;
}

/** The `d` of a polyline: one `L` per point after the first. */
function polylinePath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

/**
 * The point at `t` (0–1) along a polyline, measured by length. What carries a
 * connector's label along whatever shape the connector took.
 */
export function interpolatePolyline(pts: Point[], t: number): Point {
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

/** One run per pair of consecutive points, each grabbed at its midpoint. */
function segmentsOf(points: Point[]): PathSegment[] {
  const segments: PathSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push(runBetween(points[i], points[i + 1], midpoint(points[i], points[i + 1])));
  }
  return segments;
}

/** A run from `a` to `b`, grabbed at `handle` (which need not be on the chord). */
function runBetween(a: Point, b: Point, handle: Point): PathSegment {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { handle, orientation: Math.abs(dx) > Math.abs(dy) ? 'h' : 'v', length: Math.hypot(dx, dy) };
}

export function buildConnectorPath(kind: ConnectorKind, args: ConnectorPathArgs): ConnectorPath {
  const { source, target, sourceSide, targetSide, routed } = args;
  const waypoints = args.waypoints ?? [];

  if (kind === 'elbow') {
    // The router already threaded the bends: it was handed them as vertices,
    // and `routed` is the orthogonal run of corners that came back.
    const points = cleanPath([source, ...(routed ?? []), target]);
    return { d: smoothStepPath(points), points, segments: segmentsOf(points) };
  }

  if (kind === 'curved') {
    // A bent curve is a spline through every bend; an unbent one is React
    // Flow's cubic, which leaves each shape square to its own side.
    if (waypoints.length > 0) {
      const through = [source, ...waypoints, target];
      const cubics = catmullRomToBezier(through);
      const points = sampleCubics(cubics);
      return {
        d: cubicPath(cubics),
        points,
        // A run of a spline bulges off its chord, so its handle is taken from
        // the curve itself rather than from the two bends it joins.
        segments: cubics.map((c) => runBetween(c.from, c.to, cubicAt(c, 0.5))),
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
    // The curve's own midpoint: where its one handle sits, and the point the
    // quadratic that stands in for it while sampling is drawn through.
    const mid = { x: labelX, y: labelY };
    return {
      d,
      points: sampleQuadratic(source, controlThrough(source, mid, target), target),
      segments: [runBetween(source, target, mid)],
    };
  }

  if (waypoints.length > 0) {
    const points = [source, ...waypoints, target];
    return { d: polylinePath(points), points, segments: segmentsOf(points) };
  }

  const [d, labelX, labelY] = getStraightPath({
    sourceX: source.x,
    sourceY: source.y,
    targetX: target.x,
    targetY: target.y,
  });
  const mid = { x: labelX, y: labelY };
  return { d, points: [source, target], segments: [runBetween(source, target, mid)] };
}
