import { describe, expect, it } from 'vitest';
import { orthoRoute, orthoRouteMemo, ROUTE_MARGIN, type OrthoRouteInput, type RouteMemo, type RoutePoint, type RouteRect } from './orthoRouter';
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

describe('orthoRouteMemo', () => {
  /** A small deterministic PRNG, so a failure names a board that can be replayed. */
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const SIDES: Direction[] = ['top', 'right', 'bottom', 'left'];
  const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const anchorOn = (rect: RouteRect, side: Direction): RoutePoint => {
    switch (side) {
      case 'top': return { x: rect.x + rect.width / 2, y: rect.y - 6 };
      case 'bottom': return { x: rect.x + rect.width / 2, y: rect.y + rect.height + 6 };
      case 'left': return { x: rect.x - 6, y: rect.y + rect.height / 2 };
      case 'right': return { x: rect.x + rect.width + 6, y: rect.y + rect.height / 2 };
    }
  };

  it('answers exactly what orthoRoute answers, through any sequence of moves', () => {
    let reused = 0;
    let fallbacks = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = rng(seed);
      const box = (): RouteRect => ({
        x: Math.round(r() * 1400) - 200,
        y: Math.round(r() * 1000) - 200,
        width: 40 + Math.round(r() * 160),
        height: 30 + Math.round(r() * 120),
      });
      const sourceRect = { x: 100, y: 300, width: 120, height: 60 };
      let targetRect = { x: 700, y: 400, width: 120, height: 60 };
      // Some boards carry walls tall enough to push the route past the first
      // region, or to wall it in, so every fallback is exercised.
      const obstacles: RouteRect[] = Array.from({ length: 20 }, box);
      if (seed % 3 === 0) obstacles.push({ x: 420, y: -1500, width: 60, height: 3500 });
      if (seed % 5 === 0) obstacles.push({ x: 60, y: 200, width: 40, height: 400 }, { x: 240, y: 200, width: 40, height: 400 });
      const sourceSide = pick(r, SIDES);
      let targetSide = pick(r, SIDES);
      const vertices: RoutePoint[] = seed % 4 === 0 ? [{ x: 450, y: 150 + Math.round(r() * 400) }] : [];
      let memo: RouteMemo | null = null;
      let previous: RoutePoint[] | null = null;
      for (let step = 0; step < 25; step++) {
        const roll = r();
        if (roll < 0.6) {
          obstacles[Math.floor(r() * obstacles.length)] = box();
        } else if (roll < 0.75) {
          // A move that changes nothing at all.
        } else if (roll < 0.9) {
          targetRect = { ...targetRect, x: targetRect.x + Math.round(r() * 80 - 40), y: targetRect.y + Math.round(r() * 80 - 40) };
        } else {
          targetSide = pick(r, SIDES);
        }
        const input: OrthoRouteInput = {
          source: anchorOn(sourceRect, sourceSide),
          sourceSide,
          sourceRect,
          target: anchorOn(targetRect, targetSide),
          targetSide,
          targetRect,
          obstacles: [...obstacles],
          vertices,
        };
        const result = orthoRouteMemo(input, memo);
        expect(result.points, `seed ${seed}, step ${step}`).toEqual(orthoRoute(input));
        if (previous && result.points === previous) reused++;
        if (!result.memo.usedNear) fallbacks++;
        memo = result.memo;
        previous = result.points;
      }
    }
    // Both halves of the rule were actually exercised.
    expect(reused).toBeGreaterThan(40);
    expect(fallbacks).toBeGreaterThan(5);
  }, 20_000);

  it('hands back the same array when the route has not changed', () => {
    const input: OrthoRouteInput = {
      source: { x: 306, y: 150 }, sourceSide: 'right', sourceRect: A,
      target: { x: 594, y: 450 }, targetSide: 'left', targetRect: { x: 600, y: 400, width: 200, height: 100 },
      obstacles: [{ x: 2000, y: 2000, width: 50, height: 50 }],
    };
    const first = orthoRouteMemo(input, null);
    // A far shape moved: the route cannot have.
    const second = orthoRouteMemo({ ...input, obstacles: [{ x: 2100, y: 2000, width: 50, height: 50 }] }, first.memo);
    expect(second.points).toBe(first.points);
    // A shape moved onto the route: it has.
    const third = orthoRouteMemo({ ...input, obstacles: [{ x: 420, y: 250, width: 60, height: 100 }] }, second.memo);
    expect(third.points).not.toBe(first.points);
    expect(third.points).toEqual(orthoRoute({ ...input, obstacles: [{ x: 420, y: 250, width: 60, height: 100 }] }));
  });

  it('matches orthoRoute on every frame of a shape dragged across a board of connectors', () => {
    const r = rng(2026);
    const cell = (c: number, row: number): RouteRect => ({ x: c * 200, y: row * 130, width: 120, height: 60 });
    for (let trial = 0; trial < 6; trial++) {
      const shapes: RouteRect[] = [];
      for (let row = 0; row < 5; row++) for (let c = 0; c < 6; c++) shapes.push(cell(c, row));
      // Connectors between grid neighbours, each with a memo of its own.
      const links = Array.from({ length: 10 }, () => {
        const i = Math.floor(r() * shapes.length);
        const across = r() < 0.5 && i % 6 < 5;
        const j = across ? i + 1 : Math.min(shapes.length - 1, i + 6);
        return { i, j, sides: (across ? ['right', 'left'] : ['bottom', 'top']) as [Direction, Direction], memo: null as RouteMemo | null };
      }).filter((l) => l.i !== l.j);
      const dragged = Math.floor(r() * shapes.length);
      for (let frame = 0; frame < 40; frame++) {
        const s0 = shapes[dragged];
        shapes[dragged] = { ...s0, x: s0.x + Math.round(r() * 40 - 12), y: s0.y + Math.round(r() * 30 - 10) };
        for (const link of links) {
          const sourceRect = shapes[link.i];
          const targetRect = shapes[link.j];
          const input: OrthoRouteInput = {
            source: anchorOn(sourceRect, link.sides[0]),
            sourceSide: link.sides[0],
            sourceRect,
            target: anchorOn(targetRect, link.sides[1]),
            targetSide: link.sides[1],
            targetRect,
            obstacles: shapes.filter((_, k) => k !== link.i && k !== link.j),
          };
          const result = orthoRouteMemo(input, link.memo);
          expect(result.points, `trial ${trial}, frame ${frame}`).toEqual(orthoRoute(input));
          link.memo = result.memo;
        }
      }
    }
  }, 20_000);
});
