import { describe, expect, it } from 'vitest';
import {
  applyLayout,
  canAutoLayout,
  layoutAnchors,
  layoutEdgesAmong,
  layoutGraphFor,
  layoutMembers,
  layoutOrigin,
  type LayoutEdge,
  type LayoutNode,
} from './autoLayout';
import { runElkLayout } from './elk';

function node(
  id: string,
  x: number,
  y: number,
  w = 100,
  h = 60,
  extra: Partial<LayoutNode> = {},
): LayoutNode {
  return {
    id,
    type: 'shape',
    position: { x, y },
    width: w,
    height: h,
    selected: true,
    data: { label: id, shape: 'rectangle', fill: '#DBEAFE', stroke: '#93C5FD' },
    ...extra,
  } as LayoutNode;
}

function edge(id: string, source: string, target: string): LayoutEdge {
  return { id, source, target };
}

/** A floating arrow's endpoint: 1×1 and invisible, never a box in a flow. */
function anchorNode(id: string, x: number, y: number): LayoutNode {
  return {
    id,
    type: 'shape',
    position: { x, y },
    width: 1,
    height: 1,
    selected: true,
    data: { label: '', shape: 'rectangle', fill: 'transparent', stroke: 'transparent' },
  } as LayoutNode;
}

const ids = (nodes: LayoutNode[]) => nodes.map((n) => n.id);
const selectedIds = (nodes: LayoutNode[]) => nodes.filter((n) => n.selected).map((n) => n.id);

describe('layoutMembers', () => {
  it('is the selected nodes, in node order', () => {
    const nodes = [node('a', 0, 0), node('b', 200, 0), node('c', 400, 0, 100, 60, { selected: false })];
    expect(ids(layoutMembers(nodes, selectedIds(nodes)))).toEqual(['a', 'b']);
  });

  it('skips a selected node whose ancestor is also selected', () => {
    // Moving the frame moves its child with it; laying out both would move the
    // child twice, which is the rule `arrange.ts` applies too.
    const nodes = [
      { ...node('f', 0, 0, 400, 300), type: 'frame' } as LayoutNode,
      node('inner', 20, 20, 100, 60, { parentId: 'f' }),
      node('outside', 600, 0),
    ];
    expect(ids(layoutMembers(nodes, selectedIds(nodes)))).toEqual(['f', 'outside']);
  });

  it('keeps a framed child whose frame is not selected', () => {
    const nodes = [
      { ...node('f', 0, 0, 400, 300, { selected: false }), type: 'frame' } as LayoutNode,
      node('inner', 20, 20, 100, 60, { parentId: 'f' }),
      node('outside', 600, 0),
    ];
    expect(ids(layoutMembers(nodes, selectedIds(nodes)))).toEqual(['inner', 'outside']);
  });

  it('drops a floating arrow’s invisible endpoints', () => {
    const nodes = [node('a', 0, 0), anchorNode('x', 300, 0), anchorNode('y', 500, 0)];
    expect(ids(layoutMembers(nodes, selectedIds(nodes)))).toEqual(['a']);
  });

  it('drops a node React Flow has not measured yet', () => {
    const nodes = [node('a', 0, 0), { ...node('b', 200, 0), width: undefined, height: undefined } as LayoutNode];
    expect(ids(layoutMembers(nodes, selectedIds(nodes)))).toEqual(['a']);
  });
});

describe('layoutEdgesAmong', () => {
  it('keeps only the connectors joining two members', () => {
    const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('cd', 'c', 'd')];
    const kept = layoutEdgesAmong(edges, new Set(['a', 'b', 'c']));
    expect(kept.map((e) => e.id)).toEqual(['ab', 'bc']);
  });
});

describe('canAutoLayout', () => {
  it('is true for two selected shapes with a connector between them', () => {
    const nodes = [node('a', 0, 0), node('b', 200, 0)];
    expect(canAutoLayout(nodes, [edge('ab', 'a', 'b')])).toBe(true);
  });

  it('is false with nothing joining the selection', () => {
    const nodes = [node('a', 0, 0), node('b', 200, 0)];
    expect(canAutoLayout(nodes, [])).toBe(false);
  });

  it('is false when the only connector reaches outside the selection', () => {
    const nodes = [node('a', 0, 0), node('b', 200, 0), node('c', 400, 0, 100, 60, { selected: false })];
    expect(canAutoLayout(nodes, [edge('bc', 'b', 'c')])).toBe(false);
  });

  it('is false for a single selected shape, connector or not', () => {
    const nodes = [node('a', 0, 0), node('b', 200, 0, 100, 60, { selected: false })];
    expect(canAutoLayout(nodes, [edge('ab', 'a', 'b')])).toBe(false);
  });

  it('is false for a frame and only its own children', () => {
    const nodes = [
      { ...node('f', 0, 0, 400, 300), type: 'frame' } as LayoutNode,
      node('inner', 20, 20, 100, 60, { parentId: 'f' }),
    ];
    expect(canAutoLayout(nodes, [edge('e', 'f', 'inner')])).toBe(false);
  });
});

