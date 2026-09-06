import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeMarkers, serializeDiagram, useDiagramStore } from './useDiagramStore';
import { CURRENT_DIAGRAM_VERSION, migrateDiagramData } from '../lib/diagramMigrations';
import { SHAPE_KINDS } from '../lib/nodeKinds';
import { useToastStore } from './useToastStore';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { saveDiagram: vi.fn(async () => undefined) },
}));

const saveDiagram = vi.mocked(api.saveDiagram);

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

  it('has a default size for every shape kind', () => {
    // A kind with no entry would be placed as a zero-sized node the user cannot
    // find, so the table has to stay exhaustive as kinds are added.
    for (const kind of SHAPE_KINDS) {
      const id = store().addShape(kind, { x: 0, y: 0 });
      const node = store().nodes.find((n) => n.id === id)!;
      expect(node.width, kind).toBeGreaterThan(0);
      expect(node.height, kind).toBeGreaterThan(0);
    }
  });
});

describe('setSelectedShapeKind', () => {
  it('swaps the kind of every selected shape, keeping its label, size and colours', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addShape('ellipse', { x: 300, y: 0 });
    store().updateNodeData(a, { label: 'Start' });
    select(a, b);

    store().setSelectedShapeKind('diamond');

    const first = store().nodes.find((n) => n.id === a)!;
    expect(first.data).toMatchObject({
      shape: 'diamond',
      label: 'Start',
      fill: store().defaultFill,
      stroke: store().defaultStroke,
    });
    // The swap is about the outline, not the box: a rectangle keeps the 180×100
    // it was drawn at rather than snapping to the diamond's default size.
    expect({ width: first.width, height: first.height }).toEqual({ width: 180, height: 100 });
    expect(store().nodes.find((n) => n.id === b)!.data.shape).toBe('diamond');
  });

  it('swaps to a kind drawn as an SVG outline just as readily as to a CSS one', () => {
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    select(id);

    store().setSelectedShapeKind('star');

    expect(store().nodes.find((n) => n.id === id)!.data.shape).toBe('star');
  });

  it('leaves unselected shapes alone', () => {
    const selected = store().addShape('rectangle', { x: 0, y: 0 });
    const other = store().addShape('rectangle', { x: 300, y: 0 });
    select(selected);

    store().setSelectedShapeKind('hexagon');

    expect(store().nodes.find((n) => n.id === selected)!.data.shape).toBe('hexagon');
    expect(store().nodes.find((n) => n.id === other)!.data.shape).toBe('rectangle');
  });

  it('skips image, text and locked nodes', () => {
    const image = store().addImageNode({ src: '/api/images/x', width: 40, height: 40, position: { x: 0, y: 0 } });
    const text = store().addShape('text', { x: 100, y: 0 });
    const locked = store().addShape('rectangle', { x: 200, y: 0 });
    select(locked);
    store().toggleLock();

    const free = store().addShape('rectangle', { x: 300, y: 0 });
    select(image, text, locked, free);
    store().setSelectedShapeKind('pill');

    expect(store().nodes.find((n) => n.id === image)!.data.shape).toBe('image');
    expect(store().nodes.find((n) => n.id === text)!.data.shape).toBe('text');
    expect(store().nodes.find((n) => n.id === locked)!.data.shape).toBe('rectangle');
    expect(store().nodes.find((n) => n.id === free)!.data.shape).toBe('pill');
  });

  it('is undoable in one step', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addShape('rectangle', { x: 300, y: 0 });
    select(a, b);

    store().setSelectedShapeKind('sticky');
    store().undo();

    expect(store().nodes.map((n) => n.data.shape)).toEqual(['rectangle', 'rectangle']);
  });

  it('records no history entry when nothing would change', () => {
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    select(id);

    store().setSelectedShapeKind('rectangle');
    store().undo();

    // addShape pushed the last entry, so the single undo has to remove the node
    // rather than spend itself on a swap that changed nothing.
    expect(store().nodes).toHaveLength(0);
  });

  it('records no history entry when only skipped nodes are selected', () => {
    const text = store().addShape('text', { x: 0, y: 0 });
    select(text);

    store().setSelectedShapeKind('diamond');
    store().undo();

    expect(store().nodes).toHaveLength(0);
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

describe('canUndo / canRedo', () => {
  it('are both false on a freshly loaded diagram', () => {
    expect(store().canUndo).toBe(false);
    expect(store().canRedo).toBe(false);
  });

  it('turn on as history accumulates and off again as it is consumed', () => {
    store().addShape('rectangle', { x: 0, y: 0 });
    expect(store().canUndo).toBe(true);
    expect(store().canRedo).toBe(false);

    store().undo();
    expect(store().canUndo).toBe(false);
    expect(store().canRedo).toBe(true);

    store().redo();
    expect(store().canUndo).toBe(true);
    expect(store().canRedo).toBe(false);
  });

  it('reset when another diagram is loaded', () => {
    store().addShape('rectangle', { x: 0, y: 0 });
    store().undo();
    expect(store().canRedo).toBe(true);

    store().loadDiagram('other', 'Other', false, { nodes: [], edges: [] });
    expect(store().canUndo).toBe(false);
    expect(store().canRedo).toBe(false);
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

  it('leaves a locked node where it is', () => {
    const locked = store().addShape('rectangle', { x: 0, y: 0 });
    const free = store().addShape('rectangle', { x: 100, y: 100 });
    select(locked);
    store().toggleLock();

    select(locked, free);
    store().nudgeSelected(5, 5);

    expect(store().nodes.find((n) => n.id === locked)!.position).toEqual({ x: 0, y: 0 });
    expect(store().nodes.find((n) => n.id === free)!.position).toEqual({ x: 105, y: 105 });
  });

  it('records no history entry when every selected node is locked', () => {
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    select(id);
    store().toggleLock();

    store().nudgeSelected(1, 0);
    expect(store().nodes[0].position).toEqual({ x: 0, y: 0 });

    // toggleLock pushed the last entry, so one undo must unlock the node
    // rather than spend itself on a nudge that moved nothing.
    store().undo();
    expect(store().nodes[0].data.locked).toBeFalsy();
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

  // ⌥-drag duplicates in place: the clone is left behind, unselected and
  // underneath, while the still-selected originals travel with the pointer.
  describe('with { offset: 0, select: false }', () => {
    it('clones selected nodes and the edges between them with fresh ids', () => {
      const a = store().addShape('rectangle', { x: 0, y: 0 });
      const b = store().addConnectedShape(a, 'right')!;
      select(a, b);
      store().duplicateSelection({ offset: 0, select: false });

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

    it('leaves the clones unselected and behind the originals', () => {
      const a = store().addShape('rectangle', { x: 40, y: 40 });
      select(a);
      store().duplicateSelection({ offset: 0, select: false });

      const clone = store().nodes.find((n) => n.id !== a)!;
      expect(clone.position).toEqual({ x: 40, y: 40 });
      expect(clone.selected).toBe(false);
      // Selection stays on the original so the drag that triggered this keeps
      // moving it, and the clone renders underneath (earlier in the array).
      expect(store().nodes.find((n) => n.id === a)!.selected).toBe(true);
      expect(store().nodes[0].id).toBe(clone.id);
    });
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

describe('alignment guides while dragging', () => {
  // `loadDiagram` resets the nodes but not the guides drawn over them.
  beforeEach(() => {
    useDiagramStore.setState({ guides: [] });
  });

  /** A default-sized (180×100) rectangle. */
  const rect = (x: number, y: number) => store().addShape('rectangle', { x, y });
  const posOf = (id: string) => store().nodes.find((n) => n.id === id)!.position;

  /** The change React Flow emits for a node being dragged to `x, y`. */
  const drag = (id: string, x: number, y: number) =>
    ({ type: 'position', id, position: { x, y }, dragging: true }) as const;

  it('snaps a single dragged node onto a stationary one', () => {
    const still = rect(500, 1000);
    const moving = rect(0, 0);
    store().onNodesChange([drag(moving, 497, 0)]);

    expect(posOf(moving).x).toBe(500);
    expect(posOf(still)).toEqual({ x: 500, y: 1000 });
    expect(store().guides.length).toBeGreaterThan(0);
  });

  it('snaps a two-node drag as one box, moving both by the same delta', () => {
    rect(500, 1000);
    const a = rect(0, 0);
    const b = rect(0, 300);
    // Both dragged together, the pair's left edge 3px shy of the third node's.
    store().onNodesChange([drag(a, 497, 0), drag(b, 497, 300)]);

    expect(posOf(a)).toEqual({ x: 500, y: 0 });
    expect(posOf(b)).toEqual({ x: 500, y: 300 });
    expect(store().guides.length).toBeGreaterThan(0);
  });

  it('keeps the dragged nodes\' spacing when the snap comes from the far edge', () => {
    // The stationary node's left edge lines up with the *pair's* right edge,
    // which only the trailing node can reach: the leading one must move with it.
    rect(860, 1000);
    const a = rect(0, 0);
    const b = rect(200, 0);
    store().onNodesChange([drag(a, 480, 0), drag(b, 677, 0)]);

    expect(posOf(a)).toEqual({ x: 483, y: 0 });
    expect(posOf(b)).toEqual({ x: 680, y: 0 });
  });

  it('does not snap to the nodes being dragged themselves', () => {
    const a = rect(0, 0);
    const b = rect(203, 0);
    store().onNodesChange([drag(a, 0, 0), drag(b, 203, 0)]);

    // b's left edge is 3px from a's right edge, but both are travelling, so
    // there is nothing standing still to snap to.
    expect(posOf(b)).toEqual({ x: 203, y: 0 });
    expect(store().guides).toHaveLength(0);
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

describe('alignSelected', () => {
  /** A rectangle at an explicit position and size. */
  function rect(x: number, y: number, w = 180, h = 100) {
    const id = store().addShape('rectangle', { x, y });
    store().setNodeSizeTransient(id, { width: w, height: h });
    return id;
  }

  const posOf = (id: string) => store().nodes.find((n) => n.id === id)!.position;

  it('moves the selection onto the bounding box\'s left edge', () => {
    const a = rect(0, 0);
    const b = rect(120, 200);
    select(a, b);
    store().alignSelected('left');

    expect(posOf(a).x).toBe(0);
    expect(posOf(b).x).toBe(0);
    // The other axis is left alone.
    expect(posOf(b).y).toBe(200);
  });

  it('aligns tops, bottoms and both centre lines', () => {
    const a = rect(0, 0, 100, 50);
    const b = rect(200, 300, 100, 150);
    select(a, b);

    store().alignSelected('top');
    expect(posOf(a).y).toBe(0);
    expect(posOf(b).y).toBe(0);

    store().alignSelected('bottom');
    // Bounds now run 0 → 150, so the shorter rect drops to y = 100.
    expect(posOf(a).y).toBe(100);
    expect(posOf(b).y).toBe(0);

    store().alignSelected('right');
    expect(posOf(a).x).toBe(200);
    expect(posOf(b).x).toBe(200);

    store().alignSelected('centerX');
    expect(posOf(a).x).toBe(200);
    expect(posOf(b).x).toBe(200);

    store().alignSelected('centerY');
    expect(posOf(a).y).toBe(50);
    expect(posOf(b).y).toBe(0);
  });

  it('leaves an unselected node alone', () => {
    const a = rect(0, 0);
    const b = rect(120, 200);
    const outsider = rect(500, 500);
    select(a, b);
    store().alignSelected('left');

    expect(posOf(outsider)).toEqual({ x: 500, y: 500 });
  });

  it('records exactly one history entry for the whole move', () => {
    const a = rect(0, 0);
    const b = rect(120, 200);
    select(a, b);
    store().alignSelected('left');

    store().undo();
    expect(posOf(b)).toEqual({ x: 120, y: 200 });
    expect(posOf(a)).toEqual({ x: 0, y: 0 });
  });

  it('does nothing with fewer than two nodes selected', () => {
    const a = rect(50, 60);
    select(a);
    store().alignSelected('left');
    expect(posOf(a)).toEqual({ x: 50, y: 60 });

    // No selection at all, and no history entry either.
    select();
    store().alignSelected('left');
    store().undo();
    expect(store().nodes).toHaveLength(0);
  });

  it('anchors on a locked node without moving it', () => {
    const locked = rect(0, 0);
    const free = rect(120, 200);
    select(locked);
    store().toggleLock();

    select(locked, free);
    store().alignSelected('left');

    expect(posOf(locked)).toEqual({ x: 0, y: 0 });
    expect(posOf(free).x).toBe(0);
  });

  it('records no history entry when the selection is already aligned', () => {
    const a = rect(0, 0);
    const b = rect(0, 200);
    select(a, b);
    store().alignSelected('left');

    // The only entries are the two addShape calls, so two undos empty the canvas.
    store().undo();
    store().undo();
    expect(store().nodes).toHaveLength(0);
  });
});

describe('distributeSelected', () => {
  function rect(x: number, y: number, w = 100, h = 100) {
    const id = store().addShape('rectangle', { x, y });
    store().setNodeSizeTransient(id, { width: w, height: h });
    return id;
  }

  const nodeOf = (id: string) => store().nodes.find((n) => n.id === id)!;

  it('spreads three unevenly spaced nodes into equal gaps', () => {
    const a = rect(0, 0);
    const b = rect(150, 0);
    const c = rect(400, 0);
    select(a, b, c);
    store().distributeSelected('x');

    // 500 of span holding 300 of node leaves 200 over two gaps.
    expect(nodeOf(a).position.x).toBe(0);
    expect(nodeOf(b).position.x).toBe(200);
    expect(nodeOf(c).position.x).toBe(400);
  });

  it('records one history entry and leaves an even row alone', () => {
    const a = rect(0, 0);
    const b = rect(200, 0);
    const c = rect(400, 0);
    select(a, b, c);
    store().distributeSelected('x');
    expect(nodeOf(b).position.x).toBe(200);

    // Nothing moved, so the three addShape entries are the whole history.
    store().undo();
    store().undo();
    store().undo();
    expect(store().nodes).toHaveLength(0);
  });

  it('does nothing with fewer than three nodes selected', () => {
    const a = rect(0, 0);
    const b = rect(150, 0);
    select(a, b);
    store().distributeSelected('x');
    expect(nodeOf(b).position.x).toBe(150);
  });

  it('leaves a locked node where it is', () => {
    const a = rect(0, 0);
    const b = rect(150, 0);
    const c = rect(400, 0);
    select(b);
    store().toggleLock();

    select(a, b, c);
    store().distributeSelected('x');
    expect(nodeOf(b).position.x).toBe(150);
  });
});

describe('matchSizeSelected', () => {
  function rect(x: number, y: number, w: number, h: number) {
    const id = store().addShape('rectangle', { x, y });
    store().setNodeSizeTransient(id, { width: w, height: h });
    return id;
  }

  const nodeOf = (id: string) => store().nodes.find((n) => n.id === id)!;

  it('resizes the selection to the largest node in it', () => {
    const small = rect(0, 0, 100, 50);
    const big = rect(300, 0, 200, 120);
    select(small, big);
    store().matchSizeSelected('both');

    expect(nodeOf(small)).toMatchObject({ width: 200, height: 120 });
    // The reference itself is untouched, position included.
    expect(nodeOf(big)).toMatchObject({ width: 200, height: 120, position: { x: 300, y: 0 } });
  });

  it('matches one dimension at a time', () => {
    const small = rect(0, 0, 100, 50);
    const big = rect(300, 0, 200, 120);
    select(small, big);

    store().matchSizeSelected('width');
    expect(nodeOf(small)).toMatchObject({ width: 200, height: 50 });

    store().matchSizeSelected('height');
    expect(nodeOf(small)).toMatchObject({ width: 200, height: 120 });
  });

  it('records one history entry for the resize', () => {
    const small = rect(0, 0, 100, 50);
    const big = rect(300, 0, 200, 120);
    select(small, big);
    store().matchSizeSelected('both');

    store().undo();
    expect(nodeOf(small)).toMatchObject({ width: 100, height: 50 });
    expect(nodeOf(big)).toMatchObject({ width: 200, height: 120 });
  });

  it('does nothing with a single node selected, and never resizes a locked one', () => {
    const a = rect(0, 0, 100, 50);
    const b = rect(300, 0, 200, 120);
    select(a);
    store().matchSizeSelected('both');
    expect(nodeOf(a)).toMatchObject({ width: 100, height: 50 });

    select(a);
    store().toggleLock();
    select(a, b);
    store().matchSizeSelected('both');
    expect(nodeOf(a)).toMatchObject({ width: 100, height: 50 });
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

describe('updateEdgeData', () => {
  /** An edge with the default styling, plus the id of its source shape. */
  function edgeId() {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addConnectedShape(a, 'right');
    return store().edges[0].id;
  }

  it('recolors the arrowheads when the stroke changes', () => {
    const id = edgeId();
    store().updateEdgeData(id, { stroke: '#FF0000' });
    expect(store().edges[0].markerEnd).toContain('FF0000');
  });

  it('adds and removes arrowheads as their styles change', () => {
    const id = edgeId();
    store().updateEdgeData(id, { startArrowStyle: 'diamond' });
    expect(store().edges[0].markerStart).toContain('diamond');

    store().updateEdgeData(id, { endArrowStyle: 'none' });
    expect(store().edges[0].markerEnd).toBeUndefined();
    expect(store().edges[0].markerStart).toBeDefined();
  });

  it('resizes the arrowheads when the line thickens', () => {
    const id = edgeId();
    const before = store().edges[0].markerEnd;
    store().updateEdgeData(id, { strokeWidth: 3 });
    expect(store().edges[0].markerEnd).not.toBe(before);
    expect(store().edges[0].markerEnd).toContain('-14');
  });

  it('leaves the markers alone for a patch that cannot affect them', () => {
    const id = edgeId();
    const before = store().edges[0].markerEnd;
    store().updateEdgeData(id, { label: 'yes' });
    expect(store().edges[0].markerEnd).toBe(before);
  });

  it('clears a waypoint, and undo puts the routed bend back', () => {
    const id = edgeId();
    store().beginInteraction();
    store().updateEdgeDataTransient(id, { waypoint: { x: 40, y: 90 } });

    store().updateEdgeData(id, { waypoint: null });
    expect(store().edges[0].data!.waypoint).toBeNull();

    store().undo();
    expect(store().edges[0].data!.waypoint).toEqual({ x: 40, y: 90 });
  });
});

describe('updateSelectedEdgesStyle', () => {
  /** Two shapes joined by a connector, with only the connector selected. */
  function selectedEdgeId() {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addConnectedShape(a, 'right');
    const id = store().edges[0].id;
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: false })),
      edges: s.edges.map((e) => ({ ...e, selected: e.id === id })),
    }));
    return id;
  }

  it('resets the route of every selected connector, and undo restores it', () => {
    const id = selectedEdgeId();
    store().beginInteraction();
    store().updateEdgeDataTransient(id, { waypoint: { x: 40, y: 90 } });

    store().updateSelectedEdgesStyle({ waypoint: null });
    expect(store().edges[0].data!.waypoint).toBeNull();

    store().undo();
    expect(store().edges[0].data!.waypoint).toEqual({ x: 40, y: 90 });
  });

  it('leaves connectors outside the selection alone', () => {
    const id = selectedEdgeId();
    const b = store().addShape('rectangle', { x: 400, y: 0 });
    store().addConnectedShape(b, 'right');
    const other = store().edges.find((e) => e.id !== id)!.id;
    store().beginInteraction();
    store().updateEdgeDataTransient(other, { waypoint: { x: 1, y: 2 } });
    useDiagramStore.setState((s) => ({ edges: s.edges.map((e) => ({ ...e, selected: e.id === id })) }));

    store().updateSelectedEdgesStyle({ waypoint: null });
    expect(store().edges.find((e) => e.id === other)!.data!.waypoint).toEqual({ x: 1, y: 2 });
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

describe('updateSelectedNodesData', () => {
  it('formats every selected shape at once', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addShape('ellipse', { x: 200, y: 0 });
    const outsider = store().addShape('rectangle', { x: 400, y: 0 });
    select(a, b);
    store().updateSelectedNodesData({ bold: true, fontSize: 'large' });

    expect(store().nodes.find((n) => n.id === a)!.data).toMatchObject({ bold: true, fontSize: 'large' });
    expect(store().nodes.find((n) => n.id === b)!.data).toMatchObject({ bold: true, fontSize: 'large' });
    expect(store().nodes.find((n) => n.id === outsider)!.data.bold).toBeUndefined();
  });

  it('leaves an image alone — it has no text to format', () => {
    const shape = store().addShape('rectangle', { x: 0, y: 0 });
    const image = store().addImageNode({ src: '/api/images/x', width: 64, height: 64, position: { x: 200, y: 0 } });
    select(shape, image);
    store().updateSelectedNodesData({ bold: true });

    expect(store().nodes.find((n) => n.id === shape)!.data.bold).toBe(true);
    expect(store().nodes.find((n) => n.id === image)!.data.bold).toBeUndefined();
  });

  it('records one history entry for the whole selection', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addShape('rectangle', { x: 200, y: 0 });
    select(a, b);
    store().updateSelectedNodesData({ italic: true });

    store().undo();
    expect(store().nodes.every((n) => n.data.italic === undefined)).toBe(true);
  });
});

describe('setNodeSizeTransient', () => {
  it('resizes a node, leaving the dimension that was not passed alone', () => {
    const id = store().addShape('text', { x: 0, y: 0 });
    store().setNodeSizeTransient(id, { height: 132 });

    const node = store().nodes.find((n) => n.id === id)!;
    expect(node.height).toBe(132);
    expect(node.width).toBe(160);
  });

  it('does not record an undo entry, so auto-growing text is not undoable', () => {
    const id = store().addShape('text', { x: 0, y: 0 });
    store().setNodeSizeTransient(id, { height: 240 });

    // addShape pushed the only history entry, so a single undo must take the
    // diagram all the way back to empty.
    store().undo();
    expect(store().nodes).toHaveLength(0);
    expect(store().canUndo).toBe(false);
  });

  it('ignores an unknown node id', () => {
    const id = store().addShape('text', { x: 0, y: 0 });
    store().setNodeSizeTransient('nope', { height: 999 });
    expect(store().nodes.find((n) => n.id === id)!.height).toBe(40);
  });
});

describe('computeMarkers', () => {
  // Behaviour is covered in `src/lib/edgeMarkers.test.ts`; this guards the
  // re-export the store publishes so callers need only one import.
  it('is re-exported from the store', () => {
    const { markerStart, markerEnd } = computeMarkers({ stroke: '#ABCDEF', endArrowStyle: 'circle' });
    expect(markerStart).toBeUndefined();
    expect(markerEnd).toContain('circle');
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
    expect(store().edges[0].markerEnd).toContain('123456');
  });

  it('runs the payload through the migrations', () => {
    // A v0 node with no `type` — React Flow needs one to pick a renderer.
    store().loadDiagram('d', 'D', false, { nodes: [{ id: 'n1', position: { x: 0, y: 0 } }], edges: [] });
    expect(store().nodes[0].type).toBe('shape');
  });

  it('rejects a diagram from a newer version without touching the current one', () => {
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    expect(() =>
      store().loadDiagram('d', 'D', false, { version: CURRENT_DIAGRAM_VERSION + 1, nodes: [], edges: [] }),
    ).toThrow(/newer version/i);
    expect(store().nodes.map((n) => n.id)).toEqual([id]);
    expect(store().diagramId).toBe('test');
  });
});

describe('serializeDiagram', () => {
  it('stamps the saved JSON with the current format version', () => {
    const id = store().addShape('rectangle', { x: 1, y: 2 });
    const data = serializeDiagram(store().nodes, store().edges);
    expect(data.version).toBe(CURRENT_DIAGRAM_VERSION);
    expect(data.nodes).toMatchObject([{ id, type: 'shape', position: { x: 1, y: 2 } }]);
  });

  it('round-trips through the migration unchanged', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addConnectedShape(a, 'right');
    const saved = JSON.parse(JSON.stringify(serializeDiagram(store().nodes, store().edges)));
    expect(migrateDiagramData(saved)).toEqual(saved);
  });
});

describe('the saved viewport', () => {
  const viewport = { x: -120, y: 40, zoom: 1.5 };

  it('is empty until the canvas reports one, so an unpanned diagram opens framed', () => {
    expect(store().viewport).toBeNull();
    expect(serializeDiagram(store().nodes, store().edges, store().viewport).viewport).toBeUndefined();
  });

  it('round-trips through serialize and load', () => {
    store().setViewport(viewport);
    const saved = JSON.parse(JSON.stringify(serializeDiagram(store().nodes, store().edges, store().viewport)));
    expect(saved.viewport).toEqual(viewport);

    store().loadDiagram('other', 'Other', false, saved);
    expect(store().viewport).toEqual(viewport);
  });

  it('is dropped when the next diagram has none of its own', () => {
    store().setViewport(viewport);
    store().loadDiagram('other', 'Other', false, { nodes: [], edges: [] });
    expect(store().viewport).toBeNull();
  });

  it('is transient: panning is not an undo step', () => {
    store().setViewport(viewport);
    expect(store().canUndo).toBe(false);
  });
});

describe('saveDiagram', () => {
  beforeEach(() => {
    saveDiagram.mockClear();
    saveDiagram.mockResolvedValue(undefined);
    useToastStore.getState().clear();
  });

  it('does nothing without a diagram id', async () => {
    useDiagramStore.setState({ diagramId: null });
    await store().saveDiagram();
    expect(saveDiagram).not.toHaveBeenCalled();
  });

  it('marks the diagram saved once the request resolves', async () => {
    await store().saveDiagram();
    expect(saveDiagram).toHaveBeenCalledWith('test', expect.anything(), undefined);
    expect(store().saveStatus).toBe('saved');
  });

  it('falls back to Untitled rather than sending a title the server rejects', async () => {
    // The API 400s an empty title, which would strand the diagram unsaved.
    store().setTitle('   ');
    await store().saveDiagram();
    expect(saveDiagram).toHaveBeenCalledWith('test', expect.objectContaining({ title: 'Untitled' }), undefined);
  });

  it('sends the current viewport along with the diagram', async () => {
    store().setViewport({ x: 10, y: -20, zoom: 0.75 });
    await store().saveDiagram();
    expect(saveDiagram).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ data: expect.objectContaining({ viewport: { x: 10, y: -20, zoom: 0.75 } }) }),
      undefined,
    );
  });

  it('trims the title it sends', async () => {
    store().setTitle('  Flow chart  ');
    await store().saveDiagram();
    expect(saveDiagram).toHaveBeenCalledWith('test', expect.objectContaining({ title: 'Flow chart' }), undefined);
  });

  it('reports a failed save with a toast as well as the status', async () => {
    saveDiagram.mockRejectedValueOnce(new Error('offline'));
    await store().saveDiagram();
    expect(store().saveStatus).toBe('error');
    expect(useToastStore.getState().toasts).toMatchObject([
      { kind: 'error', message: 'Save failed — retrying' },
    ]);
  });

  it('does not stack a toast per failed attempt while the save is still broken', async () => {
    saveDiagram.mockRejectedValue(new Error('offline'));
    await store().saveDiagram();
    await store().saveDiagram();
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('keeps the retrying status a failing autosaver set, rather than flashing an error per attempt', async () => {
    saveDiagram.mockRejectedValue(new Error('offline'));
    // What the autosaver puts there once it has scheduled a retry.
    useDiagramStore.setState({ saveStatus: 'retrying' });

    await store().saveDiagram();
    expect(store().saveStatus).toBe('retrying');
    // The streak was already announced, so this attempt stays quiet.
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('clears a retrying status once a save gets through', async () => {
    useDiagramStore.setState({ saveStatus: 'retrying' });
    await store().saveDiagram();
    expect(store().saveStatus).toBe('saved');
  });
});

describe('addImageNode', () => {
  it('adds a dedicated image node at the given position and size', () => {
    const id = store().addImageNode({
      src: '/api/images/abc',
      width: 320,
      height: 180,
      position: { x: 40, y: 60 },
    });
    const node = store().nodes.find((n) => n.id === id)!;
    expect(node).toMatchObject({
      type: 'shape',
      position: { x: 40, y: 60 },
      width: 320,
      height: 180,
      data: { shape: 'image', imageSrc: '/api/images/abc' },
    });
  });

  it('carries no fill or stroke of its own — the image is the whole node', () => {
    const id = store().addImageNode({ src: '/api/images/abc', width: 10, height: 10, position: { x: 0, y: 0 } });
    const node = store().nodes.find((n) => n.id === id)!;
    expect(node.data.fill).toBe('transparent');
    expect(node.data.stroke).toBe('transparent');
  });

  it('is undoable', () => {
    store().addImageNode({ src: '/api/images/abc', width: 10, height: 10, position: { x: 0, y: 0 } });
    expect(store().nodes).toHaveLength(1);
    store().undo();
    expect(store().nodes).toHaveLength(0);
  });

  it('does not leave the node in text-editing mode', () => {
    const id = store().addImageNode({ src: '/api/images/abc', width: 10, height: 10, position: { x: 0, y: 0 } });
    expect(store().editingNodeId).not.toBe(id);
  });
});

describe('image placeholders', () => {
  const placeholder = () =>
    store().addImagePlaceholder({ width: 200, height: 140, position: { x: 10, y: 20 } });

  it('adds a node marked as uploading', () => {
    const id = placeholder();
    const node = store().nodes.find((n) => n.id === id)!;
    expect(node).toMatchObject({
      width: 200,
      height: 140,
      position: { x: 10, y: 20 },
      data: { shape: 'image', uploading: true },
    });
  });

  it('is not itself undoable — an upload in flight is not an edit yet', () => {
    placeholder();
    expect(store().canUndo).toBe(false);
  });

  it('swaps in the uploaded image, at the size and position it is drawn at', () => {
    const id = placeholder();
    store().resolveImagePlaceholder(id, {
      src: '/api/images/abc',
      width: 400,
      height: 300,
      position: { x: 1, y: 2 },
    });
    const node = store().nodes.find((n) => n.id === id)!;
    expect(node).toMatchObject({
      width: 400,
      height: 300,
      position: { x: 1, y: 2 },
      data: { shape: 'image', imageSrc: '/api/images/abc' },
    });
    expect(node.data.uploading).toBeUndefined();
  });

  it('makes the finished insert one undo step back to before the placeholder', () => {
    const id = placeholder();
    store().resolveImagePlaceholder(id, {
      src: '/api/images/abc',
      width: 10,
      height: 10,
      position: { x: 0, y: 0 },
    });
    expect(store().canUndo).toBe(true);

    store().undo();
    expect(store().nodes).toHaveLength(0);
  });

  it('removes a placeholder whose upload failed, recording nothing', () => {
    const id = placeholder();
    store().removeImagePlaceholder(id);
    expect(store().nodes).toHaveLength(0);
    // A failed upload must not leave a dead ⌘Z behind.
    expect(store().canUndo).toBe(false);
  });

  it('ignores a resolution for a placeholder the user already undid away', () => {
    const id = placeholder();
    store().removeImagePlaceholder(id);
    store().resolveImagePlaceholder(id, {
      src: '/api/images/abc',
      width: 10,
      height: 10,
      position: { x: 0, y: 0 },
    });
    expect(store().nodes).toHaveLength(0);
    expect(store().canUndo).toBe(false);
  });
});
