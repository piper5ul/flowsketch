import { describe, expect, it } from 'vitest';
import { DEFAULT_EDGE_STROKE, makeEdgeData } from './defaults';

describe('makeEdgeData', () => {
  it('builds a connector with the default styling and a single end arrow', () => {
    expect(makeEdgeData('elbow')).toEqual({
      connectorType: 'elbow',
      stroke: DEFAULT_EDGE_STROKE,
      strokeStyle: 'solid',
      label: '',
      startArrow: false,
      endArrow: true,
    });
  });

  it('carries the connector kind it was asked for', () => {
    expect(makeEdgeData('straight').connectorType).toBe('straight');
  });

  it('returns a fresh object each time, so edges never share data', () => {
    const a = makeEdgeData('elbow');
    const b = makeEdgeData('elbow');
    expect(a).not.toBe(b);
    a.label = 'mine';
    expect(b.label).toBe('');
  });
});
