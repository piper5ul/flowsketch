import { describe, expect, it } from 'vitest';
import { anchorToPoint, distanceToRect, floatingEdgeSides, nearestAnchorOnRect, standoff, type Rect } from './edgeGeometry';

const rect: Rect = { x: 0, y: 0, width: 100, height: 50 };

describe('anchorToPoint', () => {
  it('maps each side + fraction to a point on the border', () => {
    expect(anchorToPoint({ side: 'top', t: 0.5 }, rect)).toEqual({ x: 50, y: 0 });
    expect(anchorToPoint({ side: 'right', t: 0 }, rect)).toEqual({ x: 100, y: 0 });
    expect(anchorToPoint({ side: 'bottom', t: 1 }, rect)).toEqual({ x: 100, y: 50 });
    expect(anchorToPoint({ side: 'left', t: 0.5 }, rect)).toEqual({ x: 0, y: 25 });
  });

  it('respects the rect origin', () => {
    const r: Rect = { x: 200, y: 300, width: 40, height: 20 };
    expect(anchorToPoint({ side: 'top', t: 0.25 }, r)).toEqual({ x: 210, y: 300 });
  });
});

describe('nearestAnchorOnRect', () => {
  it('picks the closest side and snaps to the midpoint', () => {
    expect(nearestAnchorOnRect(50, -20, rect)).toEqual({ side: 'top', t: 0.5 });
    expect(nearestAnchorOnRect(120, 25, rect)).toEqual({ side: 'right', t: 0.5 });
  });

  it('snaps to a corner when within snapDistance', () => {
    expect(nearestAnchorOnRect(3, -5, rect)).toEqual({ side: 'top', t: 0 });
    expect(nearestAnchorOnRect(98, -5, rect)).toEqual({ side: 'top', t: 1 });
  });

  it('keeps an arbitrary fraction when nothing is within snapDistance', () => {
    const a = nearestAnchorOnRect(30, -5, rect);
    expect(a.side).toBe('top');
    expect(a.t).toBeCloseTo(0.3);
  });

  it('honors a custom snapDistance', () => {
    // 30px from the corner: snaps with a 40px threshold, not with the default 10px.
    expect(nearestAnchorOnRect(30, -5, rect, 40).t).toBe(0);
    expect(nearestAnchorOnRect(30, -5, rect).t).toBeCloseTo(0.3);
  });
});

describe('floatingEdgeSides', () => {
  const a: Rect = { x: 0, y: 0, width: 100, height: 100 };

  it('faces horizontally when the target is mostly to the side', () => {
    expect(floatingEdgeSides(a, { x: 300, y: 20, width: 100, height: 100 })).toEqual({ sourcePos: 'right', targetPos: 'left' });
    expect(floatingEdgeSides(a, { x: -300, y: 20, width: 100, height: 100 })).toEqual({ sourcePos: 'left', targetPos: 'right' });
  });

  it('faces vertically when the target is mostly above or below', () => {
    expect(floatingEdgeSides(a, { x: 20, y: 300, width: 100, height: 100 })).toEqual({ sourcePos: 'bottom', targetPos: 'top' });
    expect(floatingEdgeSides(a, { x: 20, y: -300, width: 100, height: 100 })).toEqual({ sourcePos: 'top', targetPos: 'bottom' });
  });
});

describe('distanceToRect', () => {
  it('is zero inside and on the border', () => {
    expect(distanceToRect(50, 25, rect)).toBe(0);
    expect(distanceToRect(100, 50, rect)).toBe(0);
  });

  it('measures perpendicular distance from a side', () => {
    expect(distanceToRect(150, 25, rect)).toBe(50);
    expect(distanceToRect(50, -30, rect)).toBe(30);
  });

  it('measures diagonal distance from a corner', () => {
    expect(distanceToRect(-30, -40, rect)).toBe(50);
  });
});

describe('standoff', () => {
  const p = { x: 100, y: 50 };

  it('moves the point straight out from the side it sits on', () => {
    expect(standoff(p, 'top', 6)).toEqual({ x: 100, y: 44 });
    expect(standoff(p, 'bottom', 6)).toEqual({ x: 100, y: 56 });
    expect(standoff(p, 'left', 6)).toEqual({ x: 94, y: 50 });
    expect(standoff(p, 'right', 6)).toEqual({ x: 106, y: 50 });
  });

  it('is the identity for a gap of zero, which is what a floating arrow gets', () => {
    expect(standoff(p, 'left', 0)).toEqual(p);
  });
});
