import { describe, expect, it } from 'vitest';
import { MARKER_GEOMETRY, computeMarkers, markerDepthPx, markerDefsForEdges } from './edgeMarkers';
import { CONNECTOR_STROKE_PX, DEFAULT_STROKE_WIDTH } from './defaults';
import type { ArrowStyle, ConnectorData } from '../types';

/** The fields every case needs, so each test states only its subject. */
const base = { stroke: '#ABCDEF', startArrowStyle: 'arrow', endArrowStyle: 'arrow' } as const;

/** A connector carrying `patch` on top of the defaults, as the store stores it. */
function edge(patch: Partial<ConnectorData> = {}) {
  return { data: { connectorType: 'straight', strokeStyle: 'solid', label: '', ...base, ...patch } as ConnectorData };
}

describe('computeMarkers', () => {
  it('names a marker after the style, colour and size it draws', () => {
    const { markerEnd } = computeMarkers({ ...base, strokeWidth: 3 });
    expect(markerEnd).toContain('arrow');
    expect(markerEnd).toContain('ABCDEF');
    expect(markerEnd).toContain('17');
  });

  it('leaves an end with no arrowhead unreferenced', () => {
    const markers = computeMarkers({ ...base, startArrowStyle: 'none', endArrowStyle: 'none' });
    expect(markers.markerStart).toBeUndefined();
    expect(markers.markerEnd).toBeUndefined();
  });

  it('gives each style its own marker', () => {
    const styles: ArrowStyle[] = ['arrow', 'open', 'circle', 'diamond', 'bar', 'halfcircle', 'dot'];
    const ids = styles.map((s) => computeMarkers({ ...base, endArrowStyle: s }).markerEnd);
    expect(new Set(ids).size).toBe(styles.length);
    for (const [i, style] of styles.entries()) expect(ids[i]).toContain(style);
  });

  it('points a connector saved before styles existed at one end arrow', () => {
    const markers = computeMarkers({ stroke: '#ABCDEF' });
    expect(markers.markerEnd).toBe(computeMarkers({ ...base, startArrowStyle: 'none' }).markerEnd);
    expect(markers.markerStart).toBeUndefined();
  });

  it('scales the arrowhead with the line it sits on', () => {
    for (const [width, size] of [[1, 10], [2, 13], [3, 17]] as const) {
      expect(computeMarkers({ ...base, strokeWidth: width }).markerEnd).toContain(`-${size}`);
    }
  });

  it('sizes an arrowhead on a connector saved before widths existed as a regular one', () => {
    expect(computeMarkers(base).markerEnd).toBe(computeMarkers({ ...base, strokeWidth: 2 }).markerEnd);
  });

  it('shares one marker between two ends that draw the same thing', () => {
    const { markerStart, markerEnd } = computeMarkers(base);
    expect(markerStart).toBe(markerEnd);
  });

  it('produces an id an SVG will accept', () => {
    const { markerEnd } = computeMarkers({ ...base, stroke: 'rgb(1, 2, 3)' });
    expect(markerEnd).toMatch(/^[A-Za-z][\w-]*$/);
  });
});

describe('markerDefsForEdges', () => {
  it('describes every marker the given connectors reference', () => {
    const defs = markerDefsForEdges([edge({ endArrowStyle: 'circle', startArrowStyle: 'none' })]);
    expect(defs).toEqual([
      { id: computeMarkers({ ...base, endArrowStyle: 'circle' }).markerEnd, style: 'circle', color: '#ABCDEF', size: 13 },
    ]);
  });

  it('emits one def per distinct style, colour and size, however many edges share it', () => {
    const defs = markerDefsForEdges([edge(), edge(), edge({ stroke: '#111111' })]);
    expect(defs).toHaveLength(2);
    expect(defs.map((d) => d.color).sort()).toEqual(['#111111', '#ABCDEF']);
  });

  it('covers both ends of a connector wearing two different arrowheads', () => {
    const defs = markerDefsForEdges([edge({ startArrowStyle: 'diamond', endArrowStyle: 'open' })]);
    expect(defs.map((d) => d.style).sort()).toEqual(['diamond', 'open']);
  });

  it('describes nothing for connectors with no arrowheads at all', () => {
    expect(markerDefsForEdges([edge({ startArrowStyle: 'none', endArrowStyle: 'none' })])).toEqual([]);
    expect(markerDefsForEdges([])).toEqual([]);
  });

  it('falls back to the same defaults the markers themselves do', () => {
    // No `data` at all — an edge mid-migration must not crash the defs layer.
    expect(markerDefsForEdges([{ data: undefined }])).toEqual([]);
  });

  it('orders defs stably, so React does not rebuild them on every render', () => {
    const a = markerDefsForEdges([edge({ stroke: '#111111' }), edge({ stroke: '#222222' })]);
    const b = markerDefsForEdges([edge({ stroke: '#222222' }), edge({ stroke: '#111111' })]);
    expect(a).toEqual(b);
  });
});

describe('CONNECTOR_STROKE_PX', () => {
  it('runs thin, regular, bold', () => {
    expect(CONNECTOR_STROKE_PX[1]).toBeLessThan(CONNECTOR_STROKE_PX[2]);
    expect(CONNECTOR_STROKE_PX[2]).toBeLessThan(CONNECTOR_STROKE_PX[3]);
  });

  it('draws a connector that never picked a width as a regular one', () => {
    // The regular width is the look of every connector saved before widths
    // existed, so changing this number restyles old diagrams — which is what
    // the Whimsical-look pass deliberately did, once. Change it knowingly.
    expect(CONNECTOR_STROKE_PX[DEFAULT_STROKE_WIDTH]).toBe(4);
  });
});

describe('markerDepthPx', () => {
  it('reaches nothing for no head and a bar, and a head\'s depth of its size otherwise', () => {
    expect(markerDepthPx('none', 2)).toBe(0);
    expect(markerDepthPx(undefined, undefined)).toBe(0);
    expect(markerDepthPx('bar', 2)).toBe(0);
    expect(markerDepthPx('arrow', 2)).toBeCloseTo(13 * 0.8);
    expect(markerDepthPx('arrow', 3)).toBeCloseTo(17 * 0.8);
    expect(markerDepthPx('diamond', 1)).toBe(10);
  });

  it('keeps every marker inside its box: the reference point plus the depth is the tip', () => {
    for (const [style, g] of Object.entries(MARKER_GEOMETRY)) {
      expect(g.refX + g.depth * 10, style).toBeLessThanOrEqual(10);
      expect(g.refX, style).toBeGreaterThanOrEqual(0);
    }
  });
});
