import { describe, expect, it } from 'vitest';
import { orthoRoute, ROUTE_MARGIN, type OrthoRouteInput, type RoutePoint, type RouteRect } from './orthoRouter';
import type { Direction } from '../types';

const A: RouteRect = { x: 100, y: 100, width: 200, height: 100 };
/** A free end: the 1×1 anchor centred on a point. */
const free = (x: number, y: number): RouteRect => ({ x: x - 0.5, y: y - 0.5, width: 1, height: 1 });

const STEP: Record<Direction, RoutePoint> = { right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, top: { x: 0, y: -1 } };

/** The whole polyline, ends included, as `buildConnectorPath` draws it. */
function path(input: OrthoRouteInput): RoutePoint[] {
  return [input.source, ...orthoRoute(input), input.target];
}

function direction(a: RoutePoint, b: RoutePoint): RoutePoint {
  return { x: Math.sign(Math.round(b.x - a.x)), y: Math.sign(Math.round(b.y - a.y)) };
}

function inside(p: RoutePoint, r: RouteRect) {
  return p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;
}

/** Every run crosses no part of `r` — sampled every px, which is plenty at these sizes. */
function clearOf(points: RoutePoint[], r: RouteRect) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const n = Math.max(1, Math.round(Math.abs(b.x - a.x) + Math.abs(b.y - a.y)));
    for (let k = 0; k <= n; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
      if (inside(p, r)) return false;
    }
  }
  return true;
}

/** The properties every route must have, whatever it looks like. */
function expectWellFormed(input: OrthoRouteInput) {
  const points = path(input);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01, `run ${i} is diagonal`).toBe(true);
  }
  // Leaves straight out of its side, arrives straight into the target's.
  expect(direction(points[0], points[1])).toEqual(STEP[input.sourceSide]);
  const out = STEP[input.targetSide];
  expect(direction(points[points.length - 2], points[points.length - 1])).toEqual({ x: -out.x || 0, y: -out.y || 0 });
  expect(clearOf(points, input.sourceRect)).toBe(true);
  return points;
}

const bends = (points: RoutePoint[]) => points.length - 2;

