import { describe, expect, it } from 'vitest';
import { buildConnectorPath, cleanPath, controlThrough, smoothStepPath, type Point } from './connectorPath';

const SOURCE: Point = { x: 0, y: 0 };
const TARGET: Point = { x: 200, y: 100 };

/** The two anchors and their sides, which every kind needs. */
const ends = { source: SOURCE, target: TARGET, sourceSide: 'right', targetSide: 'left' } as const;

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

describe('buildConnectorPath', () => {
  describe('straight', () => {
    it('draws one segment between the anchors', () => {
      const path = buildConnectorPath('straight', ends);
      expect(path.d).toBe('M 0,0L 200,100');
      expect(path.points).toEqual([SOURCE, TARGET]);
      expect(path.center).toEqual({ x: 100, y: 50 });
    });

    it('bends through a waypoint, and puts the handle on it', () => {
      const path = buildConnectorPath('straight', { ...ends, waypoint: { x: 40, y: 160 } });
      expect(path.d).toBe('M 0 0 L 40 160 L 200 100');
      expect(path.center).toEqual({ x: 40, y: 160 });
      expect(path.points).toEqual([SOURCE, { x: 40, y: 160 }, TARGET]);
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

    it('puts the handle on the middle corner rather than half way along', () => {
      const path = buildConnectorPath('elbow', { ...ends, routed: [{ x: 100, y: 0 }, { x: 100, y: 100 }] });
      expect(path.center).toEqual({ x: 100, y: 100 });
    });

    it('centres the handle on a corner-free run, so it never hides an endpoint', () => {
      const path = buildConnectorPath('elbow', { ...ends, routed: [] });
      expect(path.points).toEqual([SOURCE, TARGET]);
      expect(path.center).toEqual({ x: 100, y: 50 });
    });

    it('is the only kind that reads `routed` — the others ignore it', () => {
      const routed = [{ x: 100, y: 40 }];
      expect(buildConnectorPath('straight', { ...ends, routed }).d).toBe(buildConnectorPath('straight', ends).d);
      expect(buildConnectorPath('curved', { ...ends, routed }).d).toBe(buildConnectorPath('curved', ends).d);
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

    it('makes a waypoint the control point of a quadratic', () => {
      const path = buildConnectorPath('curved', { ...ends, waypoint: { x: 40, y: 160 } });
      expect(path.d).toBe('M 0 0 Q 40 160 200 100');
    });

    it('puts the handle on the curve, not on the control point it was dragged to', () => {
      const waypoint = { x: 40, y: 160 };
      const path = buildConnectorPath('curved', { ...ends, waypoint });
      // Quadratic midpoint: (source + 2·control + target) / 4.
      expect(path.center).toEqual({ x: 70, y: 105 });
      expect(path.center).not.toEqual(waypoint);
    });

    it('has no segment handles to hang off, so the sampled path is a smooth polyline', () => {
      const { points } = buildConnectorPath('curved', { ...ends, waypoint: { x: 40, y: 160 } });
      expect(points.length).toBeGreaterThan(8);
      expect(points[0]).toEqual(SOURCE);
      expect(points[points.length - 1]).toEqual(TARGET);
    });
  });

  it('puts the handle on the path for every kind', () => {
    for (const kind of ['straight', 'elbow', 'curved'] as const) {
      for (const waypoint of [null, { x: 40, y: 160 }]) {
        const path = buildConnectorPath(kind, { ...ends, waypoint, routed: [{ x: 100, y: 0 }] });
        expect(distanceToPolyline(path.points, path.center)).toBeLessThan(1);
      }
    }
  });
});

describe('controlThrough', () => {
  it('returns the control point that drags the curve onto the given point', () => {
    const dragged = { x: 40, y: 160 };
    const control = controlThrough(SOURCE, dragged, TARGET);
    // Feeding that control back in must put the curve's midpoint on the pointer.
    const path = buildConnectorPath('curved', { ...ends, waypoint: control });
    expect(path.center.x).toBeCloseTo(dragged.x);
    expect(path.center.y).toBeCloseTo(dragged.y);
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
    // The second leg is 6px, so its fillet has to stop at 3px, not the 10px default.
    const d = smoothStepPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 6 }]);
    expect(d).toBe('M 0 0 L 97 0 Q 100 0 100 3 L 100 6');
  });
});
