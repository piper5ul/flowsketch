import { beforeEach, describe, expect, it } from 'vitest';
import { computeMarkers, useDiagramStore } from './useDiagramStore';

const store = () => useDiagramStore.getState();

/** Select exactly the given node ids (and no edges). */
function select(...ids: string[]) {
  const set = new Set(ids);
  useDiagramStore.setState((s) => ({
    nodes: s.nodes.map((n) => ({ ...n, selected: set.has(n.id) })),
    edges: s.edges.map((e) => ({ ...e, selected: false })),
  }));
}

beforeEach(() => {
  // loadDiagram is the only public way to reset the module-level undo history.
  store().loadDiagram('test', 'Test', false, { nodes: [], edges: [] });
});

describe('addShape', () => {
  it('adds a node with the shape\'s default size and the current default colors', () => {
    const id = store().addShape('rectangle', { x: 10, y: 20 });
    const node = store().nodes.find((n) => n.id === id)!;
    expect(node).toMatchObject({
      type: 'shape',
      position: { x: 10, y: 20 },
      width: 180,
      height: 100,
      data: { shape: 'rectangle', label: '', fill: store().defaultFill, stroke: store().defaultStroke },
    });
  });

  it('gives sticky notes and text their own fixed styling', () => {
    const stickyId = store().addShape('sticky', { x: 0, y: 0 });
    const sticky = store().nodes.find((n) => n.id === stickyId)!;
    expect(sticky.data).toMatchObject({ fill: '#FBF3D0', stroke: '#E9B10A' });

    const textId = store().addShape('text', { x: 0, y: 0 });
    const text = store().nodes.find((n) => n.id === textId)!;
    expect(text.data).toMatchObject({ fill: 'transparent', stroke: 'transparent' });
    expect(store().editingNodeId).toBe(textId);
  });
});

describe('undo / redo', () => {
  it('reverts and re-applies an added shape', () => {
    store().addShape('rectangle', { x: 0, y: 0 });
    expect(store().nodes).toHaveLength(1);

    store().undo();
    expect(store().nodes).toHaveLength(0);

    store().redo();
    expect(store().nodes).toHaveLength(1);
  });

  it('is a no-op with an empty history', () => {
    store().undo();
    store().redo();
    expect(store().nodes).toHaveLength(0);
  });

  it('clears the redo stack when a new change is made', () => {
    store().addShape('rectangle', { x: 0, y: 0 });
    store().undo();
    store().addShape('ellipse', { x: 0, y: 0 });
    store().redo();
    expect(store().nodes).toHaveLength(1);
    expect(store().nodes[0].data.shape).toBe('ellipse');
  });

  it('starts fresh when a different diagram is loaded', () => {
    store().addShape('rectangle', { x: 0, y: 0 });
    store().loadDiagram('other', 'Other', false, { nodes: [], edges: [] });
    store().undo();
    expect(store().nodes).toHaveLength(0);
  });

  // Roadmap item "undo-coverage": updateNodeData does not push history yet, so
  // undoing after a text edit reverts the *previous* change (the add) instead.
  // This test is expected to fail today; remove `.fails` when the fix lands.
  it.fails('reverts a label edit made through updateNodeData', () => {
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    store().updateNodeData(id, { label: 'hello' });
    store().undo();
    expect(store().nodes).toHaveLength(1);
    expect(store().nodes[0].data.label).toBe('');
  });
});

describe('deleteSelection', () => {
  it('removes selected nodes and any edge touching them', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addConnectedShape(a, 'right')!;
    const c = store().addShape('rectangle', { x: 500, y: 0 });
    expect(store().edges).toHaveLength(1);

    select(b);
    store().deleteSelection();

    expect(store().nodes.map((n) => n.id)).toEqual([a, c]);
    expect(store().edges).toHaveLength(0);
  });

  it('never deletes a locked node', () => {
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    select(id);
    store().toggleLock();
    store().deleteSelection();
    expect(store().nodes).toHaveLength(1);
    expect(store().nodes[0].data.locked).toBe(true);
  });
});

describe('onNodesChange with locked nodes', () => {
  it('ignores position changes for a locked node but still allows selection', () => {
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    select(id);
    store().toggleLock();

    store().onNodesChange([{ type: 'position', id, position: { x: 999, y: 999 }, dragging: false }]);
    expect(store().nodes[0].position).toEqual({ x: 0, y: 0 });

    store().onNodesChange([{ type: 'select', id, selected: false }]);
    expect(store().nodes[0].selected).toBe(false);
  });
});

