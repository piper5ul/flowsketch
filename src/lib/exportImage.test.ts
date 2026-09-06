import { describe, expect, it } from 'vitest';
import { computeExportViewport } from './exportImage';

const opts = { padding: 20, pixelRatio: 2 };

describe('computeExportViewport', () => {
  it('pads the bounds on all four sides', () => {
    const { width, height } = computeExportViewport({ x: 0, y: 0, width: 300, height: 200 }, opts);
    expect(width).toBe(340);
    expect(height).toBe(240);
  });

  it('translates the bounds top-left to the padding offset, wherever the diagram sits', () => {
    const bounds = { x: -1200, y: 640, width: 300, height: 200 };
    const { viewport } = computeExportViewport(bounds, opts);
    expect(viewport.zoom).toBe(1);
    expect(bounds.x * viewport.zoom + viewport.x).toBeCloseTo(20);
    expect(bounds.y * viewport.zoom + viewport.y).toBeCloseTo(20);
  });

  it('keeps zoom at 1 while the padded image stays within maxSide', () => {
    const { viewport, width } = computeExportViewport(
      { x: 0, y: 0, width: 900, height: 400 },
      { ...opts, maxSide: 1000 },
    );
    expect(viewport.zoom).toBe(1);
    expect(width).toBe(940);
  });

  it('scales down uniformly once the longer side passes maxSide', () => {
    const { width, height, viewport } = computeExportViewport(
      { x: 0, y: 0, width: 4000, height: 2000 },
      { ...opts, maxSide: 1000 },
    );
    expect(viewport.zoom).toBeCloseTo(1000 / 4040);
    expect(width).toBe(1000);
    // The aspect ratio of the padded box survives the downscale.
    expect(height).toBe(Math.round(2040 * (1000 / 4040)));
  });

  it('still places the top-left at the padding offset when scaled down', () => {
    const bounds = { x: 500, y: -300, width: 4000, height: 2000 };
    const { viewport } = computeExportViewport(bounds, { ...opts, maxSide: 1000 });
    expect(bounds.x * viewport.zoom + viewport.x).toBeCloseTo(20 * viewport.zoom);
    expect(bounds.y * viewport.zoom + viewport.y).toBeCloseTo(20 * viewport.zoom);
  });

  it('yields at least one pixel for degenerate zero-size bounds', () => {
    const { width, height } = computeExportViewport(
      { x: 10, y: 10, width: 0, height: 0 },
      { padding: 0, pixelRatio: 1 },
    );
    expect(width).toBeGreaterThanOrEqual(1);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it('scales down further when the device-pixel size would exceed the canvas limit', () => {
    const big = { x: 0, y: 0, width: 20000, height: 1000 };
    const { width, viewport } = computeExportViewport(big, { padding: 0, pixelRatio: 4, maxSide: 20000 });
    expect(viewport.zoom).toBeLessThan(1);
    expect(width * 4).toBeLessThanOrEqual(16384);
  });
});
