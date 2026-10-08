import { describe, expect, it } from 'vitest';
import { gridMove } from './ColorGrid';

describe('gridMove', () => {
  it('moves in each direction through a 4-column grid', () => {
    expect(gridMove(5, 'ArrowLeft', 16)).toBe(4);
    expect(gridMove(5, 'ArrowRight', 16)).toBe(6);
    expect(gridMove(5, 'ArrowUp', 16)).toBe(1);
    expect(gridMove(5, 'ArrowDown', 16)).toBe(9);
  });

  it('clamps at the overall grid edges', () => {
    expect(gridMove(0, 'ArrowLeft', 16)).toBe(0);
    expect(gridMove(15, 'ArrowRight', 16)).toBe(15);
    expect(gridMove(2, 'ArrowUp', 16)).toBe(2);
    expect(gridMove(14, 'ArrowDown', 16)).toBe(14);
    expect(gridMove(11, 'ArrowDown', 15)).toBe(14);
  });

  it('moves Home and End to the first and last cell of the current row', () => {
    expect(gridMove(6, 'Home', 16)).toBe(4);
    expect(gridMove(6, 'End', 16)).toBe(7);
    expect(gridMove(14, 'End', 15)).toBe(14);
  });

  it('supports all 16 cells, including the custom colour cell', () => {
    expect(gridMove(14, 'ArrowRight', 16)).toBe(15);
    expect(gridMove(15, 'ArrowLeft', 16)).toBe(14);
    expect(gridMove(15, 'End', 16)).toBe(15);
  });

  it('moves ArrowRight row-major so four steps from White reach Blue', () => {
    const target = Array.from({ length: 4 }).reduce<number>(
      (index) => gridMove(index, 'ArrowRight', 16),
      0,
    );
    expect(target).toBe(4);
  });
});
