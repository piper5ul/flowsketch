import { describe, expect, it } from 'vitest';
import { manhattanRoute, type ManhattanRouterInput, type ObstacleRect } from './manhattanRouter';

type Pt = { x: number; y: number };

/**
 * The router returns interior waypoints only; the renderer prepends the source
 * anchor and appends the target anchor. Tests reason about that full polyline.
 */
function fullPath(input: ManhattanRouterInput): Pt[] {
  const { points } = manhattanRoute(input);
  return [{ x: input.sourceX, y: input.sourceY }, ...points, { x: input.targetX, y: input.targetY }];
}

/**
 * Grid snapping can leave sub-8px kinks that `cleanPath` in ConnectorEdge
 * absorbs, so orthogonality is asserted at that tolerance, not exactly.
 */
function expectOrthogonal(path: Pt[], tolerance = 8) {
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    expect(
      dx <= tolerance || dy <= tolerance,
      `segment ${i} (${a.x},${a.y})→(${b.x},${b.y}) is diagonal`,
    ).toBe(true);
  }
}

function strictlyInside(p: Pt, r: ObstacleRect, margin = 1) {
  return p.x > r.x + margin && p.x < r.x + r.width - margin && p.y > r.y + margin && p.y < r.y + r.height - margin;
}

function expectAvoids(path: Pt[], obstacle: ObstacleRect) {
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    for (let s = 0; s <= 20; s++) {
      const t = s / 20;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      expect(strictlyInside(p, obstacle), `path passes through obstacle at (${p.x.toFixed(1)},${p.y.toFixed(1)})`).toBe(false);
    }
  }
}

const A: ObstacleRect = { x: 0, y: 0, width: 100, height: 100 };

describe('manhattanRoute', () => {
  it('routes a simple left-to-right connection orthogonally', () => {
    const B: ObstacleRect = { x: 300, y: 0, width: 100, height: 100 };
    const path = fullPath({
      sourceX: 100, sourceY: 50, targetX: 300, targetY: 50,
      sourceRect: A, targetRect: B, obstacles: [],
      startDirections: ['right'], endDirections: ['left'],
    });
    expectOrthogonal(path);
    expect(path[0]).toEqual({ x: 100, y: 50 });
    expect(path[path.length - 1]).toEqual({ x: 300, y: 50 });
  });

  it('turns to reach a target that is offset vertically', () => {
    const B: ObstacleRect = { x: 300, y: 250, width: 100, height: 100 };
    const path = fullPath({
      sourceX: 100, sourceY: 50, targetX: 300, targetY: 300,
      sourceRect: A, targetRect: B, obstacles: [],
      startDirections: ['right'], endDirections: ['left'],
    });
    expectOrthogonal(path);
    // At least one bend is required to change rows.
    expect(path.length).toBeGreaterThanOrEqual(3);
  });

  it('detours around an obstacle sitting on the direct line', () => {
    const B: ObstacleRect = { x: 500, y: 0, width: 100, height: 100 };
    const wall: ObstacleRect = { x: 250, y: -60, width: 100, height: 220 };
    const path = fullPath({
      sourceX: 100, sourceY: 50, targetX: 500, targetY: 50,
      sourceRect: A, targetRect: B, obstacles: [wall],
      startDirections: ['right'], endDirections: ['left'],
    });
    expectOrthogonal(path);
    expectAvoids(path, wall);
    expect(path.length).toBeGreaterThanOrEqual(4);
  });

  it('passes near a user waypoint when one is given', () => {
    const B: ObstacleRect = { x: 300, y: 0, width: 100, height: 100 };
    const waypoint = { x: 200, y: 250 };
    const path = fullPath({
      sourceX: 100, sourceY: 50, targetX: 300, targetY: 50,
      sourceRect: A, targetRect: B, obstacles: [],
      vertices: [waypoint],
      startDirections: ['right'], endDirections: ['left'],
    });
    expectOrthogonal(path);
    const nearest = Math.min(...path.map((p) => Math.hypot(p.x - waypoint.x, p.y - waypoint.y)));
    expect(nearest).toBeLessThanOrEqual(20);
  });

  it('respects the requested exit side of the source', () => {
    const B: ObstacleRect = { x: 300, y: 0, width: 100, height: 100 };
    const { points } = manhattanRoute({
      sourceX: 50, sourceY: 100, targetX: 300, targetY: 50,
      sourceRect: A, targetRect: B, obstacles: [],
      startDirections: ['bottom'], endDirections: ['left'],
    });
    expect(points.length).toBeGreaterThan(0);
    // The first waypoint must be below the source rect, i.e. the route left through the bottom.
    expect(points[0].y).toBeGreaterThanOrEqual(100);
  });

  it('is deterministic for identical input', () => {
    const B: ObstacleRect = { x: 400, y: 120, width: 100, height: 100 };
    const input: ManhattanRouterInput = {
      sourceX: 100, sourceY: 50, targetX: 400, targetY: 170,
      sourceRect: A, targetRect: B,
      obstacles: [{ x: 220, y: 0, width: 60, height: 120 }],
      startDirections: ['right'], endDirections: ['left'],
    };
    expect(manhattanRoute(input)).toEqual(manhattanRoute(input));
  });

  it('never returns NaN coordinates', () => {
    const B: ObstacleRect = { x: 0, y: 0, width: 100, height: 100 };
    // Source and target share a rect — the degenerate self-connection case.
    const { points } = manhattanRoute({
      sourceX: 100, sourceY: 50, targetX: 50, targetY: 100,
      sourceRect: A, targetRect: B, obstacles: [],
      startDirections: ['right'], endDirections: ['bottom'],
    });
    for (const p of points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});
