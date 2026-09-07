import { describe, expect, it } from 'vitest';
import {
  MIND_MAP_LEVEL_GAP,
  MIND_MAP_NODE_SIZE,
  MIND_MAP_SIBLING_GAP,
  childCount,
  childrenOf,
  descendantIds,
  foldedCount,
  graphOf,
  hiddenMindMapIds,
  layoutMindMap,
  mapOf,
  nodesToHide,
  parentEdgeIndex,
  subtreePositionChanges,
  type MindMapEdgeLike,
  type MindMapNodeLike,
} from './mindMap';

const { width: W, height: H } = MIND_MAP_NODE_SIZE;

/** A mind-map node of the default size, at the origin unless told otherwise. */
function node(
  id: string,
  root: string,
  options: { x?: number; y?: number; collapsed?: boolean; height?: number } = {},
): MindMapNodeLike {
  return {
    id,
    position: { x: options.x ?? 0, y: options.y ?? 0 },
    width: W,
    height: options.height ?? H,
    data: { mindMap: { root, ...(options.collapsed ? { collapsed: true } : {}) } },
  };
}

/** An ordinary shape — no `mindMap` in its data. */
function plain(id: string, x = 0, y = 0): MindMapNodeLike {
  return { id, position: { x, y }, width: 180, height: 100, data: {} };
}

function branch(id: string, source: string, target: string): MindMapEdgeLike {
  return { id, source, target, data: { role: 'mindmap' } };
}

function line(id: string, source: string, target: string): MindMapEdgeLike {
  return { id, source, target, data: {} };
}

/** root -> a, b; a -> a1. */
function sampleMap() {
  const nodes = [node('root', 'root'), node('a', 'root'), node('b', 'root'), node('a1', 'root')];
  const edges = [branch('e1', 'root', 'a'), branch('e2', 'root', 'b'), branch('e3', 'a', 'a1')];
  return { nodes, edges };
}

const sizesOf = (nodes: MindMapNodeLike[]) =>
  new Map(nodes.map((n) => [n.id, { width: n.width ?? W, height: n.height ?? H }]));

describe('graphOf', () => {
  it('reads parent -> child off the connectors that carry the role', () => {
    const { nodes, edges } = sampleMap();
    const graph = graphOf(nodes, edges);
    expect(graph.children.get('root')).toEqual(['a', 'b']);
    expect(graph.parent.get('a1')).toBe('a');
  });

  it('ignores an ordinary connector, and one that reaches a shape outside the map', () => {
    const nodes = [node('root', 'root'), node('a', 'root'), plain('p')];
    const graph = graphOf(nodes, [line('e1', 'root', 'a'), branch('e2', 'root', 'p')]);
    expect(graph.parent.size).toBe(0);
  });

  it('keeps the first parent a child is given, so a second one cannot make a cycle', () => {
    const nodes = [node('root', 'root'), node('a', 'root'), node('b', 'root')];
    const graph = graphOf(nodes, [
      branch('e1', 'root', 'a'),
      branch('e2', 'root', 'b'),
      branch('e3', 'b', 'a'),
    ]);
    expect(graph.parent.get('a')).toBe('root');
    expect(graph.children.get('b')).toBeUndefined();
  });
});

describe('mapOf', () => {
  it('walks the map from its root, children in edge order', () => {
    const { nodes, edges } = sampleMap();
    const tree = mapOf(nodes, edges, 'root')!;
    expect(tree.ids).toEqual(['root', 'a', 'a1', 'b']);
    expect(childrenOf(tree, 'root')).toEqual(['a', 'b']);
    expect(descendantIds(tree, 'root')).toEqual(['a', 'a1', 'b']);
  });

  it('follows the edge array when a sibling is spliced in above another', () => {
    const { nodes, edges } = sampleMap();
    // Child order *is* edge order: inserting the branch before `e1` puts the
    // new node above `a`.
    const spliced = [branch('e0', 'root', 'c'), ...edges];
    const tree = mapOf([...nodes, node('c', 'root')], spliced, 'root')!;
    expect(childrenOf(tree, 'root')).toEqual(['c', 'a', 'b']);
  });

  it('answers null for a node that is not a mind-map node, and for one that is not there', () => {
    const { nodes, edges } = sampleMap();
    expect(mapOf([...nodes, plain('p')], edges, 'p')).toBeNull();
    expect(mapOf(nodes, edges, 'nope')).toBeNull();
  });

  it('survives a cycle in stored JSON rather than recursing forever', () => {
    const nodes = [node('root', 'root'), node('a', 'root')];
    const tree = mapOf(nodes, [branch('e1', 'root', 'a'), branch('e2', 'a', 'root')], 'root')!;
    expect(tree.ids).toEqual(['root', 'a']);
  });
});

