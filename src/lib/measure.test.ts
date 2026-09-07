import { describe, expect, it } from 'vitest';
import { measureGaps } from './measure';

const a = { x: 0, y: 0, width: 100, height: 50 };

describe('measureGaps', () => {
  it('measures the horizontal gap between boxes side by side, through the rows they share', () => {
    expect(measureGaps(a, { x: 160, y: 10, width: 40, height: 40 })).toEqual([
      { x1: 100, y1: 30, x2: 160, y2: 30, label: 60 },
    ]);
  });

  it('measures the vertical gap between stacked boxes, and reports it from either side', () => {
    const below = { x: 20, y: 80, width: 40, height: 40 };
    expect(measureGaps(a, below)).toEqual([{ x1: 40, y1: 50, x2: 40, y2: 80, label: 30 }]);
    expect(measureGaps(below, a)).toEqual([{ x1: 40, y1: 50, x2: 40, y2: 80, label: 30 }]);
  });

  it('measures both gaps for a box on the diagonal, at the first box’s middle', () => {
    const gaps = measureGaps(a, { x: 150, y: 100, width: 10, height: 10 });
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toMatchObject({ x1: 100, x2: 150, y1: 25, label: 50 });
    expect(gaps[1]).toMatchObject({ y1: 50, y2: 100, x1: 50, label: 50 });
  });

  it('finds no gap between boxes that overlap', () => {
    expect(measureGaps(a, { x: 50, y: 20, width: 100, height: 50 })).toEqual([]);
  });
});
