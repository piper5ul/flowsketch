import { describe, expect, it } from 'vitest';
import {
  buildConnectorPath,
  catmullRomToBezier,
  cleanPath,
  controlThrough,
  interpolatePolyline,
  smoothStepPath,
  type Point,
} from './connectorPath';
import { manhattanRoute } from './manhattanRouter';

const SOURCE: Point = { x: 0, y: 0 };
const TARGET: Point = { x: 200, y: 100 };

/** The two anchors and their sides, which every kind needs. */
const ends = { source: SOURCE, target: TARGET, sourceSide: 'right', targetSide: 'left' } as const;

/** The shapes the two anchors sit on, for the runs that need the real router. */
const SOURCE_RECT = { x: -100, y: -50, width: 100, height: 100 };
const TARGET_RECT = { x: 200, y: 50, width: 100, height: 100 };

/** Distance from `p` to the nearest of `points`, for "is this on the path?". */
function distanceToPolyline(points: Point[], p: Point): number {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

/**
 * What `ConnectorEdge` does for an elbow: hand the bends to the router as
 * vertices, then draw the corners that come back.
 */
function elbowThrough(waypoints: Point[]) {
  const { points: routed } = manhattanRoute({
    sourceX: SOURCE.x, sourceY: SOURCE.y, targetX: TARGET.x, targetY: TARGET.y,
    sourceRect: SOURCE_RECT, targetRect: TARGET_RECT, obstacles: [],
    vertices: waypoints,
    startDirections: ['right'], endDirections: ['left'],
  });
  return buildConnectorPath('elbow', { ...ends, waypoints, routed });
}

/** Grid snapping leaves sub-8px kinks, which is the tolerance the router's own tests use. */
function expectOrthogonal(path: Point[], tolerance = 8) {
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    expect(
      Math.abs(a.x - b.x) <= tolerance || Math.abs(a.y - b.y) <= tolerance,
      `segment ${i} (${a.x},${a.y})→(${b.x},${b.y}) is diagonal`,
    ).toBe(true);
  }
}

/** No bends, one bend, three bends — the cases every kind has to draw. */
const NONE: Point[] = [];
const ONE: Point[] = [{ x: 60, y: 220 }];
const THREE: Point[] = [{ x: 60, y: 220 }, { x: 130, y: 260 }, { x: 190, y: 200 }];

