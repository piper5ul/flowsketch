import { describe, expect, it } from 'vitest';
import { connectorAriaLabel, withConnectorAriaLabels } from './connectorAria';

describe('connectorAriaLabel', () => {
  it('names a connector after the shapes it joins', () => {
    expect(connectorAriaLabel('Start', 'End')).toBe('Connector from Start to End');
  });

  it('says only the ends that have a label', () => {
    expect(connectorAriaLabel('Start', '')).toBe('Connector from Start');
    expect(connectorAriaLabel(undefined, 'End')).toBe('Connector to End');
    // A floating arrow's two anchors carry no label at all.
    expect(connectorAriaLabel('', '  ')).toBe('Connector');
  });

  it('reads a multi-line label as one line', () => {
    expect(connectorAriaLabel('Log\n  in', 'Home')).toBe('Connector from Log in to Home');
  });
});

describe('withConnectorAriaLabels', () => {
  const labels = new Map([['a', 'Alpha'], ['b', 'Beta']]);
  const labelOf = (id: string) => labels.get(id);
  const edges: { id: string; source: string; target: string; ariaLabel?: string }[] = [
    { id: 'e1', source: 'a', target: 'b' },
  ];

  it('labels each edge without touching the store edge', () => {
    const out = withConnectorAriaLabels(edges, labelOf, []);
    expect(out[0]).toEqual({ id: 'e1', source: 'a', target: 'b', ariaLabel: 'Connector from Alpha to Beta' });
    expect(edges[0]).not.toHaveProperty('ariaLabel');
  });

  it('hands back the very same array when no name changed', () => {
    const first = withConnectorAriaLabels(edges, labelOf, []);
    expect(withConnectorAriaLabels(edges, labelOf, first)).toBe(first);
  });

  it('makes a new copy only for the edge whose name changed', () => {
    const two = [...edges, { id: 'e2', source: 'b', target: 'b' }];
    const first = withConnectorAriaLabels(two, labelOf, []);
    const renamed = new Map(labels).set('a', 'Aleph');
    const second = withConnectorAriaLabels(two, (id) => renamed.get(id), first);
    expect(second).not.toBe(first);
    expect(second[0].ariaLabel).toBe('Connector from Aleph to Beta');
    expect(second[0]).not.toBe(first[0]);
    expect(second[1]).toBe(first[1]);
  });
});