describe('layoutGraphFor', () => {
  it('builds a graph of the members and the connectors between them', () => {
    const nodes = [node('a', 0, 0, 180, 70), node('b', 300, 0, 120, 90), node('c', 600, 0, 100, 60, { selected: false })];
    const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c')];
    const graph = layoutGraphFor(nodes, edges, selectedIds(nodes), 'DOWN')!;

    expect(graph.children).toEqual([
      { id: 'a', width: 180, height: 70 },
      { id: 'b', width: 120, height: 90 },
    ]);
    expect(graph.edges).toEqual([{ id: 'ab', sources: ['a'], targets: ['b'] }]);
    expect(graph.layoutOptions['elk.algorithm']).toBe('layered');
    expect(graph.layoutOptions['elk.direction']).toBe('DOWN');
    expect(graph.layoutOptions['elk.spacing.nodeNode']).toBe('48');
    expect(graph.layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers']).toBe('64');
  });

  it('carries the direction through to ELK', () => {
    const nodes = [node('a', 0, 0), node('b', 200, 0)];
    const graph = layoutGraphFor(nodes, [edge('ab', 'a', 'b')], selectedIds(nodes), 'RIGHT')!;
    expect(graph.layoutOptions['elk.direction']).toBe('RIGHT');
  });

  it('sizes a framed child from its own box, not its offset in the frame', () => {
    const nodes = [
      { ...node('f', 500, 400, 400, 300, { selected: false }), type: 'frame' } as LayoutNode,
      node('inner', 20, 20, 140, 80, { parentId: 'f' }),
      node('outside', 1200, 400, 100, 60),
    ];
    const graph = layoutGraphFor(nodes, [edge('e', 'inner', 'outside')], selectedIds(nodes), 'DOWN')!;
    expect(graph.children).toEqual([
      { id: 'inner', width: 140, height: 80 },
      { id: 'outside', width: 100, height: 60 },
    ]);
  });

  it('is null below two members', () => {
    const nodes = [node('a', 0, 0)];
    expect(layoutGraphFor(nodes, [], selectedIds(nodes), 'DOWN')).toBeNull();
  });

  it('is null when no connector joins two members', () => {
    const nodes = [node('a', 0, 0), node('b', 200, 0)];
    expect(layoutGraphFor(nodes, [], selectedIds(nodes), 'DOWN')).toBeNull();
  });
});

describe('layoutOrigin', () => {
  it('is the top-left of the members’ bounding box in board coordinates', () => {
    const nodes = [
      { ...node('f', 500, 400, 400, 300, { selected: false }), type: 'frame' } as LayoutNode,
      node('inner', 20, 30, 140, 80, { parentId: 'f' }),
      node('outside', 300, 900, 100, 60),
    ];
    expect(layoutOrigin(nodes, selectedIds(nodes))).toEqual({ x: 300, y: 430, w: 360, h: 530 });
  });

  it('is null with nothing selected', () => {
    expect(layoutOrigin([node('a', 0, 0, 100, 60, { selected: false })], [])).toBeNull();
  });
});

describe('applyLayout', () => {
  it('translates the whole result so its top-left lands on the anchor', () => {
    const nodes = [node('a', 0, 0), node('b', 0, 0)];
    const positions = applyLayout(
      nodes,
      [
        { id: 'a', x: 12, y: 12 },
        { id: 'b', x: 12, y: 200 },
      ],
      { x: 500, y: 400 },
    );
    expect(positions).toEqual({ a: { x: 500, y: 400 }, b: { x: 500, y: 588 } });
  });

  it('keeps the shape of the layout when ELK starts away from the origin', () => {
    const nodes = [node('a', 0, 0), node('b', 0, 0)];
    const positions = applyLayout(
      nodes,
      [
        { id: 'a', x: 40, y: 0 },
        { id: 'b', x: 0, y: 130 },
      ],
      { x: 0, y: 0 },
    );
    expect(positions).toEqual({ a: { x: 40, y: 0 }, b: { x: 0, y: 130 } });
  });

  it('converts a framed member back to a position relative to its frame', () => {
    const nodes = [
      { ...node('f', 500, 400, 400, 300, { selected: false }), type: 'frame' } as LayoutNode,
      node('inner', 20, 30, 140, 80, { parentId: 'f' }),
      node('outside', 300, 900, 100, 60),
    ];
    const positions = applyLayout(
      nodes,
      [
        { id: 'inner', x: 0, y: 0 },
        { id: 'outside', x: 0, y: 200 },
      ],
      { x: 520, y: 430 },
    );
    // The framed child stores an offset from the frame at (500, 400); the one
    // outside stores the board position itself.
    expect(positions).toEqual({ inner: { x: 20, y: 30 }, outside: { x: 520, y: 630 } });
  });

  it('rounds to whole pixels', () => {
    const nodes = [node('a', 0, 0), node('b', 0, 0)];
    const positions = applyLayout(
      nodes,
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 58.666666666666664, y: 130 },
      ],
      { x: 0, y: 0 },
    );
    expect(positions.b).toEqual({ x: 59, y: 130 });
  });

  it('drops a placement for a node that has since gone', () => {
    const nodes = [node('a', 0, 0)];
    const positions = applyLayout(nodes, [{ id: 'a', x: 0, y: 0 }, { id: 'gone', x: 0, y: 100 }], { x: 0, y: 0 });
    expect(Object.keys(positions)).toEqual(['a']);
  });

  it('is empty when nothing was laid out', () => {
    expect(applyLayout([node('a', 0, 0)], [], { x: 0, y: 0 })).toEqual({});
  });
});

