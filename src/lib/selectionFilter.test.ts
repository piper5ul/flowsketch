import { describe, expect, it } from 'vitest';
import { filterOptions, narrowedIds } from './selectionFilter';
import type { ShapeKind } from '../types';

const n = (id: string, shape: ShapeKind, fill: string, selected = true) => ({ id, selected, data: { shape, fill } });
const nodes = [
  n('a', 'rectangle', '#DBEAFE'),
  n('b', 'rectangle', '#FEF3C7'),
  n('c', 'ellipse', '#dbeafe'),
  n('d', 'sticky', '#FEF3C7', false),
  n('e', 'text', 'transparent'),
];

describe('filterOptions', () => {
  it('counts the kinds and fills among the selected shapes, most common first', () => {
    const o = filterOptions(nodes);
    expect(o.shapes).toEqual([
      { value: 'rectangle', count: 2 },
      { value: 'ellipse', count: 1 },
      { value: 'text', count: 1 },
    ]);
    // Fills compare case-insensitively, and a transparent one is not a colour to filter by.
    expect(o.fills).toEqual([
      { value: '#DBEAFE', count: 2 },
      { value: '#FEF3C7', count: 1 },
    ]);
  });
});

describe('narrowedIds', () => {
  it('keeps the selected shapes that match, and only those', () => {
    expect([...narrowedIds(nodes, { shape: 'rectangle' })]).toEqual(['a', 'b']);
    expect([...narrowedIds(nodes, { fill: '#dbeafe' })]).toEqual(['a', 'c']);
    expect([...narrowedIds(nodes, { shape: 'rectangle', fill: '#FEF3C7' })]).toEqual(['b']);
    // An unselected match stays out: the filter narrows, it never widens.
    expect(narrowedIds(nodes, { shape: 'sticky' }).size).toBe(0);
  });
});
