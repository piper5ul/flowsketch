import { describe, expect, it } from 'vitest';
import {
  absolutePosition,
  boundsOf,
  innermostContaining,
  normalizeParentage,
  sortParentsFirst,
  subtreeIds,
  type Bounds,
  type TreeNode,
} from './nodeTree';

/** A node with a box, which is what the containment helpers want. */
interface Boxed extends TreeNode, Bounds {}

function node(id: string, x: number, y: number, parentId?: string): TreeNode {
  return { id, position: { x, y }, ...(parentId ? { parentId } : {}) };
}

function boxed(id: string, x: number, y: number, w: number, h: number, parentId?: string): Boxed {
  return { id, position: { x, y }, x, y, w, h, ...(parentId ? { parentId } : {}) };
}

function lookup<T extends TreeNode>(nodes: T[]): Map<string, T> {
  return new Map(nodes.map((n) => [n.id, n]));
}

function ids(nodes: TreeNode[]): string[] {
  return nodes.map((n) => n.id);
}

describe('absolutePosition', () => {
  it('is the node itself when it has no parent', () => {
    const nodes = [node('a', 10, 20)];
    expect(absolutePosition(nodes[0], lookup(nodes))).toEqual({ x: 10, y: 20 });
  });

  it('folds in every ancestor offset', () => {
    const nodes = [node('outer', 100, 200), node('inner', 10, 20, 'outer'), node('leaf', 1, 2, 'inner')];
    expect(absolutePosition(nodes[2], lookup(nodes))).toEqual({ x: 111, y: 222 });
  });

  it('stops rather than spinning on a parent chain that loops', () => {
    const nodes = [node('a', 1, 1, 'b'), node('b', 2, 2, 'a')];
    expect(absolutePosition(nodes[0], lookup(nodes))).toEqual({ x: 3, y: 3 });
  });

  it('stops at a parent that is not there', () => {
    const nodes = [node('a', 5, 5, 'gone')];
    expect(absolutePosition(nodes[0], lookup(nodes))).toEqual({ x: 5, y: 5 });
  });
});

describe('subtreeIds', () => {
  it('collects the roots and everything under them, however deep', () => {
    const nodes = [
      node('group', 0, 0),
      node('child', 0, 0, 'group'),
      node('grandchild', 0, 0, 'child'),
      node('elsewhere', 0, 0),
    ];
    expect([...subtreeIds(nodes, ['group'])].sort()).toEqual(['child', 'grandchild', 'group']);
  });

  it('returns just the roots when nothing hangs off them', () => {
    const nodes = [node('a', 0, 0), node('b', 0, 0)];
    expect([...subtreeIds(nodes, ['a'])]).toEqual(['a']);
  });
});

describe('sortParentsFirst', () => {
  it('leaves a diagram with no parents exactly as it was', () => {
    const nodes = [node('a', 0, 0), node('b', 0, 0), node('c', 0, 0)];
    expect(ids(sortParentsFirst(nodes))).toEqual(['a', 'b', 'c']);
  });

  it('pulls a parent ahead of children that were in front of it', () => {
    const nodes = [node('child', 0, 0, 'parent'), node('other', 0, 0), node('parent', 0, 0)];
    expect(ids(sortParentsFirst(nodes))).toEqual(['other', 'parent', 'child']);
  });

  it('keeps each subtree contiguous and in its given order', () => {
    const nodes = [
      node('frame', 0, 0),
      node('one', 0, 0, 'frame'),
      node('two', 0, 0, 'frame'),
      node('loose', 0, 0),
    ];
    expect(ids(sortParentsFirst(nodes))).toEqual(['frame', 'one', 'two', 'loose']);
  });

  it('keeps a node whose parent chain loops rather than dropping it', () => {
    const nodes = [node('a', 0, 0, 'b'), node('b', 0, 0, 'a')];
    expect(ids(sortParentsFirst(nodes)).sort()).toEqual(['a', 'b']);
  });
});

describe('normalizeParentage', () => {
  it('drops a parentId pointing at a node that is not there', () => {
    const [only] = normalizeParentage([node('a', 5, 5, 'gone')]);
    expect(only.parentId).toBeUndefined();
    expect(only.position).toEqual({ x: 5, y: 5 });
  });

  it('drops a node parented to itself', () => {
    const [only] = normalizeParentage([node('a', 0, 0, 'a')]);
    expect(only.parentId).toBeUndefined();
  });

  it('sorts what is left so parents come first', () => {
    const nodes = [node('child', 0, 0, 'parent'), node('parent', 0, 0)];
    expect(ids(normalizeParentage(nodes))).toEqual(['parent', 'child']);
  });

  it('leaves a well-formed array untouched', () => {
    const nodes = [node('parent', 0, 0), node('child', 0, 0, 'parent')];
    expect(normalizeParentage(nodes)).toEqual(nodes);
  });
});

describe('innermostContaining', () => {
  const outer = boxed('outer', 0, 0, 1000, 1000);
  const inner = boxed('inner', 100, 100, 400, 400, 'outer');
  const frames = [outer, inner];
  const byId = lookup<TreeNode>(frames);

  it('picks the deepest frame that holds the box', () => {
    const hit = innermostContaining({ x: 150, y: 150, w: 50, h: 50 }, frames, byId);
    expect(hit?.id).toBe('inner');
  });

  it('falls back to the outer frame when the inner one does not hold it', () => {
    const hit = innermostContaining({ x: 600, y: 600, w: 50, h: 50 }, frames, byId);
    expect(hit?.id).toBe('outer');
  });

  it('answers nothing when the box sticks out of every frame', () => {
    expect(innermostContaining({ x: 990, y: 990, w: 50, h: 50 }, frames, byId)).toBeUndefined();
  });

  it('requires the whole box to be inside, not just a corner', () => {
    // Overlaps `inner`'s bottom-right corner but is not contained by it.
    const hit = innermostContaining({ x: 460, y: 460, w: 100, h: 100 }, frames, byId);
    expect(hit?.id).toBe('outer');
  });

  it('prefers the smaller of two frames at the same depth', () => {
    const wide = boxed('wide', 0, 0, 800, 800);
    const tight = boxed('tight', 0, 0, 300, 300);
    const hit = innermostContaining({ x: 10, y: 10, w: 20, h: 20 }, [wide, tight], lookup<TreeNode>([wide, tight]));
    expect(hit?.id).toBe('tight');
  });
});

describe('boundsOf', () => {
  it('is null with nothing to bound', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('is the smallest box holding every rect', () => {
    expect(
      boundsOf([
        { x: 10, y: 20, w: 100, h: 50 },
        { x: 200, y: 0, w: 40, h: 200 },
      ]),
    ).toEqual({ x: 10, y: 0, w: 230, h: 200 });
  });
});
