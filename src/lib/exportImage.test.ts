import { describe, expect, it } from 'vitest';
import { computeExportViewport, exportSubset, insertSvgBackground } from './exportImage';

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

describe('insertSvgBackground', () => {
  const url = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const decode = (dataUrl: string) =>
    decodeURIComponent(dataUrl.replace('data:image/svg+xml;charset=utf-8,', ''));

  it('paints a full-size rect as the first child of the root', () => {
    const painted = decode(insertSvgBackground(url('<svg width="10" height="5"><g/></svg>'), '#f6f7fb'));
    expect(painted).toBe('<svg width="10" height="5"><rect width="100%" height="100%" fill="#f6f7fb"/><g/></svg>');
  });

  it('keeps the attributes the root tag came with', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><foreignObject/></svg>';
    expect(decode(insertSvgBackground(url(svg), 'red'))).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><rect width="100%" height="100%" fill="red"/>',
    );
  });

  it('leaves a data URL it does not understand alone', () => {
    expect(insertSvgBackground('data:image/png;base64,AAAA', 'red')).toBe('data:image/png;base64,AAAA');
    expect(insertSvgBackground(url('not markup'), 'red')).toBe(url('not markup'));
  });
});

describe('exportSubset', () => {
  const frame = { id: 'f', position: { x: 100, y: 100 }, width: 400, height: 300, selected: true };
  const child = { id: 'c', parentId: 'f', position: { x: 20, y: 30 }, width: 100, height: 50 };
  const loose = { id: 'l', position: { x: 900, y: 900 }, width: 50, height: 50 };
  const nodes = [frame, child, loose];
  const edges = [
    { id: 'in', source: 'f', target: 'c' },
    { id: 'out', source: 'c', target: 'l' },
  ];

  it('is the whole board when nothing is asked of the selection', () => {
    const all = exportSubset(nodes, edges, false);
    expect(all.nodes.map((n) => n.id)).toEqual(['f', 'c', 'l']);
    expect([...all.edgeIds]).toEqual(['in', 'out']);
    expect(all.bounds).toEqual({ x: 100, y: 100, width: 850, height: 850 });
  });

  it('keeps a selected container with what is inside it, and only the connectors between them', () => {
    const some = exportSubset(nodes, edges, true);
    expect(some.nodes.map((n) => n.id)).toEqual(['f', 'c']);
    expect([...some.edgeIds]).toEqual(['in']);
    expect(some.bounds).toEqual({ x: 100, y: 100, width: 400, height: 300 });
  });

  it('frames a framed child where it really is', () => {
    const only = exportSubset([frame, { ...child, selected: true }].map((n) => (n.id === 'f' ? { ...n, selected: false } : n)), [], true);
    expect(only.bounds).toEqual({ x: 120, y: 130, width: 100, height: 50 });
  });

  it('falls back to the whole board when selection-only is asked with nothing selected', () => {
    expect(exportSubset([loose], [], true).nodes.map((n) => n.id)).toEqual(['l']);
    expect(exportSubset([], [], true).bounds).toBeNull();
  });
});
