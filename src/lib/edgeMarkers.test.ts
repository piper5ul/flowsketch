import { describe, expect, it } from 'vitest';
import { computeMarkers } from './edgeMarkers';
import { CONNECTOR_STROKE_PX, DEFAULT_STROKE_WIDTH } from './defaults';

/** The arrow flags and colour every case needs, so each test states only its subject. */
const base = { stroke: '#ABCDEF', startArrow: true, endArrow: true } as const;

describe('computeMarkers', () => {
  it('emits colored arrowheads only for the enabled ends', () => {
    const both = computeMarkers(base);
    expect(both.markerStart).toMatchObject({ color: '#ABCDEF' });
    expect(both.markerEnd).toMatchObject({ color: '#ABCDEF' });

    const none = computeMarkers({ ...base, startArrow: false, endArrow: false });
    expect(none.markerStart).toBeUndefined();
    expect(none.markerEnd).toBeUndefined();
  });

  it('scales the arrowhead with the line it sits on', () => {
    expect(computeMarkers({ ...base, strokeWidth: 1 }).markerEnd).toMatchObject({ width: 8, height: 8 });
    expect(computeMarkers({ ...base, strokeWidth: 2 }).markerEnd).toMatchObject({ width: 10, height: 10 });
    expect(computeMarkers({ ...base, strokeWidth: 3 }).markerEnd).toMatchObject({ width: 14, height: 14 });
  });

  it('sizes an arrowhead on a connector saved before widths existed as a regular one', () => {
    expect(computeMarkers(base).markerEnd).toEqual(computeMarkers({ ...base, strokeWidth: 2 }).markerEnd);
  });

  it('gives both ends of one connector the same arrowhead', () => {
    const { markerStart, markerEnd } = computeMarkers({ ...base, strokeWidth: 3 });
    expect(markerStart).toEqual(markerEnd);
  });
});

describe('CONNECTOR_STROKE_PX', () => {
  it('runs thin, regular, bold', () => {
    expect(CONNECTOR_STROKE_PX[1]).toBeLessThan(CONNECTOR_STROKE_PX[2]);
    expect(CONNECTOR_STROKE_PX[2]).toBeLessThan(CONNECTOR_STROKE_PX[3]);
  });

  it('leaves a connector that never picked a width drawn exactly as before', () => {
    expect(CONNECTOR_STROKE_PX[DEFAULT_STROKE_WIDTH]).toBe(2.5);
  });
});