describe('layoutMindMap', () => {
  it('grows to the right, one level per generation', () => {
    const { nodes, edges } = sampleMap();
    const tree = mapOf(nodes, edges, 'root')!;
    const at = layoutMindMap(tree, sizesOf(nodes));
    expect(at.get('root')!.x).toBe(0);
    expect(at.get('a')!.x).toBe(W + MIND_MAP_LEVEL_GAP);
    expect(at.get('b')!.x).toBe(W + MIND_MAP_LEVEL_GAP);
    expect(at.get('a1')!.x).toBe(2 * (W + MIND_MAP_LEVEL_GAP));
  });

  it('stacks siblings with one gap between them and centres the parent on them', () => {
    const nodes = [node('root', 'root'), node('a', 'root'), node('b', 'root')];
    const edges = [branch('e1', 'root', 'a'), branch('e2', 'root', 'b')];
    const at = layoutMindMap(mapOf(nodes, edges, 'root')!, sizesOf(nodes));

    expect(at.get('b')!.y - at.get('a')!.y).toBe(H + MIND_MAP_SIBLING_GAP);
    // The root's centre is the midpoint of its two children's centres.
    const centre = (id: string) => at.get(id)!.y + H / 2;
    expect(centre('root')).toBeCloseTo((centre('a') + centre('b')) / 2, 6);
  });

  it('keeps the root exactly where it was', () => {
    const { nodes, edges } = sampleMap();
    const tree = mapOf(nodes, edges, 'root')!;
    const at = layoutMindMap(tree, sizesOf(nodes), { x: 400, y: 250 });
    expect(at.get('root')).toEqual({ x: 400, y: 250 });
    // Everything else moves with it: the shape of the map is unchanged.
    const plain0 = layoutMindMap(tree, sizesOf(nodes));
    for (const id of tree.ids) {
      expect(at.get(id)).toEqual({
        x: plain0.get(id)!.x + 400,
        y: plain0.get(id)!.y + 250,
      });
    }
  });

  it('gives a collapsed subtree no room at all, and no position', () => {
    const nodes = [
      node('root', 'root'),
      node('a', 'root', { collapsed: true }),
      node('a1', 'root'),
      node('a2', 'root'),
      node('b', 'root'),
    ];
    const edges = [
      branch('e1', 'root', 'a'),
      branch('e2', 'a', 'a1'),
      branch('e3', 'a', 'a2'),
      branch('e4', 'root', 'b'),
    ];
    const at = layoutMindMap(mapOf(nodes, edges, 'root')!, sizesOf(nodes));

    expect(at.has('a1')).toBe(false);
    expect(at.has('a2')).toBe(false);
    // `a` and `b` are two ordinary siblings: the folded branch takes no space.
    expect(at.get('b')!.y - at.get('a')!.y).toBe(H + MIND_MAP_SIBLING_GAP);
  });

  it('lets a taller node push its own branch across, not the whole level', () => {
    const nodes = [
      node('root', 'root'),
      node('a', 'root', { height: 200 }),
      node('a1', 'root'),
      node('b', 'root'),
    ];
    const edges = [branch('e1', 'root', 'a'), branch('e2', 'a', 'a1'), branch('e3', 'root', 'b')];
    const at = layoutMindMap(mapOf(nodes, edges, 'root')!, sizesOf(nodes));
    // `a` owns a 200px row because it is taller than the single child under it,
    // so `b` clears its bottom edge by one gap rather than overlapping it.
    expect(at.get('b')!.y).toBe(at.get('a')!.y + 200 + MIND_MAP_SIBLING_GAP);
    // Its child is centred on it all the same.
    expect(at.get('a1')!.y + H / 2).toBeCloseTo(at.get('a')!.y + 100, 6);
  });
});