describe('layoutAnchors', () => {
  it('pins a vertical flow bottom to top', () => {
    expect(layoutAnchors('DOWN')).toEqual({ source: { side: 'bottom', t: 0.5 }, target: { side: 'top', t: 0.5 } });
  });

  it('pins a horizontal flow right to left', () => {
    expect(layoutAnchors('RIGHT')).toEqual({ source: { side: 'right', t: 0.5 }, target: { side: 'left', t: 0.5 } });
  });
});

/**
 * The one test that actually runs the layout engine — everything above is our
 * own arithmetic. A three-node chain is the smallest graph whose answer is
 * unambiguous: it has exactly one layer order, so the assertion is about ELK's
 * direction rather than about a placement that could reasonably differ.
 */
describe('running elkjs', () => {
  const nodes = [node('a', 900, 40, 180, 70), node('b', 100, 500, 120, 90), node('c', 700, 300, 200, 60)];
  const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c')];

  it('lays a chain out top to bottom for DOWN', async () => {
    const graph = layoutGraphFor(nodes, edges, selectedIds(nodes), 'DOWN')!;
    const placed = await runElkLayout(graph);
    const positions = applyLayout(nodes, placed, { x: 0, y: 0 });

    expect(positions.a.y).toBeLessThan(positions.b.y);
    expect(positions.b.y).toBeLessThan(positions.c.y);
    // A chain is centred on one line, whatever the boxes' widths.
    const centre = (id: string, w: number) => positions[id].x + w / 2;
    expect(Math.abs(centre('a', 180) - centre('b', 120))).toBeLessThan(2);
    expect(Math.abs(centre('b', 120) - centre('c', 200))).toBeLessThan(2);
  });

  it('lays the same chain out left to right for RIGHT', async () => {
    const graph = layoutGraphFor(nodes, edges, selectedIds(nodes), 'RIGHT')!;
    const placed = await runElkLayout(graph);
    const positions = applyLayout(nodes, placed, { x: 0, y: 0 });

    expect(positions.a.x).toBeLessThan(positions.b.x);
    expect(positions.b.x).toBeLessThan(positions.c.x);
    const middle = (id: string, h: number) => positions[id].y + h / 2;
    expect(Math.abs(middle('a', 70) - middle('b', 90))).toBeLessThan(2);
    expect(Math.abs(middle('b', 90) - middle('c', 60))).toBeLessThan(2);
  });

  it('starts the flow at the selection’s own top-left corner', async () => {
    const graph = layoutGraphFor(nodes, edges, selectedIds(nodes), 'DOWN')!;
    const placed = await runElkLayout(graph);
    const origin = layoutOrigin(nodes, selectedIds(nodes))!;
    const positions = applyLayout(nodes, placed, origin);

    expect(Math.min(...Object.values(positions).map((p) => p.x))).toBe(origin.x);
    expect(Math.min(...Object.values(positions).map((p) => p.y))).toBe(origin.y);
  });
});