describe('z-order', () => {
  function ids() {
    return store().nodes.map((n) => n.id);
  }

  it('bringToFront moves the selection to the end of the array', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addShape('rectangle', { x: 0, y: 0 });
    const c = store().addShape('rectangle', { x: 0, y: 0 });
    select(a);
    store().bringToFront();
    expect(ids()).toEqual([b, c, a]);
  });

  it('sendToBack moves the selection to the start of the array', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addShape('rectangle', { x: 0, y: 0 });
    const c = store().addShape('rectangle', { x: 0, y: 0 });
    select(c);
    store().sendToBack();
    expect(ids()).toEqual([c, a, b]);
  });

  it('bringForward / sendBackward step one position at a time', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addShape('rectangle', { x: 0, y: 0 });
    const c = store().addShape('rectangle', { x: 0, y: 0 });
    select(a);
    store().bringForward();
    expect(ids()).toEqual([b, a, c]);
    store().sendBackward();
    expect(ids()).toEqual([a, b, c]);
  });
});

describe('addConnectedShape', () => {
  it('places the neighbor to the right with a gap and connects it', () => {
    const a = store().addShape('rectangle', { x: 100, y: 100 });
    const b = store().addConnectedShape(a, 'right')!;
    const nb = store().nodes.find((n) => n.id === b)!;
    expect(nb.position).toEqual({ x: 100 + 180 + 90, y: 100 });
    expect(nb.selected).toBe(true);
    expect(nb.data.shape).toBe('rectangle');

    const edge = store().edges[0];
    expect(edge).toMatchObject({ source: a, target: b, sourceHandle: 'right', targetHandle: 'left', type: 'connector' });
    expect(edge.markerEnd).toBeDefined();
    expect(edge.markerStart).toBeUndefined();
  });

  it('returns null for an unknown source', () => {
    expect(store().addConnectedShape('nope', 'right')).toBeNull();
    expect(store().nodes).toHaveLength(0);
  });
});

describe('duplicateSelectedInPlace', () => {
  it('clones selected nodes and the edges between them with fresh ids', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addConnectedShape(a, 'right')!;
    select(a, b);
    store().duplicateSelectedInPlace();

    expect(store().nodes).toHaveLength(4);
    expect(store().edges).toHaveLength(2);
    const allIds = new Set(store().nodes.map((n) => n.id));
    expect(allIds.size).toBe(4);

    const clonedEdge = store().edges.find((e) => e.source !== a)!;
    expect(clonedEdge.source).not.toBe(a);
    expect(clonedEdge.target).not.toBe(b);
    expect(allIds.has(clonedEdge.source)).toBe(true);
    expect(allIds.has(clonedEdge.target)).toBe(true);
  });
});

describe('updateSelectedNodesStyle', () => {
  it('restyles the selection and makes that style the new default', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addShape('rectangle', { x: 0, y: 0 });
    select(a);
    store().updateSelectedNodesStyle({ fill: '#111111', stroke: '#222222' });

    expect(store().nodes[0].data).toMatchObject({ fill: '#111111', stroke: '#222222' });
    expect(store().nodes[1].data.fill).not.toBe('#111111');
    expect(store().defaultFill).toBe('#111111');
    expect(store().defaultStroke).toBe('#222222');
  });
});

describe('computeMarkers', () => {
  it('emits colored arrowheads only for the enabled ends', () => {
    const both = computeMarkers({ stroke: '#ABCDEF', startArrow: true, endArrow: true });
    expect(both.markerStart).toMatchObject({ color: '#ABCDEF' });
    expect(both.markerEnd).toMatchObject({ color: '#ABCDEF' });

    const none = computeMarkers({ stroke: '#ABCDEF', startArrow: false, endArrow: false });
    expect(none.markerStart).toBeUndefined();
    expect(none.markerEnd).toBeUndefined();
  });
});

describe('loadDiagram', () => {
  it('rehydrates arrowhead markers from edge data', () => {
    store().loadDiagram('d', 'D', true, {
      nodes: [],
      edges: [{ id: 'e1', source: 'a', target: 'b', type: 'connector', data: { stroke: '#123456', startArrow: false, endArrow: true } }],
    });
    expect(store().title).toBe('D');
    expect(store().starred).toBe(true);
    expect(store().edges[0].markerEnd).toMatchObject({ color: '#123456' });
  });
});
