import { describe, expect, it } from 'vitest';
import {
  ERASER_SLOP_PX,
  INK_SIMPLIFY_TOLERANCE,
  INK_WIDTH,
  inkBounds,
  inkKindOfTool,
  inkPath,
  isInkTool,
  simplify,
  strokeHits,
} from './ink';
import type { InkPoint } from '../types';

describe('isInkTool / inkKindOfTool', () => {
  it('names the three freehand tools and the pen each holds', () => {
    expect(isInkTool('pen')).toBe(true);
    expect(isInkTool('highlighter')).toBe(true);
    expect(isInkTool('eraser')).toBe(true);
    expect(isInkTool('select')).toBe(false);
    expect(isInkTool('rectangle')).toBe(false);

    expect(inkKindOfTool('pen')).toBe('marker');
    expect(inkKindOfTool('highlighter')).toBe('highlighter');
    // The eraser draws nothing, so there is no pen to name.
    expect(inkKindOfTool('eraser')).toBeNull();
    expect(inkKindOfTool('select')).toBeNull();
  });

  it('draws a highlighter wider than a marker', () => {
    expect(INK_WIDTH.highlighter).toBeGreaterThan(INK_WIDTH.marker);
  });
});

describe('inkBounds', () => {
  const points: InkPoint[] = [
    [100, 200],
    [140, 260],
    [120, 220],
  ];

  it('boxes the stroke with half the pen width on every side', () => {
    const box = inkBounds(points, 4);
    expect(box).toMatchObject({ x: 98, y: 198, width: 44, height: 64 });
  });

  it('re-expresses the points inside that box', () => {
    const box = inkBounds(points, 4);
    expect(box.points).toEqual([
      [2, 2],
      [42, 62],
      [22, 22],
    ]);
  });

  it('keeps the pressure of a sample that has one, and adds none to one that has not', () => {
    const box = inkBounds([[10, 10, 0.4], [20, 20]], 2);
    expect(box.points).toEqual([[1, 1, 0.4], [11, 11]]);
  });

  it('gives a perfectly straight stroke a box with height, not a line', () => {
    // A zero-height node is one React Flow can neither select nor resize.
    const box = inkBounds([[0, 50], [100, 50]], 6);
    expect(box.height).toBe(6);
    expect(box.width).toBe(106);
  });

  it('re-boxing an already-boxed stroke is the size it was drawn at', () => {
    // Which is what `InkNode`'s viewBox is: the natural size, whatever the node
    // has since been resized to.
    const box = inkBounds(points, 4);
    const again = inkBounds(box.points, 4);
    expect(again.x).toBe(0);
    expect(again.y).toBe(0);
    expect(again.width).toBe(box.width);
    expect(again.height).toBe(box.height);
  });

  it('answers for no points at all with a box the size of the nib', () => {
    expect(inkBounds([], 4)).toEqual({ x: 0, y: 0, width: 4, height: 4, points: [] });
  });
});

describe('inkPath', () => {
  it('draws nothing for nothing', () => {
    expect(inkPath([])).toBe('');
  });

  it('draws a dot for a single sample and a line for two', () => {
    expect(inkPath([[5, 6]])).toBe('M 5 6 L 5 6');
    expect(inkPath([[0, 0], [10, 4]])).toBe('M 0 0 L 10 4');
  });

  it('smooths three or more into one cubic per run, starting where the stroke did', () => {
    const d = inkPath([[0, 0], [10, 10], [20, 0]]);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.match(/C /g)).toHaveLength(2);
    // Catmull-Rom interpolates, so the curve ends on the last sample.
    expect(d.endsWith('20 0')).toBe(true);
  });
});

describe('strokeHits', () => {
  const line: InkPoint[] = [
    [0, 0],
    [100, 0],
  ];

  it('is true on the line and false off it', () => {
    expect(strokeHits(line, { x: 50, y: 0 }, 5)).toBe(true);
    expect(strokeHits(line, { x: 50, y: 4 }, 5)).toBe(true);
    expect(strokeHits(line, { x: 50, y: 6 }, 5)).toBe(false);
  });

  it('measures to the segment, not to its ends', () => {
    // Past the end of the line is a miss however close it is to the axis.
    expect(strokeHits(line, { x: 130, y: 0 }, 5)).toBe(false);
    expect(strokeHits(line, { x: 103, y: 0 }, 5)).toBe(true);
  });

  it('tests every run of a bent stroke', () => {
    const bent: InkPoint[] = [[0, 0], [50, 0], [50, 50]];
    expect(strokeHits(bent, { x: 50, y: 40 }, 3)).toBe(true);
    expect(strokeHits(bent, { x: 20, y: 40 }, 3)).toBe(false);
  });

  it('handles a stroke of one point, and one of none', () => {
    expect(strokeHits([[10, 10]], { x: 12, y: 10 }, 3)).toBe(true);
    expect(strokeHits([[10, 10]], { x: 20, y: 10 }, 3)).toBe(false);
    expect(strokeHits([], { x: 0, y: 0 }, 100)).toBe(false);
  });

  it('is what the eraser reaches with: half the pen plus its slop', () => {
    const radius = INK_WIDTH.marker / 2 + ERASER_SLOP_PX;
    // Just outside the drawn line, but inside what the eraser is given.
    expect(strokeHits(line, { x: 50, y: INK_WIDTH.marker / 2 + 1 }, radius)).toBe(true);
  });
});

describe('simplify', () => {
  it('drops the samples a straight run would have passed through anyway', () => {
    const straight: InkPoint[] = Array.from({ length: 50 }, (_, i) => [i * 2, 0] as InkPoint);
    expect(simplify(straight, INK_SIMPLIFY_TOLERANCE)).toEqual([[0, 0], [98, 0]]);
  });

  it('keeps a corner, and both ends, always', () => {
    const bent: InkPoint[] = [[0, 0], [25, 0], [50, 0], [50, 25], [50, 50]];
    expect(simplify(bent, INK_SIMPLIFY_TOLERANCE)).toEqual([[0, 0], [50, 0], [50, 50]]);
  });

  it('keeps a wobble bigger than the tolerance and drops one smaller', () => {
    expect(simplify([[0, 0], [10, 2], [20, 0]], INK_SIMPLIFY_TOLERANCE)).toHaveLength(3);
    expect(simplify([[0, 0], [10, 0.2], [20, 0]], INK_SIMPLIFY_TOLERANCE)).toEqual([[0, 0], [20, 0]]);
  });

  it('leaves a stroke of two points or fewer exactly as it is', () => {
    expect(simplify([], 0.5)).toEqual([]);
    expect(simplify([[1, 2]], 0.5)).toEqual([[1, 2]]);
    expect(simplify([[1, 2], [3, 4]], 0.5)).toEqual([[1, 2], [3, 4]]);
  });

  it('carries the pressure of every sample it keeps', () => {
    const drawn: InkPoint[] = [[0, 0, 0.1], [10, 5, 0.9], [20, 0, 0.3]];
    expect(simplify(drawn, INK_SIMPLIFY_TOLERANCE)).toEqual(drawn);
  });
});