describe('buildConnectorPath', () => {
  describe('straight', () => {
    it('draws one segment between the anchors, grabbed in the middle', () => {
      const path = buildConnectorPath('straight', ends);
      expect(path.d).toBe('M 0,0L 200,100');
      expect(path.points).toEqual([SOURCE, TARGET]);
      expect(path.segments).toHaveLength(1);
      expect(path.segments[0].handle).toEqual({ x: 100, y: 50 });
    });

    it('bends through a waypoint, and offers a handle either side of it', () => {
      const path = buildConnectorPath('straight', { ...ends, waypoints: [{ x: 40, y: 160 }] });
      expect(path.d).toBe('M 0 0 L 40 160 L 200 100');
      expect(path.points).toEqual([SOURCE, { x: 40, y: 160 }, TARGET]);
      expect(path.segments.map((s) => s.handle)).toEqual([{ x: 20, y: 80 }, { x: 120, y: 130 }]);
    });

    it('runs through every waypoint, in order', () => {
      const path = buildConnectorPath('straight', { ...ends, waypoints: THREE });
      expect(path.points).toEqual([SOURCE, ...THREE, TARGET]);
      expect(path.d).toBe('M 0 0 L 60 220 L 130 260 L 190 200 L 200 100');
    });
  });

  describe('elbow', () => {
    it('passes the routed corners through, in order, between the anchors', () => {
      const routed = [{ x: 100, y: 0 }, { x: 100, y: 100 }];
      const path = buildConnectorPath('elbow', { ...ends, routed });
      expect(path.points).toEqual([SOURCE, ...routed, TARGET]);
      expect(path.d.startsWith('M 0 0')).toBe(true);
      // Corners are filleted, so each one contributes a quadratic.
      expect(path.d.match(/Q/g)).toHaveLength(2);
    });

    it('grabs each run of corners in the middle of that run', () => {
      const path = buildConnectorPath('elbow', { ...ends, routed: [{ x: 100, y: 0 }, { x: 100, y: 100 }] });
      expect(path.segments.map((s) => s.handle)).toEqual([
        { x: 50, y: 0 }, { x: 100, y: 50 }, { x: 150, y: 100 },
      ]);
    });

    it('has one run, grabbed at its midpoint, when the route needs no corner', () => {
      const path = buildConnectorPath('elbow', { ...ends, routed: [] });
      expect(path.points).toEqual([SOURCE, TARGET]);
      expect(path.segments).toHaveLength(1);
      expect(path.segments[0].handle).toEqual({ x: 100, y: 50 });
    });

    it('is the only kind that reads `routed` — the others ignore it', () => {
      const routed = [{ x: 100, y: 40 }];
      expect(buildConnectorPath('straight', { ...ends, routed }).d).toBe(buildConnectorPath('straight', ends).d);
      expect(buildConnectorPath('curved', { ...ends, routed }).d).toBe(buildConnectorPath('curved', ends).d);
    });

    it('stays orthogonal however many bends it is routed through', () => {
      for (const waypoints of [NONE, ONE, THREE]) {
        expectOrthogonal(elbowThrough(waypoints).points);
      }
    });
  });

  describe('curved', () => {
    it('draws a cubic between the anchors when there is no waypoint', () => {
      const path = buildConnectorPath('curved', ends);
      expect(path.d).toContain('C');
      expect(path.d.startsWith('M0,0')).toBe(true);
    });

    it('leaves each anchor square to its own side', () => {
      // Both sides horizontal: the curve starts and ends running horizontally,
      // so the second sampled point has moved in x and not (yet) in y.
      const { points } = buildConnectorPath('curved', ends);
      expect(points[0]).toEqual(SOURCE);
      expect(points[points.length - 1]).toEqual(TARGET);
      expect(points[1].x).toBeGreaterThan(points[0].x);
    });

    it('is a chain of cubics through the bends, one per run', () => {
      const path = buildConnectorPath('curved', { ...ends, waypoints: THREE });
      expect(path.d.startsWith('M 0 0')).toBe(true);
      // Four runs: source → each of the three bends → target.
      expect(path.d.match(/C/g)).toHaveLength(4);
    });

    it('passes through a dragged bend rather than being pulled at by it', () => {
      const waypoint = { x: 40, y: 160 };
      const { points } = buildConnectorPath('curved', { ...ends, waypoints: [waypoint] });
      expect(distanceToPolyline(points, waypoint)).toBeLessThan(0.001);
    });

    it('samples a bent curve into a smooth polyline the label can ride', () => {
      const { points } = buildConnectorPath('curved', { ...ends, waypoints: [{ x: 40, y: 160 }] });
      expect(points.length).toBeGreaterThan(8);
      expect(points[0]).toEqual(SOURCE);
      expect(points[points.length - 1]).toEqual(TARGET);
    });

    it('takes each handle off the curve rather than off the chord below it', () => {
      const path = buildConnectorPath('curved', { ...ends, waypoints: THREE });
      for (const segment of path.segments) {
        expect(distanceToPolyline(path.points, segment.handle)).toBeLessThan(1);
      }
    });
  });

  describe('every kind', () => {
    it('runs within 20px of each of its waypoints', () => {
      for (const waypoints of [NONE, ONE, THREE]) {
        for (const kind of ['straight', 'curved'] as const) {
          const { points } = buildConnectorPath(kind, { ...ends, waypoints });
          for (const w of waypoints) {
            expect(distanceToPolyline(points, w), `${kind} misses (${w.x},${w.y})`).toBeLessThanOrEqual(20);
          }
        }
        // An elbow only turns at right angles, so it reaches its bends through
        // the router rather than by joining them up.
        const { points } = elbowThrough(waypoints);
        for (const w of waypoints) {
          expect(distanceToPolyline(points, w), `elbow misses (${w.x},${w.y})`).toBeLessThanOrEqual(20);
        }
      }
    });

    it('offers one grab handle per run, each on the path it grabs', () => {
      for (const kind of ['straight', 'curved'] as const) {
        for (const waypoints of [NONE, ONE, THREE]) {
          const path = buildConnectorPath(kind, { ...ends, waypoints });
          expect(path.segments, `${kind}/${waypoints.length}`).toHaveLength(waypoints.length + 1);
          for (const segment of path.segments) {
            expect(distanceToPolyline(path.points, segment.handle)).toBeLessThan(1);
            expect(segment.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it('names which way each run of an elbow goes, so a drag can be held across it', () => {
      const { points, segments } = elbowThrough(ONE);
      expect(segments).toHaveLength(points.length - 1);
      segments.forEach((segment, i) => {
        const dx = Math.abs(points[i + 1].x - points[i].x);
        const dy = Math.abs(points[i + 1].y - points[i].y);
        expect(segment.orientation).toBe(dx > dy ? 'h' : 'v');
      });
    });
  });
});

describe('catmullRomToBezier', () => {
  const pts: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 30, y: 0 }, { x: 40, y: 30 }];

  it('has nothing to draw for fewer than two points', () => {
    expect(catmullRomToBezier([])).toEqual([]);
    expect(catmullRomToBezier([{ x: 1, y: 2 }])).toEqual([]);
  });

  it('draws one cubic per run', () => {
    expect(catmullRomToBezier(pts)).toHaveLength(3);
  });

  it('passes through every point it is given', () => {
    const segments = catmullRomToBezier(pts);
    segments.forEach((s, i) => {
      expect(s.from).toEqual(pts[i]);
      expect(s.to).toEqual(pts[i + 1]);
    });
  });

  it('joins its runs without a corner: each control point mirrors the next', () => {
    // c2 of a run and c1 of the next are both the shared point ± the same
    // tangent, which is what makes the join smooth rather than kinked.
    const [first, second] = catmullRomToBezier(pts);
    const inTangent = { x: first.to.x - first.c2.x, y: first.to.y - first.c2.y };
    const outTangent = { x: second.c1.x - second.from.x, y: second.c1.y - second.from.y };
    expect(outTangent.x).toBeCloseTo(inTangent.x);
    expect(outTangent.y).toBeCloseTo(inTangent.y);
  });

  it('keeps a straight run straight', () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
    for (const s of catmullRomToBezier(line)) {
      expect(s.c1.y).toBeCloseTo(0);
      expect(s.c2.y).toBeCloseTo(0);
    }
  });
});

describe('interpolatePolyline', () => {
  const line: Point[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];

  it('measures by length, not by vertex', () => {
    expect(interpolatePolyline(line, 0.5)).toEqual({ x: 10, y: 0 });
    expect(interpolatePolyline(line, 0.25)).toEqual({ x: 5, y: 0 });
  });

  it('clamps to the two ends', () => {
    expect(interpolatePolyline(line, -1)).toEqual({ x: 0, y: 0 });
    expect(interpolatePolyline(line, 2)).toEqual({ x: 10, y: 10 });
  });

  it('survives a degenerate path', () => {
    expect(interpolatePolyline([], 0.5)).toEqual({ x: 0, y: 0 });
    expect(interpolatePolyline([{ x: 3, y: 4 }], 0.5)).toEqual({ x: 3, y: 4 });
    expect(interpolatePolyline([{ x: 3, y: 4 }, { x: 3, y: 4 }], 0.5)).toEqual({ x: 3, y: 4 });
  });
});

describe('controlThrough', () => {
  it('returns the control point that drags the curve onto the given point', () => {
    const dragged = { x: 40, y: 160 };
    const control = controlThrough(SOURCE, dragged, TARGET);
    // The midpoint of a quadratic is (a + 2·control + b) / 4, and that is where
    // the drag asked for the curve to pass.
    expect((SOURCE.x + 2 * control.x + TARGET.x) / 4).toBeCloseTo(dragged.x);
    expect((SOURCE.y + 2 * control.y + TARGET.y) / 4).toBeCloseTo(dragged.y);
  });

  it('is the midpoint itself only when the drag has not left the chord', () => {
    const chordMid = { x: 100, y: 50 };
    expect(controlThrough(SOURCE, chordMid, TARGET)).toEqual(chordMid);
  });
});

describe('cleanPath', () => {
  it('leaves the two endpoints where they are', () => {
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 50 }, { x: 100, y: 50 }];
    const cleaned = cleanPath(pts);
    expect(cleaned[0]).toEqual({ x: 0, y: 0 });
    expect(cleaned[cleaned.length - 1]).toEqual({ x: 100, y: 50 });
  });

  it('straightens a sub-8px kink from grid snapping onto its neighbour', () => {
    const cleaned = cleanPath([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 50 }, { x: 100, y: 50 }]);
    expect(cleaned).toEqual([{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 100, y: 50 }]);
  });

  it('does not mutate the points it was given', () => {
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 50 }, { x: 100, y: 50 }];
    const before = structuredClone(pts);
    cleanPath(pts);
    expect(pts).toEqual(before);
  });

  it('passes a two-point path straight through', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    expect(cleanPath(pts)).toEqual(pts);
  });
});

describe('smoothStepPath', () => {
  it('is empty for fewer than two points', () => {
    expect(smoothStepPath([])).toBe('');
    expect(smoothStepPath([{ x: 0, y: 0 }])).toBe('');
  });

  it('is a plain line when there is no corner to fillet', () => {
    expect(smoothStepPath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe('M 0 0 L 10 0');
  });

  it('never rounds a corner by more than half of its shorter leg', () => {
    // The second leg is 6px, so its fillet has to stop at 3px, not the 12px default.
    const d = smoothStepPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 6 }]);
    expect(d).toBe('M 0 0 L 97 0 Q 100 0 100 3 L 100 6');
  });
});