describe('orthoRoute', () => {
  it('reaches a free end below and to the side with a Z split halfway down — the case the old router lost', () => {
    const input: OrthoRouteInput = {
      source: { x: 200, y: 212 }, sourceSide: 'bottom', sourceRect: A,
      target: { x: 700, y: 428 }, targetSide: 'top', targetRect: free(700, 438),
      obstacles: [{ x: 600, y: 100, width: 200, height: 100 }],
    };
    const points = expectWellFormed(input);
    expect(bends(points)).toBe(2);
    // Halfway across the gap between the shape (bottom 200) and the end (437.5).
    expect(points[1].y).toBeCloseTo((200 + 437.5) / 2, 1);
  });

  it('turns back up to a free end above, having first left the shape downwards', () => {
    const input: OrthoRouteInput = {
      source: { x: 200, y: 212 }, sourceSide: 'bottom', sourceRect: A,
      target: { x: 700, y: 60 }, targetSide: 'bottom', targetRect: free(700, 50), obstacles: [],
    };
    const points = expectWellFormed(input);
    expect(points[1]).toEqual({ x: 200, y: 200 + ROUTE_MARGIN });
  });

  it('draws an L when the two sides meet at a right angle', () => {
    const points = expectWellFormed({
      source: { x: 312, y: 150 }, sourceSide: 'right', sourceRect: A,
      target: { x: 700, y: 388 }, targetSide: 'top', targetRect: { x: 600, y: 400, width: 200, height: 100 }, obstacles: [],
    });
    expect(points).toEqual([{ x: 312, y: 150 }, { x: 700, y: 150 }, { x: 700, y: 388 }]);
  });

  it('splits a Z in the middle of the gap between two facing sides', () => {
    const points = expectWellFormed({
      source: { x: 312, y: 150 }, sourceSide: 'right', sourceRect: A,
      target: { x: 588, y: 350 }, targetSide: 'left', targetRect: { x: 600, y: 300, width: 200, height: 100 }, obstacles: [],
    });
    expect(bends(points)).toBe(2);
    expect(points[1].x).toBeCloseTo(450, 0);
  });

  it('is a straight line when two facing sides line up', () => {
    expect(orthoRoute({
      source: { x: 200, y: 212 }, sourceSide: 'bottom', sourceRect: A,
      target: { x: 200, y: 388 }, targetSide: 'top', targetRect: { x: 100, y: 400, width: 200, height: 100 }, obstacles: [],
    })).toEqual([]);
  });

  it('walks round a shape in the way, clear of it', () => {
    const obstacle = { x: 120, y: 330, width: 160, height: 100 };
    const input: OrthoRouteInput = {
      source: { x: 200, y: 212 }, sourceSide: 'bottom', sourceRect: A,
      target: { x: 200, y: 588 }, targetSide: 'top', targetRect: { x: 100, y: 600, width: 200, height: 100 },
      obstacles: [obstacle],
    };
    const points = expectWellFormed(input);
    expect(clearOf(points, obstacle)).toBe(true);
    expect(clearOf(points, input.targetRect)).toBe(true);
  });

  it('goes out and round when the target is behind the side the line leaves by', () => {
    const input: OrthoRouteInput = {
      source: { x: 312, y: 150 }, sourceSide: 'right', sourceRect: A,
      target: { x: 38, y: 450 }, targetSide: 'left', targetRect: { x: 50, y: 400, width: 200, height: 100 }, obstacles: [],
    };
    const points = expectWellFormed(input);
    expect(clearOf(points, input.targetRect)).toBe(true);
  });

  it('still arrives when every way round is blocked', () => {
    const wall = { x: -1000, y: 260, width: 3000, height: 40 };
    const input: OrthoRouteInput = {
      source: { x: 200, y: 212 }, sourceSide: 'bottom', sourceRect: A,
      target: { x: 200, y: 588 }, targetSide: 'top', targetRect: { x: 100, y: 600, width: 200, height: 100 },
      obstacles: [wall, { x: -1000, y: -1000, width: 40, height: 3000 }],
    };
    const points = path(input);
    expect(points[points.length - 1]).toEqual(input.target);
  });

  it('passes through every bend the user dragged, in order', () => {
    const vertices = [{ x: 400, y: 400 }, { x: 600, y: 300 }];
    const points = expectWellFormed({
      source: { x: 312, y: 150 }, sourceSide: 'right', sourceRect: A,
      target: { x: 788, y: 450 }, targetSide: 'left', targetRect: { x: 800, y: 400, width: 200, height: 100 }, obstacles: [],
      vertices,
    });
    for (const v of vertices) {
      expect(points.some((q, i) => i < points.length - 1 && onRun(v, q, points[i + 1]))).toBe(true);
    }
  });
});

function onRun(p: RoutePoint, a: RoutePoint, b: RoutePoint) {
  const within = (v: number, x: number, y: number) => v >= Math.min(x, y) - 0.01 && v <= Math.max(x, y) + 0.01;
  return within(p.x, a.x, b.x) && within(p.y, a.y, b.y) && (Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01);
}

describe('orthoRoute obstacles', () => {
  const S: RouteRect = { x: 0, y: 0, width: 80, height: 80 };
  const T: RouteRect = { x: 1000, y: 0, width: 80, height: 80 };
  const ends = {
    source: { x: 80, y: 40 }, sourceSide: 'right' as const, sourceRect: S,
    target: { x: 1000, y: 40 }, targetSide: 'left' as const, targetRect: T,
  };

  it('keeps clear of a shape whose clearance, not its box, reaches the route', () => {
    // Two walls force a detour below them; the third shape sits just under
    // where that detour would run, near enough that its margin is in the way.
    const low = { x: 500, y: 200, width: 100, height: 50 };
    const points = path({
      ...ends,
      obstacles: [{ x: 300, y: -200, width: 100, height: 400 }, { x: 800, y: -200, width: 100, height: 400 }, low],
    });
    expect(clearOf(points, low)).toBe(true);
  });

  it('finds the way round a wall taller than the region it first looks in', () => {
    const wall = { x: 450, y: -2000, width: 100, height: 4000 };
    const points = path({ ...ends, obstacles: [wall] });
    expect(clearOf(points, wall)).toBe(true);
  });
});
