import { describe, expect, it } from 'vitest';
import { alignNodes, distributeNodes, matchSize, type ArrangeRect } from './arrange';

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

describe('distributeNodes', () => {
  /** Three rects with a 50px gap then a 200px one, so distributing changes something. */
  const UNEVEN: ArrangeRect[] = [
    { id: 'a', x: 0, y: 0, w: 100, h: 40 },
    { id: 'b', x: 150, y: 0, w: 50, h: 40 },
    { id: 'c', x: 400, y: 0, w: 100, h: 40 },
  ];

  const gapsX = (rects: ArrangeRect[], moved: Record<string, { x: number }>) => {
    const ordered = [...rects].sort((p, q) => moved[p.id].x - moved[q.id].x);
    return ordered.slice(1).map((r, i) => moved[r.id].x - (moved[ordered[i].id].x + ordered[i].w));
  };

  it('leaves equal gaps between edges, not between centres', () => {
    const moved = distributeNodes(UNEVEN, 'x');
    // 500px of span holding 250px of rect leaves 250px of gap over two gaps.
    expect(gapsX(UNEVEN, moved)).toEqual([125, 125]);
  });

  it('keeps the first and last rect exactly where they were', () => {
    const moved = distributeNodes(UNEVEN, 'x');
    expect(moved.a.x).toBe(0);
    expect(moved.c.x).toBe(400);
  });

  it('leaves an already even row untouched', () => {
    const even: ArrangeRect[] = [
      { id: 'a', x: 0, y: 0, w: 100, h: 40 },
      { id: 'b', x: 150, y: 0, w: 50, h: 40 },
      { id: 'c', x: 250, y: 0, w: 100, h: 40 },
    ];
    const moved = distributeNodes(even, 'x');
    expect(moved.a.x).toBe(0);
    expect(moved.b.x).toBe(150);
    expect(moved.c.x).toBe(250);
  });

  it('orders by position, not by the order it was handed', () => {
    const shuffled = [UNEVEN[2], UNEVEN[0], UNEVEN[1]];
    expect(distributeNodes(shuffled, 'x')).toEqual(distributeNodes(UNEVEN, 'x'));
  });

  it('distributes down the y axis the same way', () => {
    const column: ArrangeRect[] = [
      { id: 'a', x: 0, y: 0, w: 40, h: 100 },
      { id: 'b', x: 0, y: 150, w: 40, h: 50 },
      { id: 'c', x: 0, y: 400, w: 40, h: 100 },
    ];
    const moved = distributeNodes(column, 'y');
    expect(moved.a.y).toBe(0);
    expect(moved.b.y).toBe(225);
    expect(moved.c.y).toBe(400);
    // The across-axis coordinate is never touched.
    expect(moved.b.x).toBe(0);
  });

  it('needs three rects to have a middle to move', () => {
    expect(distributeNodes([UNEVEN[0], UNEVEN[1]], 'x')).toEqual({});
    expect(distributeNodes([], 'y')).toEqual({});
  });
});

describe('matchSize', () => {
  // Distinct areas: `b` is the biggest, so it is the reference.
  const RANDOM_SIZES: ArrangeRect[] = [
    { id: 'a', x: 0, y: 0, w: 100, h: 50 },
    { id: 'b', x: 300, y: 0, w: 200, h: 100 },
    { id: 'c', x: 0, y: 300, w: 60, h: 80 },
  ];

  it('gives every rect the largest one\'s size', () => {
    expect(matchSize(RANDOM_SIZES, 'both')).toEqual({
      a: { w: 200, h: 100 },
      b: { w: 200, h: 100 },
      c: { w: 200, h: 100 },
    });
  });

  it('matches one dimension without touching the other', () => {
    expect(matchSize(RANDOM_SIZES, 'width')).toEqual({
      a: { w: 200, h: 50 },
      b: { w: 200, h: 100 },
      c: { w: 200, h: 80 },
    });
    expect(matchSize(RANDOM_SIZES, 'height')).toEqual({
      a: { w: 100, h: 100 },
      b: { w: 200, h: 100 },
      c: { w: 60, h: 100 },
    });
  });

  it('picks the same reference whatever order the rects arrive in', () => {
    const shuffled = [RANDOM_SIZES[2], RANDOM_SIZES[1], RANDOM_SIZES[0]];
    expect(matchSize(shuffled, 'both').a).toEqual({ w: 200, h: 100 });
  });

  it('returns nothing for fewer than two rects', () => {
    expect(matchSize([RANDOM_SIZES[0]], 'both')).toEqual({});
    expect(matchSize([], 'width')).toEqual({});
  });
});
