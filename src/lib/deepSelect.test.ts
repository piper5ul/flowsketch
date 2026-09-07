import { describe, expect, it } from 'vitest';
import { deepSelectTarget, type DeepSelectNode } from './deepSelect';

/** A group holding two shapes, with a third shape loose on the board. */
function board(selectedIds: string[] = []): DeepSelectNode[] {
  const nodes: DeepSelectNode[] = [
    { id: 'g1', type: 'group' },
    { id: 'a', type: 'shape', parentId: 'g1' },
    { id: 'b', type: 'shape', parentId: 'g1' },
    { id: 'loose', type: 'shape' },
  ];
  return nodes.map((n) => (selectedIds.includes(n.id) ? { ...n, selected: true } : n));
}

const meta = { metaKey: true };

describe('deepSelectTarget', () => {
  it('picks the member out of the group it was clicked in', () => {
    expect(deepSelectTarget(board(['g1']), 'a', meta)).toBe('a');
  });

  it('picks the member when nothing at all is selected', () => {
    expect(deepSelectTarget(board(), 'a', meta)).toBe('a');
  });

  it('reaches through nested groups', () => {
    const nodes: DeepSelectNode[] = [
      { id: 'outer', type: 'group', selected: true },
      { id: 'inner', type: 'group', parentId: 'outer' },
      { id: 'a', type: 'shape', parentId: 'inner' },
    ];
    expect(deepSelectTarget(nodes, 'a', meta)).toBe('a');
  });

  it('leaves a plain click alone', () => {
    expect(deepSelectTarget(board(['g1']), 'a', {})).toBeNull();
  });

  it('takes Ctrl for ⌘, the way the command registry does', () => {
    expect(deepSelectTarget(board(['g1']), 'a', { ctrlKey: true })).toBe('a');
  });

  it('stands down for ⌘⇧ and ⌘⌥, which mean something else', () => {
    expect(deepSelectTarget(board(['g1']), 'a', { metaKey: true, shiftKey: true })).toBeNull();
    expect(deepSelectTarget(board(['g1']), 'a', { metaKey: true, altKey: true })).toBeNull();
  });

  it('leaves ⌘ its multi-select meaning once something else is selected', () => {
    // A sibling in the same group…
    expect(deepSelectTarget(board(['b']), 'a', meta)).toBeNull();
    // …a shape from elsewhere on the board…
    expect(deepSelectTarget(board(['loose']), 'a', meta)).toBeNull();
    // …and the group plus something else.
    expect(deepSelectTarget(board(['g1', 'loose']), 'a', meta)).toBeNull();
  });

  it('leaves ⌘ its multi-select meaning while a connector is selected', () => {
    expect(deepSelectTarget(board(['g1']), 'a', meta, true)).toBeNull();
  });

  it('is a no-op on a member that is already the whole selection', () => {
    expect(deepSelectTarget(board(['a']), 'a', meta)).toBe('a');
  });

  it('says nothing about a shape that is in no group', () => {
    // On the board itself…
    expect(deepSelectTarget(board(['loose']), 'loose', meta)).toBeNull();
    // …and inside a frame, which is part of the drawing and selects its
    // contents by being clicked on them.
    const framed: DeepSelectNode[] = [
      { id: 'f1', type: 'frame' },
      { id: 'a', type: 'shape', parentId: 'f1' },
    ];
    expect(deepSelectTarget(framed, 'a', meta)).toBeNull();
  });

  it('finds the group even under a frame in the chain', () => {
    const nodes: DeepSelectNode[] = [
      { id: 'f1', type: 'frame' },
      { id: 'g1', type: 'group', parentId: 'f1' },
      { id: 'a', type: 'shape', parentId: 'g1' },
    ];
    expect(deepSelectTarget(nodes, 'a', meta)).toBe('a');
  });

  it('answers null for a node that is not there', () => {
    expect(deepSelectTarget(board(), 'nope', meta)).toBeNull();
  });

  it('survives a parent chain that loops back on itself', () => {
    const nodes: DeepSelectNode[] = [
      { id: 'a', type: 'shape', parentId: 'b' },
      { id: 'b', type: 'shape', parentId: 'a' },
    ];
    expect(deepSelectTarget(nodes, 'a', meta)).toBeNull();
  });
});
