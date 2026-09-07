import { describe, expect, it } from 'vitest';
import { filterOptions, isWireFilterKind, narrowedIds, wireComponentOfFilterKind, wireFilterKind } from './selectionFilter';
import type { ShapeKind } from '../types';

const n = (id: string, shape: ShapeKind, fill: string, selected = true) => ({ id, selected, data: { shape, fill } });
/** A wireframe component. Its `data.shape` is a rectangle nothing draws. */
const w = (id: string, component: string, fill = '#EAEFF4', selected = true) => ({
  id,
  type: 'wire',
  selected,
  data: { shape: 'rectangle' as ShapeKind, fill, wire: { component } },
});
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

describe('wireframe components as their own buckets', () => {
  const mixed = [n('a', 'rectangle', '#DBEAFE'), w('b', 'button'), w('c', 'button'), w('d', 'input')];

  it('files a wire node under its component, never under the rectangle its data names', () => {
    expect(filterOptions(mixed).shapes).toEqual([
      { value: 'wire:button', count: 2 },
      { value: 'rectangle', count: 1 },
      { value: 'wire:input', count: 1 },
    ]);
  });

  it('narrows to one component', () => {
    expect([...narrowedIds(mixed, { shape: 'wire:button' })]).toEqual(['b', 'c']);
    // The shape bucket is unaffected by the wireframes sitting beside it.
    expect([...narrowedIds(mixed, { shape: 'rectangle' })]).toEqual(['a']);
  });

  it('files a component this build cannot name under its data’s shape instead', () => {
    const unknown = [w('x', 'hologram')];
    expect(filterOptions(unknown).shapes).toEqual([{ value: 'rectangle', count: 1 }]);
  });

  it('tells the two kinds of bucket key apart, `image` the shape from `image` the placeholder', () => {
    expect(isWireFilterKind('image')).toBe(false);
    expect(isWireFilterKind(wireFilterKind('image'))).toBe(true);
    expect(wireComponentOfFilterKind(wireFilterKind('image'))).toBe('image');
  });
});
