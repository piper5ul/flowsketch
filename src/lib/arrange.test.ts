import { describe, expect, it } from 'vitest';
import { alignNodes, type ArrangeRect } from './arrange';

/** Three rects of different sizes, spread over a 0,0 → 300,200 box. */
const RECTS: ArrangeRect[] = [
  { id: 'a', x: 0, y: 0, w: 100, h: 50 },
  { id: 'b', x: 50, y: 80, w: 200, h: 40 },
  { id: 'c', x: 200, y: 120, w: 100, h: 80 },
];

describe('alignNodes', () => {
  it('puts every left edge on the bounding box\'s left edge', () => {
    const moved = alignNodes(RECTS, 'left');
    expect(moved.a.x).toBe(0);
    expect(moved.b.x).toBe(0);
    expect(moved.c.x).toBe(0);
  });

  it('centres every rect on the bounding box\'s vertical axis', () => {
    // Bounds run 0 → 300, so the centre line is x = 150.
    const moved = alignNodes(RECTS, 'centerX');
    expect(moved.a.x).toBe(100);
    expect(moved.b.x).toBe(50);
    expect(moved.c.x).toBe(100);
  });

  it('puts every right edge on the bounding box\'s right edge', () => {
    const moved = alignNodes(RECTS, 'right');
    expect(moved.a.x).toBe(200);
    expect(moved.b.x).toBe(100);
    expect(moved.c.x).toBe(200);
  });

  it('puts every top edge on the bounding box\'s top edge', () => {
    const moved = alignNodes(RECTS, 'top');
    expect(moved.a.y).toBe(0);
    expect(moved.b.y).toBe(0);
    expect(moved.c.y).toBe(0);
  });

  it('centres every rect on the bounding box\'s horizontal axis', () => {
    // Bounds run 0 → 200, so the centre line is y = 100.
    const moved = alignNodes(RECTS, 'centerY');
    expect(moved.a.y).toBe(75);
    expect(moved.b.y).toBe(80);
    expect(moved.c.y).toBe(60);
  });

  it('puts every bottom edge on the bounding box\'s bottom edge', () => {
    const moved = alignNodes(RECTS, 'bottom');
    expect(moved.a.y).toBe(150);
    expect(moved.b.y).toBe(160);
    expect(moved.c.y).toBe(120);
  });

  it('leaves the other axis untouched', () => {
    const moved = alignNodes(RECTS, 'left');
    expect(moved.b.y).toBe(80);
    expect(moved.c.y).toBe(120);
  });

  it('returns nothing for fewer than two rects', () => {
    expect(alignNodes([RECTS[0]], 'left')).toEqual({});
    expect(alignNodes([], 'top')).toEqual({});
  });
});
