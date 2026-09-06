import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('reverts a label edit made through updateNodeData', () => {
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    store().updateNodeData(id, { label: 'hello' });
    store().undo();
    expect(store().nodes).toHaveLength(1);
    expect(store().nodes[0].data.label).toBe('');
  });

  it('does not record an entry for an update that changes nothing', () => {
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    store().updateNodeData(id, { label: 'hello' });
    // A contentEditable blur commits the same text again — that must not
    // cost the user an extra ⌘Z.
    store().updateNodeData(id, { label: 'hello' });

    store().undo();
    expect(store().nodes[0].data.label).toBe('');
    store().undo();
    expect(store().nodes).toHaveLength(0);
  });

  it('reverts a connector label edit made through updateEdgeData', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addConnectedShape(a, 'right');
    const edgeId = store().edges[0].id;

    store().updateEdgeData(edgeId, { label: 'yes' });
    expect(store().edges[0].data!.label).toBe('yes');

    store().undo();
    expect(store().edges[0].data!.label).toBe('');
  });

  it('records exactly one entry for a drag of transient edge updates', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addConnectedShape(a, 'right');
    const edgeId = store().edges[0].id;

    store().beginInteraction();
    for (const x of [10, 20, 30]) {
      store().updateEdgeDataTransient(edgeId, { waypoint: { x, y: 0 } });
    }
    expect(store().edges[0].data!.waypoint).toEqual({ x: 30, y: 0 });

    store().undo();
    expect(store().edges[0].data!.waypoint).toBeUndefined();
    // One entry only: the two shapes from before the drag are still there.
    expect(store().nodes).toHaveLength(2);
  });

  it('does not record an entry for transient node moves', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().moveNodesTransient({ [a]: { x: 50, y: 50 } });
    expect(store().nodes[0].position).toEqual({ x: 50, y: 50 });

    store().undo();
    expect(store().nodes).toHaveLength(0);
  });
});

describe('nudgeSelected', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves only the selected nodes', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addShape('rectangle', { x: 100, y: 100 });
    select(a);
    store().nudgeSelected(1, -1);

    expect(store().nodes[0].position).toEqual({ x: 1, y: -1 });
    expect(store().nodes[1].position).toEqual({ x: 100, y: 100 });
  });

  it('coalesces consecutive nudges into a single history entry', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    select(a);

    store().nudgeSelected(1, 0);
    vi.advanceTimersByTime(200);
    store().nudgeSelected(1, 0);
    vi.advanceTimersByTime(200);
    store().nudgeSelected(1, 0);
    expect(store().nodes[0].position.x).toBe(3);

    store().undo();
    expect(store().nodes[0].position.x).toBe(0);
  });

  it('starts a new history entry after a pause', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    select(a);

    store().nudgeSelected(1, 0);
    vi.advanceTimersByTime(600);
    store().nudgeSelected(1, 0);
    expect(store().nodes[0].position.x).toBe(2);

    store().undo();
    expect(store().nodes[0].position.x).toBe(1);
    store().undo();
    expect(store().nodes[0].position.x).toBe(0);
  });

  it('does nothing without a selection', () => {
    store().addShape('rectangle', { x: 0, y: 0 });
    store().nudgeSelected(1, 0);
    expect(store().nodes[0].position).toEqual({ x: 0, y: 0 });

    store().undo();
    expect(store().nodes).toHaveLength(0);
  });
});

describe('duplicateSelection', () => {
  it('offsets the clones, gives them fresh ids and remaps the edges between them', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addConnectedShape(a, 'right')!;
    const originalEdgeId = store().edges[0].id;
    select(a, b);
    store().duplicateSelection();

    expect(store().nodes).toHaveLength(4);
    expect(store().edges).toHaveLength(2);
    expect(new Set(store().nodes.map((n) => n.id)).size).toBe(4);

    const clones = store().nodes.filter((n) => n.selected);
    expect(clones).toHaveLength(2);
    expect(clones.some((n) => n.position.x === 30 && n.position.y === 30)).toBe(true);

    const cloneIds = new Set(clones.map((n) => n.id));
    const clonedEdge = store().edges.find((e) => e.id !== originalEdgeId)!;
    expect(cloneIds.has(clonedEdge.source)).toBe(true);
    expect(cloneIds.has(clonedEdge.target)).toBe(true);
  });

  it('is undoable', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    select(a);
    store().duplicateSelection();
    expect(store().nodes).toHaveLength(2);

    store().undo();
    expect(store().nodes).toHaveLength(1);
  });
});

describe('pasteClipboard', () => {
  /** Build a clipboard payload the way Canvas's ⌘C handler does. */
  function clipOf(...ids: string[]) {
    const set = new Set(ids);
    return {
      nodes: store().nodes.filter((n) => set.has(n.id)).map((n) => ({ ...n, selected: false })),
      edges: store()
        .edges.filter((e) => set.has(e.source) && set.has(e.target))
        .map((e) => ({ ...e, selected: false })),
    };
  }

  it('pastes fresh ids at an offset with edges remapped, and is undoable', () => {
    const a = store().addShape('rectangle', { x: 10, y: 10 });
    const b = store().addConnectedShape(a, 'right')!;
    const originalEdgeId = store().edges[0].id;
    const clip = clipOf(a, b);

    store().pasteClipboard(clip);

    expect(store().nodes).toHaveLength(4);
    expect(store().edges).toHaveLength(2);
    const pasted = store().nodes.filter((n) => n.selected);
    expect(pasted).toHaveLength(2);
    expect(pasted.some((n) => n.id === a || n.id === b)).toBe(false);
    expect(pasted.some((n) => n.position.x === 40 && n.position.y === 40)).toBe(true);

    const pastedIds = new Set(pasted.map((n) => n.id));
    const pastedEdge = store().edges.find((e) => e.id !== originalEdgeId)!;
    expect(pastedIds.has(pastedEdge.source)).toBe(true);
    expect(pastedIds.has(pastedEdge.target)).toBe(true);

    store().undo();
    expect(store().nodes).toHaveLength(2);
    expect(store().edges).toHaveLength(1);
  });

  it('returns the pasted content so a repeated paste keeps stepping away', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });

    const next = store().pasteClipboard(clipOf(a));
    expect(next.nodes[0].position).toEqual({ x: 30, y: 30 });

    store().pasteClipboard(next);
    expect(store().nodes.map((n) => n.position.x).sort((x, y) => x - y)).toEqual([0, 30, 60]);
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