describe('hiddenMindMapIds', () => {
  it('hides every descendant of a collapsed node and nothing else', () => {
    const nodes = [
      node('root', 'root'),
      node('a', 'root', { collapsed: true }),
      node('a1', 'root'),
      node('a1x', 'root'),
      node('b', 'root'),
      plain('p'),
    ];
    const edges = [
      branch('e1', 'root', 'a'),
      branch('e2', 'a', 'a1'),
      branch('e3', 'a1', 'a1x'),
      branch('e4', 'root', 'b'),
    ];
    expect([...hiddenMindMapIds(nodes, edges)].sort()).toEqual(['a1', 'a1x']);
  });

  it('hides nothing on a board with no collapsed node, and none at all on one with no map', () => {
    const { nodes, edges } = sampleMap();
    expect(hiddenMindMapIds(nodes, edges).size).toBe(0);
    expect(hiddenMindMapIds([plain('p'), plain('q')], [line('e', 'p', 'q')]).size).toBe(0);
  });

  it('agrees with the tree it is derived from', () => {
    const nodes = [node('root', 'root'), node('a', 'root', { collapsed: true }), node('a1', 'root')];
    const edges = [branch('e1', 'root', 'a'), branch('e2', 'a', 'a1')];
    expect(hiddenMindMapIds(nodes, edges)).toEqual(nodesToHide(mapOf(nodes, edges, 'root')!));
  });
});

describe('childCount and foldedCount', () => {
  it('count the branches leaving a node, and everything under it', () => {
    const { nodes, edges } = sampleMap();
    expect(childCount(edges, 'root')).toBe(2);
    expect(childCount(edges, 'a')).toBe(1);
    expect(childCount(edges, 'b')).toBe(0);
    expect(foldedCount(nodes, edges, 'root')).toBe(3);
    expect(foldedCount(nodes, edges, 'a')).toBe(1);
  });
});

describe('parentEdgeIndex', () => {
  it('finds the branch that ends at a node, which is where a sibling is spliced', () => {
    const { edges } = sampleMap();
    expect(parentEdgeIndex(edges, 'b')).toBe(1);
    expect(parentEdgeIndex(edges, 'root')).toBe(-1);
  });
});

describe('subtreePositionChanges', () => {
  const { nodes, edges } = sampleMap();

  it('moves a dragged node\'s descendants by the same delta', () => {
    const extra = subtreePositionChanges(
      [{ type: 'position', id: 'a', position: { x: 30, y: 40 }, dragging: true }],
      nodes,
      edges,
    );
    expect(extra).toEqual([
      { type: 'position', id: 'a1', position: { x: 30, y: 40 }, dragging: true },
    ]);
  });

  it('leaves a node that is already in the drag alone', () => {
    const extra = subtreePositionChanges(
      [
        { type: 'position', id: 'a', position: { x: 10, y: 0 } },
        { type: 'position', id: 'a1', position: { x: 99, y: 99 } },
      ],
      nodes,
      edges,
    );
    expect(extra).toEqual([]);
  });

  it('costs a board with no mind map, and a drag that moves nothing, nothing', () => {
    expect(subtreePositionChanges([{ type: 'select', id: 'a' }], nodes, edges)).toEqual([]);
    expect(
      subtreePositionChanges(
        [{ type: 'position', id: 'a', position: { x: 0, y: 0 } }],
        nodes,
        edges,
      ),
    ).toEqual([]);
    expect(
      subtreePositionChanges(
        [{ type: 'position', id: 'p', position: { x: 5, y: 5 } }],
        [plain('p')],
        [],
      ),
    ).toEqual([]);
  });
});
