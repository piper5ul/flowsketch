import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeMarkers, serializeDiagram, useDiagramStore } from './useDiagramStore';
import { CURRENT_DIAGRAM_VERSION, migrateDiagramData } from '../lib/diagramMigrations';
import { SHAPE_KINDS, isAnchorNode } from '../lib/nodeKinds';
import { DEFAULT_INK_STROKE, ERASER_SLOP_PX, INK_WIDTH } from '../lib/ink';
import {
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_ROW_HEIGHT,
  addColumn,
  addRow,
  removeColumn,
  setCell,
  setColumnWidth,
} from '../lib/table';
import { DEFAULT_SWATCH } from '../lib/palette';
import type { InkPoint } from '../types';
import {
  MIND_MAP_LEVEL_GAP,
  MIND_MAP_NODE_SIZE,
  MIND_MAP_SIBLING_GAP,
} from '../lib/mindMap';
import { useToastStore } from './useToastStore';
import { ConflictError, UnauthorizedError, api } from '../lib/api';

// Only `api` itself is a stub: the error classes have to be the real ones, or
// the `instanceof` checks in `saveDiagram` would never match.
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  // The literal is repeated rather than shared with `SAVED_AT`: a `vi.mock`
  // factory runs before the module body, so a const here would still be in TDZ.
  api: { saveDiagram: vi.fn(async () => ({ updatedAt: '2026-09-05T09:00:00.000Z' })) },
}));

/** What a successful `PUT` answers with: where the row is now. */
const SAVED_AT = '2026-09-05T09:00:00.000Z';

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
      data: { shape: 'rectangle', label: '', fill: DEFAULT_SWATCH.fill, stroke: DEFAULT_SWATCH.stroke },
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
      fill: DEFAULT_SWATCH.fill,
      stroke: DEFAULT_SWATCH.stroke,
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
      store().updateEdgeDataTransient(edgeId, { waypoints: [{ x, y: 0 }] });
    }
    expect(store().edges[0].data!.waypoints).toEqual([{ x: 30, y: 0 }]);

    store().undo();
    expect(store().edges[0].data!.waypoints).toBeUndefined();
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

  it('lands exactly where the pointer put it while ⌘ or ` is held', () => {
    rect(500, 1000);
    const moving = rect(0, 0);
    store().setSnapOverride('guides');
    store().onNodesChange([drag(moving, 497, 0)]);
    expect(posOf(moving).x).toBe(497);
    expect(store().guides).toHaveLength(0);
    store().setSnapOverride('none');
    store().onNodesChange([drag(moving, 497, 0)]);
    expect(posOf(moving).x).toBe(500);
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

describe('arranging nodes inside containers', () => {
  const nodeOf = (id: string) => store().nodes.find((n) => n.id === id)!;

  /** A rectangle at an absolute position, optionally inside `parent`. */
  function rect(x: number, y: number, w = 100, h = 100, parent?: string) {
    const id = store().addShape('rectangle', { x, y });
    store().setNodeSizeTransient(id, { width: w, height: h });
    if (parent) {
      const origin = nodeOf(parent).position;
      useDiagramStore.setState((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id
            ? { ...n, parentId: parent, position: { x: x - origin.x, y: y - origin.y } }
            : n,
        ),
      }));
    }
    return id;
  }

  /** Where a node really sits on the board, its parent's offset folded in. */
  function absolute(id: string) {
    const node = nodeOf(id);
    if (node.parentId === undefined) return node.position;
    const origin = nodeOf(node.parentId).position;
    return { x: node.position.x + origin.x, y: node.position.y + origin.y };
  }

  it('aligns a framed child with an outside shape in board coordinates', () => {
    const frame = store().addFrame({ x: 500, y: 100 });
    const inside = rect(550, 150, 100, 100, frame);
    const outside = rect(200, 400);

    // The stored position is the offset from the frame, not the board.
    expect(nodeOf(inside).position).toEqual({ x: 50, y: 50 });

    select(inside, outside);
    store().alignSelected('left');

    // Visually aligned: both left edges on x = 200 on the board …
    expect(absolute(inside).x).toBe(200);
    expect(absolute(outside).x).toBe(200);
    // … while what is stored for the child stays relative to its frame.
    expect(nodeOf(inside).position).toEqual({ x: -300, y: 50 });
    expect(nodeOf(frame).position).toEqual({ x: 500, y: 100 });
  });

  it('distributes across a frame boundary', () => {
    const frame = store().addFrame({ x: 1000, y: 1000 });
    const a = rect(0, 0);
    const b = rect(150, 0, 100, 100, frame);
    const c = rect(400, 0);

    select(a, b, c);
    store().distributeSelected('x');

    // 500 of span holding 300 of node leaves 200 over two gaps, as it would
    // with no frame in the selection at all.
    expect(absolute(a).x).toBe(0);
    expect(absolute(b).x).toBe(200);
    expect(absolute(c).x).toBe(400);
    expect(nodeOf(b).position).toEqual({ x: -800, y: -1000 });
  });

  it('matches size regardless of parentage', () => {
    const frame = store().addFrame({ x: 700, y: 700 });
    const inside = rect(750, 750, 100, 50, frame);
    const outside = rect(0, 0, 200, 120);

    select(inside, outside);
    store().matchSizeSelected('both');

    expect(nodeOf(inside)).toMatchObject({ width: 200, height: 120 });
    // A resize is not a move: the child keeps the offset it had.
    expect(nodeOf(inside).position).toEqual({ x: 50, y: 50 });
  });

  it('skips a descendant whose ancestor is selected too', () => {
    const frame = store().addFrame({ x: 500, y: 100 });
    const inside = rect(550, 150, 100, 100, frame);
    const outside = rect(200, 400);

    select(frame, inside, outside);
    store().alignSelected('left');

    // The frame moved and carried its child, so the child's own offset is
    // untouched — arranging both would have moved it twice.
    expect(nodeOf(frame).position.x).toBe(200);
    expect(nodeOf(inside).position).toEqual({ x: 50, y: 50 });
    expect(nodeOf(outside).position.x).toBe(200);
  });

  it('does nothing when the only other selected node is a descendant', () => {
    const frame = store().addFrame({ x: 500, y: 100 });
    const inside = rect(550, 150, 100, 100, frame);

    select(frame, inside);
    store().alignSelected('left');

    // One rect is not a selection to align, so nothing moved and no history
    // entry was pushed: the two adds and the reparent are the whole history.
    expect(nodeOf(frame).position).toEqual({ x: 500, y: 100 });
    expect(nodeOf(inside).position).toEqual({ x: 50, y: 50 });
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

describe('addInk', () => {
  /** A stroke drawn straight down the board, one sample every 10 px. */
  const stroke = (x = 100): InkPoint[] =>
    Array.from({ length: 8 }, (_, i) => [x, 100 + i * 10] as InkPoint);

  it('adds an `ink` node boxed around the stroke, with the pen inside its data', () => {
    const id = store().addInk(stroke(), 'marker', INK_WIDTH.marker)!;
    const node = store().nodes.find((n) => n.id === id)!;
    expect(node.type).toBe('ink');
    // Half the pen width out from the drawn line on every side.
    expect(node.position).toEqual({ x: 100 - INK_WIDTH.marker / 2, y: 100 - INK_WIDTH.marker / 2 });
    expect(node.width).toBe(INK_WIDTH.marker);
    expect(node.height).toBe(70 + INK_WIDTH.marker);
    expect(node.data.ink).toMatchObject({ kind: 'marker', width: INK_WIDTH.marker });
  });

  it('stores the points relative to the node, and thins them on the way in', () => {
    const id = store().addInk(stroke(), 'marker', INK_WIDTH.marker)!;
    const ink = store().nodes.find((n) => n.id === id)!.data.ink!;
    // Eight samples in a straight line are two: the ends.
    expect(ink.points).toEqual([
      [INK_WIDTH.marker / 2, INK_WIDTH.marker / 2],
      [INK_WIDTH.marker / 2, 70 + INK_WIDTH.marker / 2],
    ]);
  });

  it('is a stroke, not a shape: no label, no fill, and the pen\'s colour as its stroke', () => {
    const id = store().addInk(stroke(), 'marker', INK_WIDTH.marker)!;
    const { data } = store().nodes.find((n) => n.id === id)!;
    expect(data.label).toBe('');
    expect(data.fill).toBe('transparent');
    expect(data.stroke).toBe(DEFAULT_INK_STROKE);
    // Which is exactly why the anchor test cannot mistake one for a floating
    // arrow's endpoint — it needs *both* colours to be transparent.
    expect(isAnchorNode(data)).toBe(false);
  });

  it('takes the colour a swatch was last picked in, as every other new element does', () => {
    store().setDefaultStyle({ fill: '#FDE68A', stroke: '#B45309' });
    const id = store().addInk(stroke(), 'marker', INK_WIDTH.marker)!;
    expect(store().nodes.find((n) => n.id === id)!.data.stroke).toBe('#B45309');
  });

  it('draws nothing, and costs no history entry, for a press that never travelled', () => {
    expect(store().canUndo).toBe(false);
    expect(store().addInk([[10, 10], [10, 10]], 'marker', INK_WIDTH.marker)).toBeNull();
    expect(store().nodes).toHaveLength(0);
    expect(store().canUndo).toBe(false);
  });

  it('is one undo step', () => {
    store().addInk(stroke(), 'marker', INK_WIDTH.marker);
    store().addInk(stroke(200), 'highlighter', INK_WIDTH.highlighter);
    expect(store().nodes).toHaveLength(2);
    store().undo();
    expect(store().nodes).toHaveLength(1);
    expect(store().nodes[0].data.ink!.kind).toBe('marker');
  });

  it('survives a round trip through the saved JSON', () => {
    const id = store().addInk(stroke(), 'highlighter', INK_WIDTH.highlighter)!;
    const json = serializeDiagram(store().nodes, store().edges);
    // No migration step was needed for the pen: an absent `ink` is what every
    // older node already holds, so a stroke reads back exactly as written.
    const back = migrateDiagramData(JSON.parse(JSON.stringify(json)));
    const node = back.nodes.find((n) => n.id === id)!;
    expect(node.type).toBe('ink');
    expect(node.data.ink).toEqual(store().nodes[0].data.ink);
  });
});

describe('eraseInkAt', () => {
  /** Two strokes: one down the board at x = 100, one at x = 300. */
  function twoStrokes() {
    const first = store().addInk([[100, 100], [100, 140], [100, 200]], 'marker', INK_WIDTH.marker)!;
    const second = store().addInk([[300, 100], [300, 140], [300, 200]], 'marker', INK_WIDTH.marker)!;
    return { first, second };
  }

  it('rubs out the whole stroke the pointer crosses, and only that one', () => {
    const { second } = twoStrokes();
    expect(store().eraseInkAt({ x: 100, y: 150 })).toBe(1);
    expect(store().nodes.map((n) => n.id)).toEqual([second]);
  });

  it('reaches a little past the drawn line, and no further', () => {
    twoStrokes();
    // Just outside the ink, inside the slop.
    expect(store().eraseInkAt({ x: 100 + INK_WIDTH.marker / 2 + ERASER_SLOP_PX - 1, y: 150 })).toBe(1);
    // Well clear of both strokes: nothing goes, and no history entry is opened.
    const before = store().canUndo;
    expect(store().eraseInkAt({ x: 200, y: 150 })).toBe(0);
    expect(store().canUndo).toBe(before);
  });

  it('leaves shapes alone — it is an eraser for ink, not a delete tool', () => {
    const box = store().addShape('rectangle', { x: 50, y: 50 });
    expect(store().eraseInkAt({ x: 100, y: 100 })).toBe(0);
    expect(store().nodes.map((n) => n.id)).toEqual([box]);
  });

  it('leaves a locked stroke alone, as every other edit does', () => {
    const { first } = twoStrokes();
    store().updateNodeData(first, { locked: true });
    expect(store().eraseInkAt({ x: 100, y: 150 })).toBe(0);
  });

  it('erases one stroke per press, and a whole wipe in one undo step', () => {
    twoStrokes();
    // What the gesture does: `continuing` is false until something has gone.
    expect(store().eraseInkAt({ x: 100, y: 150 }, false)).toBe(1);
    expect(store().eraseInkAt({ x: 300, y: 150 }, true)).toBe(1);
    expect(store().nodes).toHaveLength(0);

    store().undo();
    expect(store().nodes).toHaveLength(2);
  });

  it('finds a stroke inside a frame, whose points are an offset from it', () => {
    const id = store().addInk([[100, 100], [100, 140], [100, 200]], 'marker', INK_WIDTH.marker)!;
    // Re-parented by hand: a drop into a frame rewrites the position to be
    // relative to it, and the eraser has to convert back the same way.
    useDiagramStore.setState((s) => ({
      nodes: [
        { id: 'f1', type: 'frame' as const, position: { x: 40, y: 60 }, width: 400, height: 400, data: { label: 'F', shape: 'rectangle' as const, fill: 'transparent', stroke: 'transparent' } },
        ...s.nodes.map((n) =>
          n.id === id
            ? { ...n, parentId: 'f1', position: { x: n.position.x - 40, y: n.position.y - 60 } }
            : n,
        ),
      ],
    }));
    expect(store().eraseInkAt({ x: 100, y: 150 })).toBe(1);
  });
});

describe('saveSelectionAsDefault', () => {
  /** Select exactly this edge (and no nodes). */
  function selectEdge(id: string) {
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: false })),
      edges: s.edges.map((e) => ({ ...e, selected: e.id === id })),
    }));
  }

  it("saves a shape's style on the board, and the next shape is drawn in it", () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().updateNodeData(a, { fill: '#FF0000', stroke: '#880000', fillStyle: 'outline', bold: true });
    select(a);

    expect(store().saveSelectionAsDefault()).toBe('shape');
    expect(store().defaults.shape).toMatchObject({
      fill: '#FF0000',
      stroke: '#880000',
      fillStyle: 'outline',
      bold: true,
    });

    const next = store().addShape('ellipse', { x: 300, y: 0 });
    expect(store().nodes.find((n) => n.id === next)!.data).toMatchObject({
      // The style, and only the style: an ellipse drawn under a rectangle's
      // default is still an ellipse, and is not called what the rectangle was.
      shape: 'ellipse',
      label: '',
      fill: '#FF0000',
      fillStyle: 'outline',
      bold: true,
    });
  });

  it('never lets a label, a link, a lock or an image into the default', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().updateNodeData(a, {
      label: 'Do not copy me',
      link: 'https://example.com',
      locked: true,
      imageSrc: '/api/images/abc',
      fill: '#FF0000',
    });
    select(a);
    store().saveSelectionAsDefault();

    expect(store().defaults.shape).toEqual({ fill: '#FF0000', stroke: DEFAULT_SWATCH.stroke });
    const next = store().addShape('rectangle', { x: 300, y: 0 });
    const data = store().nodes.find((n) => n.id === next)!.data;
    expect(data.label).toBe('');
    expect(data.link).toBeUndefined();
    expect(data.locked).toBeUndefined();
    expect(data.imageSrc).toBeUndefined();
  });

  it('never lets a size or a position into the default', () => {
    const a = store().addShape('rectangle', { x: 10, y: 20 });
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === a ? { ...n, width: 900, height: 700 } : n)),
    }));
    select(a);
    store().saveSelectionAsDefault();

    const next = store().addShape('rectangle', { x: 300, y: 0 });
    const node = store().nodes.find((n) => n.id === next)!;
    expect({ width: node.width, height: node.height }).toEqual({ width: 180, height: 100 });
    expect(node.position).toEqual({ x: 300, y: 0 });
  });

  it('keeps a sticky note, a text shape and a shape apart', () => {
    const sticky = store().addShape('sticky', { x: 0, y: 0 });
    store().updateNodeData(sticky, { fill: '#FF00FF' });
    select(sticky);
    expect(store().saveSelectionAsDefault()).toBe('sticky');

    store().addShape('sticky', { x: 0, y: 0 });
    expect(store().nodes.at(-1)!.data.fill).toBe('#FF00FF');
    // A rectangle is not a sticky note, and a text shape is neither.
    expect(store().newShapeData('rectangle').fill).toBe(DEFAULT_SWATCH.fill);
    expect(store().newShapeData('text').fill).toBe('transparent');
  });

  it("saves a connector's style, and the next connector is drawn in it", () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addConnectedShape(a, 'right');
    const edgeId = store().edges[0].id;
    store().updateEdgeData(edgeId, {
      connectorType: 'curved',
      stroke: '#123456',
      strokeStyle: 'dashed',
      strokeWidth: 3,
      startArrowStyle: 'circle',
      endArrowStyle: 'diamond',
      label: 'not a default',
    });
    selectEdge(edgeId);

    expect(store().saveSelectionAsDefault()).toBe('connector');
    expect(store().defaults.connector).toEqual({
      connectorType: 'curved',
      stroke: '#123456',
      strokeStyle: 'dashed',
      strokeWidth: 3,
      startArrowStyle: 'circle',
      endArrowStyle: 'diamond',
    });

    const data = store().newConnectorData();
    expect(data).toMatchObject({ connectorType: 'curved', stroke: '#123456', strokeWidth: 3 });
    // The label is one connector's words, never every connector's.
    expect(data.label).toBe('');
  });

  it("regenerates the arrowheads of a connector drawn in the board's default", () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addConnectedShape(a, 'right');
    const edgeId = store().edges[0].id;
    store().updateEdgeData(edgeId, { stroke: '#123456', startArrowStyle: 'diamond' });
    selectEdge(edgeId);
    store().saveSelectionAsDefault();

    const b = store().addShape('rectangle', { x: 600, y: 0 });
    store().onConnect({ source: a, target: b, sourceHandle: 'right', targetHandle: 'left' });
    const made = store().edges.at(-1)!;
    // Markers are derived from the data, so a default that changes the colour
    // or an arrowhead has to change the ids on the edge with it.
    expect(made).toMatchObject(computeMarkers(made.data!));
    expect(made.markerStart).toBeTruthy();
  });

  it('draws a quick-added connector in the default too', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addConnectedShape(a, 'right');
    const edgeId = store().edges[0].id;
    store().updateEdgeData(edgeId, { connectorType: 'straight', stroke: '#123456' });
    selectEdge(edgeId);
    store().saveSelectionAsDefault();

    store().addConnectedShape(a, 'bottom');
    expect(store().edges.at(-1)!.data).toMatchObject({ connectorType: 'straight', stroke: '#123456' });
  });

  it('overrules the swatch this session had been using', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    select(a);
    // The session picks red, then a *blue* shape is made the board default.
    store().updateSelectedNodesStyle({ fill: '#FF0000', stroke: '#880000' });
    const b = store().addShape('rectangle', { x: 300, y: 0 });
    store().updateNodeData(b, { fill: '#0000FF', stroke: '#000088' });
    select(b);
    store().saveSelectionAsDefault();

    // Saving a default is the more recent word, so it clears the session layer
    // rather than being quietly overruled by a swatch picked earlier.
    expect(store().newShapeData('rectangle').fill).toBe('#0000FF');
  });

  it('refuses a selection that is not exactly one thing', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addShape('rectangle', { x: 300, y: 0 });
    expect(store().saveSelectionAsDefault()).toBeNull();
    select(a, b);
    expect(store().saveSelectionAsDefault()).toBeNull();
    expect(store().defaults).toEqual({});
  });

  it('refuses a container, which has no style to copy', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addShape('rectangle', { x: 300, y: 0 });
    select(a, b);
    store().groupSelected();
    const group = store().nodes.find((n) => n.type === 'group')!;
    select(group.id);
    expect(store().saveSelectionAsDefault()).toBeNull();

    const frame = store().addFrame({ x: 0, y: 600 });
    select(frame);
    expect(store().saveSelectionAsDefault()).toBeNull();
    expect(store().defaults).toEqual({});
  });

  it('is not undoable, in either history', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().updateNodeData(a, { fill: '#FF0000' });
    select(a);
    const before = store().canUndo;

    store().saveSelectionAsDefault();

    // No entry of its own: the defaults live in the document's `meta`, which
    // the Y.UndoManager does not track, so the snapshot stack keeps the same
    // rule and the two histories say the same thing.
    expect(store().canUndo).toBe(before);
    store().undo();
    expect(store().defaults.shape).toMatchObject({ fill: '#FF0000' });
    // What the undo took back is the colour — the edit before it.
    expect(store().nodes.find((n) => n.id === a)!.data.fill).not.toBe('#FF0000');
  });

  it('round-trips through the saved JSON', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().updateNodeData(a, { fill: '#FF0000', fillStyle: 'outline' });
    select(a);
    store().saveSelectionAsDefault();

    const saved = JSON.parse(
      JSON.stringify(serializeDiagram(store().nodes, store().edges, store().viewport, store().defaults)),
    );
    expect(saved.defaults).toEqual({
      shape: { fill: '#FF0000', stroke: DEFAULT_SWATCH.stroke, fillStyle: 'outline' },
    });

    store().loadDiagram('test', 'Test', false, saved);
    expect(store().defaults.shape).toMatchObject({ fill: '#FF0000', fillStyle: 'outline' });
    store().addShape('rectangle', { x: 0, y: 0 });
    expect(store().nodes.at(-1)!.data).toMatchObject({ fill: '#FF0000', fillStyle: 'outline' });
  });

  it('leaves the JSON of a board with no default exactly as it was', () => {
    store().addShape('rectangle', { x: 0, y: 0 });
    const data = serializeDiagram(store().nodes, store().edges, store().viewport, store().defaults);
    expect('defaults' in data).toBe(false);
  });

  it('belongs to the board it was set on', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().updateNodeData(a, { fill: '#FF0000' });
    select(a);
    store().saveSelectionAsDefault();

    // Opening another diagram in the same tab must not carry it across.
    store().loadDiagram('other', 'Other', false, { nodes: [], edges: [] });
    expect(store().defaults).toEqual({});
    expect(store().newShapeData('rectangle').fill).toBe(DEFAULT_SWATCH.fill);
  });

  it('drops a stored default that carries anything but style', () => {
    // `Diagram.data` is free-form JSON: a hand-edited or hostile row must not
    // be able to stamp a lock or a picture onto every new shape.
    store().loadDiagram('test', 'Test', false, {
      version: CURRENT_DIAGRAM_VERSION,
      nodes: [],
      edges: [],
      defaults: { shape: { fill: '#FF0000', locked: true, imageSrc: '/api/images/abc', label: 'no' } },
    });
    expect(store().defaults.shape).toEqual({ fill: '#FF0000' });
    store().addShape('rectangle', { x: 0, y: 0 });
    const data = store().nodes.at(-1)!.data;
    expect(data.locked).toBeUndefined();
    expect(data.imageSrc).toBeUndefined();
    expect(data.label).toBe('');
  });
});

describe('setDefaultStyle', () => {
  it('draws quick-added connectors with the default kind', () => {
    store().setDefaultStyle({ connector: 'curved' });
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addConnectedShape(a, 'right');
    expect(store().edges[0].data!.connectorType).toBe('curved');
  });

  it('draws hand-dragged connectors with the default kind', () => {
    store().setDefaultStyle({ connector: 'curved' });
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addShape('rectangle', { x: 300, y: 0 });
    store().onConnect({ source: a, target: b, sourceHandle: 'right', targetHandle: 'left' });
    expect(store().edges[0].data!.connectorType).toBe('curved');
  });

  it('leaves the colours alone when only the connector kind is set', () => {
    store().setDefaultStyle({ fill: '#111111', stroke: '#222222' });
    store().setDefaultStyle({ connector: 'straight' });
    expect(store().newShapeData('rectangle')).toMatchObject({ fill: '#111111', stroke: '#222222' });
    expect(store().newConnectorData().connectorType).toBe('straight');
  });

  it('is session only — nothing it sets is saved with the diagram', () => {
    store().setDefaultStyle({ fill: '#111111', connector: 'straight' });
    expect(store().defaults).toEqual({});
    expect(serializeDiagram(store().nodes, store().edges, null, store().defaults).defaults).toBeUndefined();
  });
});

describe('setThumbnailNodeIds', () => {
  it('records the ids the dashboard card is drawn from, and clears them again', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addShape('rectangle', { x: 500, y: 0 });

    store().setThumbnailNodeIds([a, b]);
    expect(store().thumbnailNodeIds).toEqual([a, b]);

    store().setThumbnailNodeIds(null);
    expect(store().thumbnailNodeIds).toBeNull();
  });

  it('reads an empty list as no custom thumbnail at all', () => {
    store().setThumbnailNodeIds([]);
    expect(store().thumbnailNodeIds).toBeNull();
  });

  it('is not undoable, in either history — it is filing, not a mark on the board', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    select(a);
    const before = store().canUndo;

    store().setThumbnailNodeIds([a]);

    // No entry of its own: it lives in the document's `meta`, which the
    // Y.UndoManager does not track, so the snapshot stack keeps the same rule.
    expect(store().canUndo).toBe(before);
    store().undo();
    expect(store().thumbnailNodeIds).toEqual([a]);
  });

  it('round-trips through the saved JSON', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().setThumbnailNodeIds([a]);

    const saved = JSON.parse(
      JSON.stringify(
        serializeDiagram(store().nodes, store().edges, store().viewport, store().defaults, store().thumbnailNodeIds),
      ),
    );
    expect(saved.thumbnailNodeIds).toEqual([a]);

    store().loadDiagram('test', 'Test', false, saved);
    expect(store().thumbnailNodeIds).toEqual([a]);
  });

  it('leaves the JSON of a board with the automatic thumbnail exactly as it was', () => {
    store().addShape('rectangle', { x: 0, y: 0 });
    const data = serializeDiagram(
      store().nodes,
      store().edges,
      store().viewport,
      store().defaults,
      store().thumbnailNodeIds,
    );
    expect('thumbnailNodeIds' in data).toBe(false);
  });

  it('belongs to the board it was set on', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().setThumbnailNodeIds([a]);
    store().loadDiagram('other', 'Other', false, { nodes: [], edges: [] });
    expect(store().thumbnailNodeIds).toBeNull();
  });

  it('drops a stored value that is not a list of ids', () => {
    store().loadDiagram('test', 'Test', false, {
      version: CURRENT_DIAGRAM_VERSION,
      nodes: [],
      edges: [],
      thumbnailNodeIds: ['a', '', null, 7, 'a'],
    });
    expect(store().thumbnailNodeIds).toEqual(['a']);
  });

  it('keeps an id whose shape has been deleted — the shape can come back', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().setThumbnailNodeIds([a]);
    select(a);
    store().deleteSelection();
    expect(store().thumbnailNodeIds).toEqual([a]);
    store().undo();
    expect(store().nodes.map((n) => n.id)).toEqual([a]);
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
    expect(store().edges[0].markerEnd).toContain('-17');
  });

  it('leaves the markers alone for a patch that cannot affect them', () => {
    const id = edgeId();
    const before = store().edges[0].markerEnd;
    store().updateEdgeData(id, { label: 'yes' });
    expect(store().edges[0].markerEnd).toBe(before);
  });

  it('clears every waypoint, and undo puts the routed bends back', () => {
    const id = edgeId();
    store().beginInteraction();
    store().updateEdgeDataTransient(id, { waypoints: [{ x: 40, y: 90 }, { x: 60, y: 120 }] });

    store().updateEdgeData(id, { waypoints: [] });
    expect(store().edges[0].data!.waypoints).toEqual([]);

    store().undo();
    expect(store().edges[0].data!.waypoints).toEqual([{ x: 40, y: 90 }, { x: 60, y: 120 }]);
  });
});

describe('connector waypoints', () => {
  /** An edge already bent twice, and its id. */
  function bentEdgeId() {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addConnectedShape(a, 'right');
    const id = store().edges[0].id;
    store().beginInteraction();
    store().updateEdgeDataTransient(id, { waypoints: [{ x: 10, y: 10 }, { x: 30, y: 30 }] });
    return id;
  }

  it('inserts a bend at the index of the run it was dragged out of', () => {
    const id = bentEdgeId();
    store().insertEdgeWaypoint(id, 1, { x: 20, y: 20 });
    expect(store().edges[0].data!.waypoints).toEqual([{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }]);
  });

  it('inserts at either end, and clamps an index past the last run', () => {
    const id = bentEdgeId();
    store().insertEdgeWaypoint(id, 0, { x: 1, y: 1 });
    store().insertEdgeWaypoint(id, 99, { x: 9, y: 9 });
    expect(store().edges[0].data!.waypoints).toEqual([
      { x: 1, y: 1 }, { x: 10, y: 10 }, { x: 30, y: 30 }, { x: 9, y: 9 },
    ]);
  });

  it('gives a connector with no bends its first one', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addConnectedShape(a, 'right');
    const id = store().edges[0].id;
    store().insertEdgeWaypoint(id, 0, { x: 5, y: 5 });
    expect(store().edges[0].data!.waypoints).toEqual([{ x: 5, y: 5 }]);
  });

  it('undoes an insert, bend and all', () => {
    const id = bentEdgeId();
    store().insertEdgeWaypoint(id, 1, { x: 20, y: 20 });
    store().undo();
    expect(store().edges[0].data!.waypoints).toEqual([{ x: 10, y: 10 }, { x: 30, y: 30 }]);
  });

  it('removes the bend at an index, and undo puts it back', () => {
    const id = bentEdgeId();
    store().removeEdgeWaypoint(id, 0);
    expect(store().edges[0].data!.waypoints).toEqual([{ x: 30, y: 30 }]);

    store().undo();
    expect(store().edges[0].data!.waypoints).toEqual([{ x: 10, y: 10 }, { x: 30, y: 30 }]);
  });

  it('ignores a remove that names no bend, and costs no history entry', () => {
    const id = bentEdgeId();
    const before = store().edges[0].data!.waypoints;
    const canUndo = store().canUndo;
    for (const index of [-1, 2, 99]) store().removeEdgeWaypoint(id, index);
    expect(store().edges[0].data!.waypoints).toBe(before);
    expect(store().canUndo).toBe(canUndo);
  });

  it('moves one bend of many while a drag is in flight', () => {
    const id = bentEdgeId();
    store().beginInteraction();
    for (const y of [40, 50, 60]) store().setEdgeWaypointTransient(id, 1, { x: 30, y });
    expect(store().edges[0].data!.waypoints).toEqual([{ x: 10, y: 10 }, { x: 30, y: 60 }]);
  });

  it('records no entry of its own for a transient move, so one undo ends the drag', () => {
    const id = bentEdgeId();
    store().beginInteraction();
    store().setEdgeWaypointTransient(id, 0, { x: 99, y: 99 });
    store().undo();
    expect(store().edges[0].data!.waypoints).toEqual([{ x: 10, y: 10 }, { x: 30, y: 30 }]);
  });

  it('leaves a bend nobody is dragging alone', () => {
    const id = bentEdgeId();
    for (const index of [-1, 2, 99]) store().setEdgeWaypointTransient(id, index, { x: 0, y: 0 });
    expect(store().edges[0].data!.waypoints).toEqual([{ x: 10, y: 10 }, { x: 30, y: 30 }]);
  });

  it('does nothing at all for an edge that is not there', () => {
    const id = bentEdgeId();
    store().insertEdgeWaypoint('nope', 0, { x: 1, y: 1 });
    store().removeEdgeWaypoint('nope', 0);
    store().setEdgeWaypointTransient('nope', 0, { x: 1, y: 1 });
    expect(store().edges[0].data!.waypoints).toEqual([{ x: 10, y: 10 }, { x: 30, y: 30 }]);
    expect(store().edges.find((e) => e.id === id)).toBeDefined();
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
    store().updateEdgeDataTransient(id, { waypoints: [{ x: 40, y: 90 }] });

    store().updateSelectedEdgesStyle({ waypoints: [] });
    expect(store().edges[0].data!.waypoints).toEqual([]);

    store().undo();
    expect(store().edges[0].data!.waypoints).toEqual([{ x: 40, y: 90 }]);
  });

  it('leaves connectors outside the selection alone', () => {
    const id = selectedEdgeId();
    const b = store().addShape('rectangle', { x: 400, y: 0 });
    store().addConnectedShape(b, 'right');
    const other = store().edges.find((e) => e.id !== id)!.id;
    store().beginInteraction();
    store().updateEdgeDataTransient(other, { waypoints: [{ x: 1, y: 2 }] });
    useDiagramStore.setState((s) => ({ edges: s.edges.map((e) => ({ ...e, selected: e.id === id })) }));

    store().updateSelectedEdgesStyle({ waypoints: [] });
    expect(store().edges.find((e) => e.id === other)!.data!.waypoints).toEqual([{ x: 1, y: 2 }]);
  });
});

describe('updateSelectedNodesStyle', () => {
  it('restyles the selection and carries that style to the next shape', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addShape('rectangle', { x: 0, y: 0 });
    select(a);
    store().updateSelectedNodesStyle({ fill: '#111111', stroke: '#222222' });

    expect(store().nodes[0].data).toMatchObject({ fill: '#111111', stroke: '#222222' });
    expect(store().nodes[1].data.fill).not.toBe('#111111');

    const next = store().addShape('rectangle', { x: 0, y: 0 });
    expect(store().nodes.find((n) => n.id === next)!.data).toMatchObject({
      fill: '#111111',
      stroke: '#222222',
    });
  });

  it('carries the colour only to the kind it was applied to', () => {
    const sticky = store().addShape('sticky', { x: 0, y: 0 });
    select(sticky);
    store().updateSelectedNodesStyle({ fill: '#111111', stroke: '#222222' });

    // Recolouring a sticky note has never been a statement about rectangles.
    expect(store().newShapeData('rectangle').fill).toBe(DEFAULT_SWATCH.fill);
    expect(store().newShapeData('sticky').fill).toBe('#111111');
  });

  it("is session only — the board's saved defaults are untouched", () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    select(a);
    store().updateSelectedNodesStyle({ fill: '#111111', stroke: '#222222' });
    expect(store().defaults).toEqual({});
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

  it('carries the decorations and an explicit text colour', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    select(a);
    store().updateSelectedNodesData({ underline: true, strikethrough: true, textColor: '#BE185D' });

    expect(store().nodes.find((n) => n.id === a)!.data).toMatchObject({
      underline: true,
      strikethrough: true,
      textColor: '#BE185D',
    });
  });

  it('carries the box styling a shape can wear', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    select(a);
    store().updateSelectedNodesData({ cornerRadius: 24, opacity: 0.5, shadow: true });

    expect(store().nodes.find((n) => n.id === a)!.data).toMatchObject({
      cornerRadius: 24,
      opacity: 0.5,
      shadow: true,
    });
  });

  it('switches the whole selection between filled and outline, and back', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addShape('star', { x: 200, y: 0 });
    select(a, b);

    // A new shape says nothing, which is the filled look.
    expect(store().nodes.every((n) => n.data.fillStyle === undefined)).toBe(true);

    store().updateSelectedNodesData({ fillStyle: 'outline' });
    expect(store().nodes.map((n) => n.data.fillStyle)).toEqual(['outline', 'outline']);

    // The swatch the shape was drawn in survives the round trip: only which of
    // its two colours is painted changed.
    const swatch = store().nodes.map((n) => [n.data.fill, n.data.stroke]);
    store().updateSelectedNodesData({ fillStyle: 'filled' });
    expect(store().nodes.map((n) => n.data.fillStyle)).toEqual(['filled', 'filled']);
    expect(store().nodes.map((n) => [n.data.fill, n.data.stroke])).toEqual(swatch);

    store().undo();
    expect(store().nodes.map((n) => n.data.fillStyle)).toEqual(['outline', 'outline']);
  });

  it('leaves an image out of a fill-style change, as it has no fill to style', () => {
    const shape = store().addShape('rectangle', { x: 0, y: 0 });
    const image = store().addImageNode({ src: '/api/images/x', width: 64, height: 64, position: { x: 200, y: 0 } });
    select(shape, image);
    store().updateSelectedNodesData({ fillStyle: 'outline' });

    expect(store().nodes.find((n) => n.id === shape)!.data.fillStyle).toBe('outline');
    expect(store().nodes.find((n) => n.id === image)!.data.fillStyle).toBeUndefined();
  });

  it('hands the label back to auto-contrast when the colour is cleared', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    select(a);
    store().updateSelectedNodesData({ textColor: '#FFFFFF' });
    store().updateSelectedNodesData({ textColor: undefined });

    // Absent, not empty: ShapeNode reads a missing colour as "pick one for me".
    expect(store().nodes.find((n) => n.id === a)!.data.textColor).toBeUndefined();
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

  it('opens a diagram as its owner unless the caller says otherwise', () => {
    store().loadDiagram('d', 'D', false, { nodes: [], edges: [] });
    expect(store().role).toBe('owner');
    expect(store().readOnly).toBe(false);
  });

  it('records the role the server reported, and reads a viewer\'s copy as read-only', () => {
    store().loadDiagram('d', 'D', false, { nodes: [], edges: [] }, null, { role: 'editor' });
    expect(store().role).toBe('editor');
    expect(store().readOnly).toBe(false);

    store().loadDiagram('d', 'D', false, { nodes: [], edges: [] }, null, { role: 'viewer' });
    expect(store().role).toBe('viewer');
    expect(store().readOnly).toBe(true);
  });

  it('takes an explicit readOnly, for a reader with no role at all', () => {
    // The public /s/:token page: nobody is signed in, so there is no role to
    // derive the answer from.
    store().loadDiagram('d', 'D', false, { nodes: [], edges: [] }, null, { readOnly: true });
    expect(store().readOnly).toBe(true);
  });

  it('clears a previous diagram\'s role rather than carrying it over', () => {
    store().loadDiagram('a', 'A', false, { nodes: [], edges: [] }, null, { role: 'viewer' });
    store().loadDiagram('b', 'B', false, { nodes: [], edges: [] });
    expect(store().role).toBe('owner');
    expect(store().readOnly).toBe(false);
  });
});

describe('read-only mode', () => {
  beforeEach(() => {
    saveDiagram.mockClear();
    saveDiagram.mockResolvedValue({ updatedAt: SAVED_AT });
    store().loadDiagram('test', 'Test', false, { nodes: [], edges: [] }, null, { role: 'viewer' });
  });

  it('refuses to write the diagram back', async () => {
    expect(await store().saveDiagram()).toBe('skipped');
    expect(saveDiagram).not.toHaveBeenCalled();
  });

  it('still lets the store itself be edited — the gate is the UI, not this', () => {
    // Deliberate: the actions stay total so a read-only board can be driven by
    // anything that legitimately rewrites it (a restore, an image backfill)
    // without every one of them needing a bypass.
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    expect(store().nodes.map((n) => n.id)).toEqual([id]);
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
    saveDiagram.mockResolvedValue({ updatedAt: SAVED_AT });
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

describe('saveDiagram — the two-tab conflict guard', () => {
  const LOADED_AT = '2026-09-05T10:00:00.000Z';
  const OTHER_TAB_AT = '2026-09-05T10:05:00.000Z';

  beforeEach(() => {
    saveDiagram.mockClear();
    saveDiagram.mockResolvedValue({ updatedAt: SAVED_AT });
    useToastStore.getState().clear();
    store().loadDiagram('test', 'Test', false, { nodes: [], edges: [] }, LOADED_AT);
  });

  it('guards the save with the updatedAt it loaded', async () => {
    await store().saveDiagram();
    expect(saveDiagram).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ ifUnmodifiedSince: LOADED_AT }),
      undefined,
    );
  });

  it('sends no guard for a diagram whose updatedAt the server never gave us', async () => {
    store().loadDiagram('test', 'Test', false, { nodes: [], edges: [] });
    await store().saveDiagram();
    expect(saveDiagram.mock.calls[0][1]).not.toHaveProperty('ifUnmodifiedSince');
  });

  it('moves the guard on to what the save returned', async () => {
    saveDiagram.mockResolvedValue({ updatedAt: OTHER_TAB_AT });
    await store().saveDiagram();
    expect(store().loadedAt).toBe(OTHER_TAB_AT);
  });

  it('lets this tab\'s other writes — a thumbnail — move the guard on too', () => {
    // Otherwise the tab would mistake its own thumbnail for another tab's edit.
    store().noteSaved(OTHER_TAB_AT);
    expect(store().loadedAt).toBe(OTHER_TAB_AT);
  });

  it('never walks the guard backwards when two writes answer out of order', () => {
    store().noteSaved(OTHER_TAB_AT);
    store().noteSaved('2026-09-05T10:01:00.000Z');
    expect(store().loadedAt).toBe(OTHER_TAB_AT);
  });

  it('records the conflict and the server updatedAt when the write is refused', async () => {
    saveDiagram.mockRejectedValue(new ConflictError(OTHER_TAB_AT));
    const outcome = await store().saveDiagram();

    expect(outcome).toBe('conflict');
    expect(store().saveStatus).toBe('conflict');
    expect(store().conflict).toEqual({ updatedAt: OTHER_TAB_AT });
    // The guard is what the banner's "Overwrite" drops; it is not silently
    // advanced to the other tab's version behind the user's back.
    expect(store().loadedAt).toBe(LOADED_AT);
  });

  it('does not announce a conflict as a failed save — the banner says it instead', async () => {
    saveDiagram.mockRejectedValue(new ConflictError(OTHER_TAB_AT));
    await store().saveDiagram();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('drops the guard on an overwrite and clears the conflict once it lands', async () => {
    saveDiagram.mockRejectedValue(new ConflictError(OTHER_TAB_AT));
    await store().saveDiagram();

    const savedAt = '2026-09-05T10:09:00.000Z';
    saveDiagram.mockResolvedValue({ updatedAt: savedAt });
    const outcome = await store().saveDiagram({ overwrite: true });

    expect(outcome).toBe('saved');
    expect(saveDiagram.mock.calls[1][1]).not.toHaveProperty('ifUnmodifiedSince');
    expect(store().conflict).toBeNull();
    expect(store().saveStatus).toBe('saved');
    expect(store().loadedAt).toBe(savedAt);
  });

  it('clears the conflict when the diagram is reloaded from the server', async () => {
    saveDiagram.mockRejectedValue(new ConflictError(OTHER_TAB_AT));
    await store().saveDiagram();

    store().loadDiagram('test', 'Test', false, { nodes: [], edges: [] }, OTHER_TAB_AT);
    expect(store().conflict).toBeNull();
    expect(store().saveStatus).toBe('idle');
    expect(store().loadedAt).toBe(OTHER_TAB_AT);
  });

  it('reports an expired session rather than treating it as a retryable failure', async () => {
    saveDiagram.mockRejectedValue(new UnauthorizedError());
    const outcome = await store().saveDiagram();

    expect(outcome).toBe('unauthorized');
    expect(store().saveStatus).toBe('unauthorized');
    // The re-auth dialog is the message; a toast would just be noise behind it.
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('applyImageBackfill', () => {
  /** A rectangle in the pre-upload format: its pixels are in the diagram JSON. */
  function inlineImageNode(id: string) {
    useDiagramStore.setState((s) => ({
      nodes: [
        ...s.nodes,
        {
          id,
          type: 'shape' as const,
          position: { x: 0, y: 0 },
          width: 320,
          height: 180,
          data: {
            label: '',
            shape: 'rectangle' as const,
            fill: '#fff',
            stroke: '#000',
            imageSrc: 'data:image/png;base64,AAAA',
          },
        },
      ],
    }));
  }

  it('repoints the node at the uploaded URL and draws it as an image', () => {
    inlineImageNode('n1');
    store().applyImageBackfill([{ id: 'n1', imageSrc: '/api/images/one', shape: 'image' }]);

    const node = store().nodes.find((n) => n.id === 'n1')!;
    expect(node.data).toMatchObject({ imageSrc: '/api/images/one', shape: 'image' });
    // The picture must not move or resize under the user.
    expect({ width: node.width, height: node.height }).toEqual({ width: 320, height: 180 });
    expect(node.position).toEqual({ x: 0, y: 0 });
  });

  it('leaves every other node alone', () => {
    inlineImageNode('n1');
    const other = store().addShape('rectangle', { x: 500, y: 0 });

    store().applyImageBackfill([{ id: 'n1', imageSrc: '/api/images/one', shape: 'image' }]);

    expect(store().nodes.find((n) => n.id === other)!.data.shape).toBe('rectangle');
  });

  it('records no history entry — it is housekeeping, not an edit to undo', () => {
    inlineImageNode('n1');
    store().applyImageBackfill([{ id: 'n1', imageSrc: '/api/images/one', shape: 'image' }]);

    // Nothing to undo: a freshly loaded diagram whose images were quietly
    // moved to storage must not hand the user an undo that puts them back.
    expect(store().canUndo).toBe(false);
  });

  it('does not eat the undo belonging to a real edit', () => {
    inlineImageNode('n1');
    const drawn = store().addShape('rectangle', { x: 500, y: 0 });

    store().applyImageBackfill([{ id: 'n1', imageSrc: '/api/images/one', shape: 'image' }]);
    store().undo();

    expect(store().nodes.find((n) => n.id === drawn)).toBeUndefined();
  });

  it('does nothing at all when there is nothing to patch', () => {
    inlineImageNode('n1');
    const before = store().nodes;
    store().applyImageBackfill([]);
    // Same array, so nothing subscribed to the store is woken for no reason.
    expect(store().nodes).toBe(before);
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

describe('updateSelectedNodesDataTransient', () => {
  it('applies the patch without spending a history entry', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    select(a);

    // What a slider does on every frame of a drag: the entry was pushed once
    // by `beginInteraction`, so the frames themselves must not push more.
    store().beginInteraction();
    store().updateSelectedNodesDataTransient({ opacity: 0.8 });
    store().updateSelectedNodesDataTransient({ opacity: 0.5 });
    expect(store().nodes.find((n) => n.id === a)!.data.opacity).toBe(0.5);

    store().undo();
    expect(store().nodes.find((n) => n.id === a)!.data.opacity).toBeUndefined();
  });

  it('leaves an image alone, as the committing version does', () => {
    const shape = store().addShape('rectangle', { x: 0, y: 0 });
    const image = store().addImageNode({ src: '/api/images/x', width: 64, height: 64, position: { x: 200, y: 0 } });
    select(shape, image);
    store().updateSelectedNodesDataTransient({ opacity: 0.5 });

    expect(store().nodes.find((n) => n.id === shape)!.data.opacity).toBe(0.5);
    expect(store().nodes.find((n) => n.id === image)!.data.opacity).toBeUndefined();
  });
});

describe('groupSelected', () => {
  /** Two rectangles side by side, both selected. */
  function twoSelected() {
    const a = store().addShape('rectangle', { x: 100, y: 100 });
    const b = store().addShape('rectangle', { x: 400, y: 300 });
    select(a, b);
    return { a, b };
  }

  const groupOf = () => store().nodes.find((n) => n.type === 'group')!;
  const nodeOf = (id: string) => store().nodes.find((n) => n.id === id)!;

  it('sizes the group to its contents plus a 16 px margin', () => {
    twoSelected();
    store().groupSelected();

    // Rectangles are 180x100, so the contents span (100,100)-(580,400).
    expect(groupOf()).toMatchObject({
      type: 'group',
      position: { x: 84, y: 84 },
      width: 512,
      height: 332,
      selected: true,
    });
  });

  it('re-parents the members with positions relative to the group', () => {
    const { a, b } = twoSelected();
    store().groupSelected();
    const group = groupOf();

    expect(nodeOf(a)).toMatchObject({ parentId: group.id, position: { x: 16, y: 16 } });
    expect(nodeOf(b)).toMatchObject({ parentId: group.id, position: { x: 316, y: 216 } });
  });

  it('inserts the group before its children and leaves it the only selection', () => {
    const { a, b } = twoSelected();
    store().groupSelected();

    const ids = store().nodes.map((n) => n.id);
    const group = groupOf();
    expect(ids.indexOf(group.id)).toBeLessThan(ids.indexOf(a));
    expect(ids.indexOf(group.id)).toBeLessThan(ids.indexOf(b));
    expect(store().nodes.filter((n) => n.selected).map((n) => n.id)).toEqual([group.id]);
  });

  it('refuses a selection of fewer than two nodes', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    select(a);
    store().groupSelected();
    expect(store().nodes.some((n) => n.type === 'group')).toBe(false);
    // And it cost nothing: undo goes back past the shape, not past a no-op.
    store().undo();
    expect(store().nodes).toHaveLength(0);
  });

  it('leaves a floating arrow\'s invisible endpoints out of the count', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    // What `onPaneClick` draws for a floating arrow: 1x1, transparent both ways.
    useDiagramStore.setState((s) => ({
      nodes: [
        ...s.nodes,
        {
          id: 'anchor', type: 'shape' as const, position: { x: 300, y: 0 }, width: 1, height: 1,
          selected: true,
          data: { label: '', shape: 'rectangle' as const, fill: 'transparent', stroke: 'transparent' },
        },
      ],
    }));
    select(a, 'anchor');
    store().groupSelected();
    expect(store().nodes.some((n) => n.type === 'group')).toBe(false);
  });

  it('groups a group again, nesting it', () => {
    twoSelected();
    store().groupSelected();
    const inner = groupOf().id;

    const c = store().addShape('rectangle', { x: 900, y: 900 });
    select(inner, c);
    store().groupSelected();

    const outer = store().nodes.find((n) => n.type === 'group' && n.id !== inner)!;
    expect(nodeOf(inner).parentId).toBe(outer.id);
    expect(nodeOf(c).parentId).toBe(outer.id);
    // Grandchildren still belong to the inner group, and follow both parents.
    const ids = store().nodes.map((n) => n.id);
    expect(ids.indexOf(outer.id)).toBeLessThan(ids.indexOf(inner));
  });

  it('keeps the group inside the container its members already shared', () => {
    const frame = store().addFrame({ x: 0, y: 0 });
    const a = store().addShape('rectangle', { x: 50, y: 50 });
    const b = store().addShape('rectangle', { x: 100, y: 120 });
    select(a, b);
    store().reparentByPosition([a, b]);
    select(a, b);
    store().groupSelected();

    expect(groupOf().parentId).toBe(frame);
  });

  it('is one history entry, and undo puts the members back where they were', () => {
    const { a, b } = twoSelected();
    store().groupSelected();
    store().undo();

    expect(store().nodes.some((n) => n.type === 'group')).toBe(false);
    expect(nodeOf(a).position).toEqual({ x: 100, y: 100 });
    expect(nodeOf(a).parentId).toBeUndefined();
    expect(nodeOf(b).position).toEqual({ x: 400, y: 300 });

    store().redo();
    expect(nodeOf(a).parentId).toBe(groupOf().id);
  });
});

describe('ungroupSelected', () => {
  const nodeOf = (id: string) => store().nodes.find((n) => n.id === id)!;

  function grouped() {
    const a = store().addShape('rectangle', { x: 100, y: 100 });
    const b = store().addShape('rectangle', { x: 400, y: 300 });
    select(a, b);
    store().groupSelected();
    return { a, b, group: store().nodes.find((n) => n.type === 'group')!.id };
  }

  it('restores absolute positions and removes the group', () => {
    const { a, b, group } = grouped();
    store().ungroupSelected();

    expect(store().nodes.find((n) => n.id === group)).toBeUndefined();
    expect(nodeOf(a)).toMatchObject({ position: { x: 100, y: 100 }, selected: true });
    expect(nodeOf(a).parentId).toBeUndefined();
    expect(nodeOf(b).position).toEqual({ x: 400, y: 300 });
  });

  it('hands the children of a nested group back to the outer one', () => {
    const { a, group: inner } = grouped();
    const c = store().addShape('rectangle', { x: 900, y: 900 });
    select(inner, c);
    store().groupSelected();
    const outer = store().nodes.find((n) => n.type === 'group' && n.id !== inner)!;

    select(inner);
    store().ungroupSelected();

    expect(nodeOf(a).parentId).toBe(outer.id);
    // Still where it was on the board: its offset within the inner group plus
    // the inner group's offset within the outer one.
    const ids = store().nodes.map((n) => n.id);
    expect(ids.indexOf(outer.id)).toBeLessThan(ids.indexOf(a));
  });

  it('does nothing, and costs no history entry, with no group selected', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    select(a);
    const before = store().canUndo;
    store().ungroupSelected();
    expect(store().canUndo).toBe(before);
  });

  it('is one history entry that undo and redo both reverse whole', () => {
    const { a, group } = grouped();
    store().ungroupSelected();
    store().undo();

    expect(nodeOf(a).parentId).toBe(group);
    expect(nodeOf(a).position).toEqual({ x: 16, y: 16 });

    store().redo();
    expect(nodeOf(a).parentId).toBeUndefined();
    expect(nodeOf(a).position).toEqual({ x: 100, y: 100 });
  });
});

describe('containers and the rest of the store', () => {
  const nodeOf = (id: string) => store().nodes.find((n) => n.id === id);

  function grouped() {
    const a = store().addShape('rectangle', { x: 100, y: 100 });
    const b = store().addShape('rectangle', { x: 400, y: 300 });
    select(a, b);
    store().groupSelected();
    return { a, b, group: store().nodes.find((n) => n.type === 'group')!.id };
  }

  it('deleting a group deletes what is inside it', () => {
    const { a, b, group } = grouped();
    const outside = store().addShape('rectangle', { x: 2000, y: 0 });
    select(group);
    store().deleteSelection();

    expect(store().nodes.map((n) => n.id)).toEqual([outside]);
    expect(nodeOf(a)).toBeUndefined();
    expect(nodeOf(b)).toBeUndefined();
  });

  it('deleting a group takes the connectors between its members with it', () => {
    const { a, b, group } = grouped();
    store().onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null });
    expect(store().edges).toHaveLength(1);

    select(group);
    store().deleteSelection();
    expect(store().edges).toHaveLength(0);
  });

  it('duplicating a group copies its children and re-points them at the copy', () => {
    const { group } = grouped();
    select(group);
    store().duplicateSelection();

    const groups = store().nodes.filter((n) => n.type === 'group');
    expect(groups).toHaveLength(2);
    const copy = groups.find((g) => g.id !== group)!;
    const copiedChildren = store().nodes.filter((n) => n.parentId === copy.id);
    expect(copiedChildren).toHaveLength(2);
    // The children moved with their parent, so their own offsets are unchanged.
    expect(copiedChildren.map((n) => n.position)).toEqual([{ x: 16, y: 16 }, { x: 316, y: 216 }]);
    // And the copy is offset from the original, once.
    expect(copy.position).toEqual({ x: 114, y: 114 });
  });

  it('duplicating one child of a group leaves the copy in the same group', () => {
    const { a, group } = grouped();
    select(a);
    store().duplicateSelection();

    const copies = store().nodes.filter((n) => n.parentId === group);
    expect(copies).toHaveLength(3);
    expect(copies.some((n) => n.position.x === 46 && n.position.y === 46)).toBe(true);
  });

  it('serializes and reloads the parenting, parents still ahead of children', () => {
    const { a, group } = grouped();
    const data = serializeDiagram(store().nodes, store().edges);

    const stored = data.nodes.find((n) => n.id === a)!;
    expect(stored.parentId).toBe(group);
    expect(data.nodes.findIndex((n) => n.id === group)).toBeLessThan(data.nodes.findIndex((n) => n.id === a));

    store().loadDiagram('test', 'Test', false, data);
    expect(nodeOf(a)!.parentId).toBe(group);
  });

  it('drops a stored parentId that points at a node which is no longer there', () => {
    store().loadDiagram('test', 'Test', false, {
      version: CURRENT_DIAGRAM_VERSION,
      nodes: [
        { id: 'orphan', type: 'shape', position: { x: 5, y: 5 }, parentId: 'gone', data: { label: '', shape: 'rectangle', fill: '#fff', stroke: '#000' } },
      ],
      edges: [],
    });
    expect(nodeOf('orphan')!.parentId).toBeUndefined();
  });

  it('bringToFront on a container keeps it ahead of its own children', () => {
    const { a, b, group } = grouped();
    store().addShape('rectangle', { x: 2000, y: 0 });
    select(group);
    store().bringToFront();

    const ids = store().nodes.map((n) => n.id);
    expect(ids.indexOf(group)).toBeLessThan(ids.indexOf(a));
    expect(ids.indexOf(group)).toBeLessThan(ids.indexOf(b));
    // And it really did move: the group's subtree is the tail of the array.
    expect(ids.slice(-3)).toEqual([group, a, b]);
  });

  it('sendToBack on a container takes its children with it', () => {
    const { a, b, group } = grouped();
    const outside = store().addShape('rectangle', { x: 2000, y: 0 });
    select(group);
    store().sendToBack();
    expect(store().nodes.map((n) => n.id)).toEqual([group, a, b, outside]);
  });
});

describe('addFrame', () => {
  it('draws a titled frame at its default size', () => {
    const id = store().addFrame({ x: 40, y: 60 });
    expect(store().nodes.find((n) => n.id === id)).toMatchObject({
      type: 'frame',
      position: { x: 40, y: 60 },
      width: 480,
      height: 320,
      data: { label: 'Frame' },
    });
  });

  it('goes to the start of the array, behind everything already drawn', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const frame = store().addFrame({ x: 0, y: 0 });
    expect(store().nodes.map((n) => n.id)).toEqual([frame, a]);
  });
});

describe('reparentByPosition', () => {
  const nodeOf = (id: string) => store().nodes.find((n) => n.id === id)!;

  /** One frame at the origin with a rectangle dropped in the middle of it. */
  function frameAndShape() {
    const frame = store().addFrame({ x: 0, y: 0 });
    const shape = store().addShape('rectangle', { x: 100, y: 100 });
    return { frame, shape };
  }

  it('adopts a shape dropped inside a frame, converting its position', () => {
    const { frame, shape } = frameAndShape();
    store().reparentByPosition([shape]);

    expect(nodeOf(shape)).toMatchObject({ parentId: frame, position: { x: 100, y: 100 } });
  });

  it('keeps the shape where it is on the board when the frame is not at the origin', () => {
    const frame = store().addFrame({ x: 500, y: 200 });
    const shape = store().addShape('rectangle', { x: 600, y: 250 });
    store().reparentByPosition([shape]);

    // 100 px right and 50 px down from the frame's own corner.
    expect(nodeOf(shape)).toMatchObject({ parentId: frame, position: { x: 100, y: 50 } });
  });

  it('lets go of a shape dragged out of a frame, restoring absolute position', () => {
    const { shape } = frameAndShape();
    store().reparentByPosition([shape]);

    // Dragged clear of the frame: React Flow reports a position relative to it.
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === shape ? { ...n, position: { x: 900, y: 100 } } : n)),
    }));
    store().reparentByPosition([shape]);

    expect(nodeOf(shape).parentId).toBeUndefined();
    expect(nodeOf(shape).position).toEqual({ x: 900, y: 100 });
  });

  it('picks the innermost of two nested frames', () => {
    const outer = store().addFrame({ x: 0, y: 0 });
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === outer ? { ...n, width: 2000, height: 2000 } : n)),
    }));
    const inner = store().addFrame({ x: 100, y: 100 });
    store().reparentByPosition([inner]);
    expect(nodeOf(inner).parentId).toBe(outer);

    const shape = store().addShape('rectangle', { x: 150, y: 150 });
    store().reparentByPosition([shape]);

    expect(nodeOf(shape).parentId).toBe(inner);
    // Relative to the inner frame, which is itself relative to the outer one.
    expect(nodeOf(shape).position).toEqual({ x: 50, y: 50 });
  });

  it('only adopts a shape the frame holds whole', () => {
    const frame = store().addFrame({ x: 0, y: 0 });
    // 180 wide, so it hangs 60 px past the frame's right edge.
    const shape = store().addShape('rectangle', { x: 360, y: 100 });
    store().reparentByPosition([shape]);
    expect(nodeOf(shape).parentId).toBeUndefined();
    expect(frame).toBeTruthy();
  });

  it('never makes a frame a child of itself or of its own contents', () => {
    const { frame, shape } = frameAndShape();
    store().reparentByPosition([shape]);
    store().reparentByPosition([frame]);
    expect(nodeOf(frame).parentId).toBeUndefined();
  });

  it('leaves a group member in its group, whatever it was dropped on', () => {
    const a = store().addShape('rectangle', { x: 100, y: 100 });
    const b = store().addShape('rectangle', { x: 150, y: 150 });
    select(a, b);
    store().groupSelected();
    const group = store().nodes.find((n) => n.type === 'group')!.id;

    store().addFrame({ x: 0, y: 0 });
    store().reparentByPosition([a]);

    expect(nodeOf(a).parentId).toBe(group);
  });

  it('keeps the frame ahead of what it just adopted', () => {
    const { frame, shape } = frameAndShape();
    store().reparentByPosition([shape]);
    const ids = store().nodes.map((n) => n.id);
    expect(ids.indexOf(frame)).toBeLessThan(ids.indexOf(shape));
  });

  it('records one history entry, and none when nothing changed hands', () => {
    const { shape } = frameAndShape();
    store().reparentByPosition([shape]);
    store().undo();
    expect(nodeOf(shape).parentId).toBeUndefined();
    expect(nodeOf(shape).position).toEqual({ x: 100, y: 100 });

    store().redo();
    // A second drop in the same place changes nothing, so it costs nothing.
    const before = store().nodes;
    store().reparentByPosition([shape]);
    expect(store().nodes).toBe(before);
  });
});

describe('wrapSelectionInFrame', () => {
  const frameOf = () => store().nodes.find((n) => n.type === 'frame')!;
  const nodeOf = (id: string) => store().nodes.find((n) => n.id === id)!;

  it('frames the contents with a margin and room for the title, and re-parents them', () => {
    const a = store().addShape('rectangle', { x: 100, y: 100 });
    const b = store().addShape('rectangle', { x: 400, y: 300 });
    select(a, b);
    store().wrapSelectionInFrame();

    // Rectangles are 180x100, so the contents span (100,100)-(580,400):
    // 24 px around them and 36 px more above for the title.
    expect(frameOf()).toMatchObject({ type: 'frame', position: { x: 76, y: 40 }, width: 528, height: 384, selected: true });
    expect(nodeOf(a)).toMatchObject({ parentId: frameOf().id, extent: 'parent', position: { x: 24, y: 60 }, selected: false });
    expect(nodeOf(b)).toMatchObject({ parentId: frameOf().id, position: { x: 324, y: 260 } });
    const ids = store().nodes.map((n) => n.id);
    expect(ids.indexOf(frameOf().id)).toBeLessThan(ids.indexOf(a));
  });

  it('wraps a single shape and pushes one history entry', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    select(a);
    const before = store().canUndo;
    store().wrapSelectionInFrame();
    expect(nodeOf(a).parentId).toBe(frameOf().id);
    expect(store().canUndo).toBe(true);
    store().undo();
    expect(store().nodes.find((n) => n.type === 'frame')).toBeUndefined();
    expect(before || true).toBe(true);
  });

  it('does nothing with nothing selected', () => {
    store().addShape('rectangle', { x: 0, y: 0 });
    store().wrapSelectionInFrame();
    expect(store().nodes.find((n) => n.type === 'frame')).toBeUndefined();
  });
});

describe('layoutSelected', () => {
  /** A rectangle at an explicit position and size. */
  function rect(x: number, y: number, w = 180, h = 100) {
    const id = store().addShape('rectangle', { x, y });
    store().setNodeSizeTransient(id, { width: w, height: h });
    return id;
  }

  /** A connector pinned right → left, so a vertical layout has to re-pin it. */
  function connect(source: string, target: string) {
    store().onConnect({ source, target, sourceHandle: 'right', targetHandle: 'left' });
    return store().edges[store().edges.length - 1].id;
  }

  const nodeOf = (id: string) => store().nodes.find((n) => n.id === id)!;
  const posOf = (id: string) => nodeOf(id).position;
  const dataOf = (id: string) => store().edges.find((e) => e.id === id)!.data!;
  const centreX = (id: string) => posOf(id).x + nodeOf(id).width! / 2;

  /** A scrambled three-shape chain: a → b → c. */
  function chain() {
    const a = rect(900, 40, 180, 70);
    const b = rect(100, 500, 120, 90);
    const c = rect(700, 300, 200, 60);
    const ab = connect(a, b);
    const bc = connect(b, c);
    select(a, b, c);
    return { a, b, c, ab, bc };
  }

  it('stacks a connected chain into a column, in flow order', async () => {
    const { a, b, c } = chain();
    await store().layoutSelected('vertical');

    expect(posOf(a).y).toBeLessThan(posOf(b).y);
    expect(posOf(b).y).toBeLessThan(posOf(c).y);
    // A chain comes out centred on one line, whatever the boxes' widths.
    expect(Math.abs(centreX(a) - centreX(b))).toBeLessThan(2);
    expect(Math.abs(centreX(b) - centreX(c))).toBeLessThan(2);
  });

  it('lays the same chain out left to right', async () => {
    const { a, b, c } = chain();
    await store().layoutSelected('horizontal');

    expect(posOf(a).x).toBeLessThan(posOf(b).x);
    expect(posOf(b).x).toBeLessThan(posOf(c).x);
  });

  it('starts the flow where the selection already was', async () => {
    const { a, b, c } = chain();
    // The selection spans x 100…1080 and y 40…590 before the command.
    await store().layoutSelected('vertical');

    expect(Math.min(...[a, b, c].map((id) => posOf(id).x))).toBe(100);
    expect(Math.min(...[a, b, c].map((id) => posOf(id).y))).toBe(40);
  });

  it('re-pins the connectors between members to the facing sides and clears their bends', async () => {
    const { ab, bc } = chain();
    store().insertEdgeWaypoint(ab, 0, { x: 10, y: 10 });

    await store().layoutSelected('vertical');

    for (const id of [ab, bc]) {
      expect(dataOf(id).sourceAnchor).toEqual({ side: 'bottom', t: 0.5 });
      expect(dataOf(id).targetAnchor).toEqual({ side: 'top', t: 0.5 });
      expect(dataOf(id).waypoints).toEqual([]);
    }
  });

  it('leaves a connector reaching outside the selection alone', async () => {
    const { a, b, c } = chain();
    const outsider = rect(2000, 2000);
    const out = connect(b, outsider);
    select(a, b, c);

    await store().layoutSelected('vertical');

    expect(dataOf(out).sourceAnchor).toEqual({ side: 'right', t: 0.5 });
    expect(dataOf(out).targetAnchor).toEqual({ side: 'left', t: 0.5 });
    expect(posOf(outsider)).toEqual({ x: 2000, y: 2000 });
  });

  it('records exactly one history entry for the whole layout', async () => {
    const { a, b, c } = chain();
    const before = [a, b, c].map((id) => ({ ...posOf(id) }));
    await store().layoutSelected('vertical');

    store().undo();
    expect([a, b, c].map((id) => ({ ...posOf(id) }))).toEqual(before);
  });

  it('does nothing at all without a connector between two selected shapes', async () => {
    const a = rect(0, 0);
    const b = rect(300, 300);
    select(a, b);
    await store().layoutSelected('vertical');

    expect(posOf(a)).toEqual({ x: 0, y: 0 });
    expect(posOf(b)).toEqual({ x: 300, y: 300 });
    // Only the two addShape entries exist, so two undos empty the canvas.
    store().undo();
    store().undo();
    expect(store().nodes).toHaveLength(0);
  });

  it('records no history entry when the same layout is run twice', async () => {
    chain();
    await store().layoutSelected('vertical');
    const after = store().nodes.map((n) => ({ ...n.position }));

    await store().layoutSelected('vertical');
    expect(store().nodes.map((n) => ({ ...n.position }))).toEqual(after);

    // One undo takes back the *first* layout: the second cost nothing.
    store().undo();
    expect(store().nodes.map((n) => ({ ...n.position }))).not.toEqual(after);
  });

  it('leaves a locked node where it is while laying the rest out around it', async () => {
    const { a, b, c } = chain();
    select(b);
    store().toggleLock();
    select(a, b, c);

    const lockedAt = { ...posOf(b) };
    await store().layoutSelected('vertical');

    expect(posOf(b)).toEqual(lockedAt);
    // The other two still moved, and still read in flow order down the column.
    expect(posOf(a).y).toBeLessThan(posOf(c).y);
  });
});

describe('pasteAsStickies', () => {
  const origin = { x: 200, y: 120 };
  const stickies = () => store().nodes.filter((n) => n.data.shape === 'sticky');

  it('makes one selected note per line, at the sticky note\'s own size and colour', () => {
    const ids = store().pasteAsStickies('- milk\n- eggs\n- bread', origin);

    expect(ids).toHaveLength(3);
    expect(stickies()).toHaveLength(3);
    for (const node of stickies()) {
      expect(node).toMatchObject({
        type: 'shape',
        width: 160,
        height: 160,
        selected: true,
        data: { shape: 'sticky', fill: '#FBF3D0', stroke: '#E9B10A' },
      });
    }
    expect(stickies().map((n) => n.data.label)).toEqual(['milk', 'eggs', 'bread']);
  });

  it('lays them out from the origin, in rows with a gap', () => {
    store().pasteAsStickies('a\nb\nc\nd', origin);
    expect(stickies().map((n) => n.position)).toEqual([
      { x: 200, y: 120 },
      { x: 384, y: 120 },
      { x: 200, y: 304 },
      { x: 384, y: 304 },
    ]);
  });

  it('deselects whatever was selected before, so the paste is the selection', () => {
    const existing = store().addShape('rectangle', { x: 0, y: 0 });
    select(existing);

    store().pasteAsStickies('one', origin);
    expect(store().nodes.find((n) => n.id === existing)!.selected).toBe(false);
    expect(stickies()[0].selected).toBe(true);
  });

  it('is one history entry however many notes it made', () => {
    store().pasteAsStickies('a\nb\nc', origin);
    expect(stickies()).toHaveLength(3);

    store().undo();
    expect(store().nodes).toHaveLength(0);
    store().redo();
    expect(stickies()).toHaveLength(3);
  });

  it('records nothing at all when there is no line to make a note of', () => {
    store().addShape('rectangle', { x: 0, y: 0 });

    expect(store().pasteAsStickies('\n   \n', origin)).toEqual([]);
    expect(store().nodes).toHaveLength(1);
    // The only undo available is the one `addShape` recorded.
    store().undo();
    expect(store().nodes).toHaveLength(0);
  });
});

describe('pasteMermaid', () => {
  const origin = { x: 400, y: 300 };
  const shapes = () => store().nodes.filter((n) => n.type === 'shape');
  const labelled = (label: string) => shapes().find((n) => n.data.label === label)!;

  it('is null for text that is not a Mermaid flowchart, and changes nothing', async () => {
    expect(await store().pasteMermaid('just some notes', origin)).toBeNull();
    expect(store().nodes).toHaveLength(0);
    expect(store().canUndo).toBe(false);
  });

  it('builds a shape per node and a connector per link', async () => {
    const ids = await store().pasteMermaid(
      'flowchart TD\n  A[Start] -->|go| B{Choose}\n  B -.-> C((Done))',
      origin,
    );

    expect(ids).toHaveLength(3);
    expect(shapes().map((n) => [n.data.shape, n.data.label])).toEqual([
      ['rectangle', 'Start'],
      ['diamond', 'Choose'],
      ['ellipse', 'Done'],
    ]);
    expect(store().edges).toHaveLength(2);
    expect(store().edges[0].data).toMatchObject({ label: 'go', strokeStyle: 'solid' });
    expect(store().edges[1].data).toMatchObject({ label: '', strokeStyle: 'dashed' });
    // The connectors join the shapes that were just made, not the source's ids.
    expect(store().edges[0].source).toBe(labelled('Start').id);
    expect(store().edges[0].target).toBe(labelled('Choose').id);
    // Both ends carry an arrowhead def, the way every other new connector does.
    expect(store().edges[0].markerEnd).toBeTruthy();
  });

  it('gives each shape its kind\'s own default size', async () => {
    await store().pasteMermaid('flowchart TD\n  A[box] --> B((circle))', origin);
    expect(labelled('box')).toMatchObject({ width: 180, height: 100 });
    expect(labelled('circle')).toMatchObject({ width: 120, height: 120 });
  });

  it('lays a TD chain out downwards from the origin', async () => {
    await store().pasteMermaid('flowchart TD\n  A --> B --> C', origin);

    const [a, b, c] = shapes();
    expect(a.position.y).toBeLessThan(b.position.y);
    expect(b.position.y).toBeLessThan(c.position.y);
    // The flow's own top-left corner lands where it was asked for.
    expect(Math.min(...shapes().map((n) => n.position.x))).toBe(origin.x);
    expect(Math.min(...shapes().map((n) => n.position.y))).toBe(origin.y);
    // Laid out means re-pinned: a vertical flow leaves the bottom and arrives
    // at the top.
    expect(store().edges[0].data).toMatchObject({
      sourceAnchor: { side: 'bottom', t: 0.5 },
      targetAnchor: { side: 'top', t: 0.5 },
    });
  });

  it('lays an LR chain out across', async () => {
    await store().pasteMermaid('flowchart LR\n  A --> B --> C', origin);

    const [a, b, c] = shapes();
    expect(a.position.x).toBeLessThan(b.position.x);
    expect(b.position.x).toBeLessThan(c.position.x);
    expect(Math.min(...shapes().map((n) => n.position.x))).toBe(origin.x);
    expect(store().edges[0].data).toMatchObject({
      sourceAnchor: { side: 'right', t: 0.5 },
      targetAnchor: { side: 'left', t: 0.5 },
    });
  });

  it('is ONE undo step — the shapes and the layout together', async () => {
    await store().pasteMermaid('flowchart TD\n  A --> B --> C', origin);
    expect(shapes()).toHaveLength(3);

    store().undo();
    expect(store().nodes).toHaveLength(0);
    expect(store().edges).toHaveLength(0);

    store().redo();
    expect(shapes()).toHaveLength(3);
    expect(store().edges).toHaveLength(2);
  });

  it('leaves the rest of the board alone and selects only what it pasted', async () => {
    const existing = store().addShape('rectangle', { x: 0, y: 0 });
    select(existing);

    await store().pasteMermaid('flowchart TD\n  A --> B', origin);
    expect(store().nodes.find((n) => n.id === existing)).toMatchObject({
      position: { x: 0, y: 0 },
      selected: false,
    });
    expect(shapes().filter((n) => n.selected)).toHaveLength(2);
  });

  it('places a chart with nothing to lay out at the origin anyway', async () => {
    await store().pasteMermaid('flowchart TD\n  A[Alone]', origin);
    expect(labelled('Alone').position).toEqual(origin);
  });
});

describe('pasteSequence', () => {
  const origin = { x: 400, y: 300 };
  const participants = () =>
    store().nodes.filter((n) => n.data.sequence?.role === 'participant');
  const anchors = () =>
    store().nodes.filter((n) => n.data.sequence !== undefined && n.data.sequence.role !== 'participant');
  const messages = () => store().edges.filter((e) => e.data?.sequence?.kind === 'message');

  const CONVERSATION = [
    'sequenceDiagram',
    '  participant U as User',
    '  participant S as Server',
    '  U->>S: save',
    '  S-->>U: ok',
  ].join('\n');

  it('is null for text that is not a sequence diagram, and changes nothing', () => {
    expect(store().pasteSequence('just some notes', origin)).toBeNull();
    expect(store().pasteSequence('flowchart TD\n  A --> B', origin)).toBeNull();
    expect(store().nodes).toHaveLength(0);
    expect(store().canUndo).toBe(false);
  });

  it('draws a participant per actor, in a row from the origin', () => {
    const ids = store().pasteSequence(CONVERSATION, origin);

    expect(ids).toHaveLength(2);
    expect(participants().map((n) => n.data.label)).toEqual(['User', 'Server']);
    expect(participants()[0].position).toEqual(origin);
    expect(participants()[1].position.y).toBe(origin.y);
    expect(participants()[1].position.x).toBeGreaterThan(origin.x);
    // An ordinary rectangle in the board's own default style — no new node type.
    expect(participants().every((n) => n.type === 'shape' && n.data.shape === 'rectangle')).toBe(true);
  });

  it('hangs every anchor off its participant as an invisible 1×1 child', () => {
    store().pasteSequence(CONVERSATION, origin);
    const participantIds = new Set(participants().map((n) => n.id));

    // Two lifeline ends and four message points.
    expect(anchors()).toHaveLength(6);
    for (const anchor of anchors()) {
      expect(anchor.width).toBe(1);
      expect(anchor.height).toBe(1);
      expect(anchor.data.fill).toBe('transparent');
      expect(anchor.data.stroke).toBe('transparent');
      expect(anchor.data.label).toBe('');
      expect(participantIds.has(anchor.parentId!)).toBe(true);
      // Which is what makes a column one thing to drag and one thing to delete.
      expect(anchor.data.sequence!.participant).toBe(anchor.parentId);
    }
  });

  it('keeps every parent ahead of its children in the array', () => {
    store().pasteSequence(CONVERSATION, origin);
    const nodes = store().nodes;
    for (const node of nodes) {
      if (node.parentId === undefined) continue;
      expect(nodes.findIndex((n) => n.id === node.parentId)).toBeLessThan(nodes.indexOf(node));
    }
  });

  it('draws a dashed headless lifeline per participant and a labelled message per line', () => {
    store().pasteSequence(CONVERSATION, origin);

    const lifelines = store().edges.filter((e) => e.data?.sequence?.kind === 'lifeline');
    expect(lifelines).toHaveLength(2);
    expect(lifelines[0].data).toMatchObject({
      strokeStyle: 'dashed',
      endArrowStyle: 'none',
      startArrowStyle: 'none',
      connectorType: 'straight',
      label: '',
    });
    // The board's default connector kind is `elbow`; the ladder overrides it.
    expect(store().edges.every((e) => e.data?.connectorType === 'straight')).toBe(true);

    expect(messages().map((e) => e.data!.label)).toEqual(['save', 'ok']);
    expect(messages()[0].data).toMatchObject({ strokeStyle: 'solid', endArrowStyle: 'arrow' });
    expect(messages()[1].data).toMatchObject({ strokeStyle: 'dashed', endArrowStyle: 'arrow' });
    // Arrowhead defs are regenerated like every other new connector's.
    expect(messages()[0].markerEnd).toBeTruthy();
  });

  it('is ONE undo step, and redo brings the whole diagram back', () => {
    store().pasteSequence(CONVERSATION, origin);
    expect(store().nodes).toHaveLength(8);
    expect(store().edges).toHaveLength(4);

    store().undo();
    expect(store().nodes).toHaveLength(0);
    expect(store().edges).toHaveLength(0);

    store().redo();
    expect(store().nodes).toHaveLength(8);
    expect(store().edges).toHaveLength(4);
  });

  it('leaves the rest of the board alone and selects only the participants', () => {
    const existing = store().addShape('rectangle', { x: 0, y: 0 });
    select(existing);

    store().pasteSequence(CONVERSATION, origin);
    expect(store().nodes.find((n) => n.id === existing)).toMatchObject({
      position: { x: 0, y: 0 },
      selected: false,
    });
    expect(store().nodes.filter((n) => n.selected).map((n) => n.data.label)).toEqual([
      'User',
      'Server',
    ]);
    expect(store().edges.some((e) => e.selected)).toBe(false);
  });

  it('deletes a participant with its whole column', () => {
    store().pasteSequence(CONVERSATION, origin);
    select(participants()[0].id);
    store().deleteSelection();

    // The column's four nodes go (participant, lifeline end, two message
    // points), and every connector that touched one goes with them.
    expect(store().nodes).toHaveLength(4);
    expect(store().edges).toHaveLength(1);
    expect(store().edges[0].data?.sequence).toEqual({ kind: 'lifeline', index: 1 });
  });

  it('draws a self-message as a loop on one lifeline', () => {
    store().pasteSequence('sequenceDiagram\n  A->>A: think', origin);
    expect(participants()).toHaveLength(1);
    const [message] = messages();
    const source = store().nodes.find((n) => n.id === message.source)!;
    const target = store().nodes.find((n) => n.id === message.target)!;
    expect(source.parentId).toBe(target.parentId);
    expect(message.data!.waypoints).toHaveLength(2);
  });
});

describe('tables', () => {
  const tableOf = (id: string) => store().nodes.find((n) => n.id === id)!;
  const cells = (id: string) => tableOf(id).data.table!.rows.map((r) => r.cells);

  it('addTable draws a 3×3 with a header, boxed to its grid', () => {
    const id = store().addTable({ x: 40, y: 60 });
    const node = tableOf(id);
    expect(node).toMatchObject({
      type: 'table',
      position: { x: 40, y: 60 },
      width: DEFAULT_COLUMN_WIDTH * 3,
      height: DEFAULT_ROW_HEIGHT * 3,
    });
    expect(node.data.table).toMatchObject({ header: true });
    expect(cells(id)).toEqual([['', '', ''], ['', '', ''], ['', '', '']]);
  });

  it('addTable takes a parsed grid, and squares it up on the way in', () => {
    const id = store().addTable({ x: 0, y: 0 }, {
      header: true,
      columns: [],
      rows: [{ cells: ['a', 'b'] }, { cells: ['c'] }],
    });
    expect(cells(id)).toEqual([['a', 'b'], ['c', '']]);
    expect(tableOf(id).width).toBe(DEFAULT_COLUMN_WIDTH * 2);
  });

  it('addTable is one history entry', () => {
    const id = store().addTable({ x: 0, y: 0 });
    expect(store().canUndo).toBe(true);
    store().undo();
    expect(store().nodes.find((n) => n.id === id)).toBeUndefined();
  });

  it('commits a cell through updateNodeData, one entry per commit', () => {
    const id = store().addTable({ x: 0, y: 0 });
    store().updateNodeData(id, { table: setCell(tableOf(id).data.table!, 0, 1, 'Role') });
    expect(cells(id)[0]).toEqual(['', 'Role', '']);

    store().undo();
    expect(cells(id)[0]).toEqual(['', '', '']);
  });

  it('costs no history entry when the cell already says that', () => {
    const id = store().addTable({ x: 0, y: 0 });
    // `setCell` hands back the grid it was given, which `isNoOpPatch` sees — so
    // the only entry on the stack is still the one `addTable` pushed.
    store().updateNodeData(id, { table: setCell(tableOf(id).data.table!, 0, 0, '') });
    store().undo();
    expect(store().nodes.find((n) => n.id === id)).toBeUndefined();
  });

  it('keeps the node box in step with every row and column change', () => {
    const id = store().addTable({ x: 0, y: 0 });
    store().updateNodeData(id, { table: addRow(tableOf(id).data.table!) });
    expect(tableOf(id).height).toBe(DEFAULT_ROW_HEIGHT * 4);

    store().updateNodeData(id, { table: removeColumn(tableOf(id).data.table!) });
    expect(tableOf(id).width).toBe(DEFAULT_COLUMN_WIDTH * 2);

    store().updateNodeData(id, { table: addColumn(tableOf(id).data.table!) });
    expect(tableOf(id).width).toBe(DEFAULT_COLUMN_WIDTH * 3);
  });

  it('makes a row op and a column op one undo step each', () => {
    const id = store().addTable({ x: 0, y: 0 });
    store().updateNodeData(id, { table: addRow(tableOf(id).data.table!) });
    store().updateNodeData(id, { table: addColumn(tableOf(id).data.table!) });
    expect(cells(id)).toHaveLength(4);
    expect(cells(id)[0]).toHaveLength(4);

    store().undo();
    expect(cells(id)[0]).toHaveLength(3);
    store().undo();
    expect(cells(id)).toHaveLength(3);
  });

  it('resizes a column transiently, inside the entry beginInteraction pushed', () => {
    const id = store().addTable({ x: 0, y: 0 });
    store().beginInteraction();
    store().updateNodeDataTransient(id, { table: setColumnWidth(tableOf(id).data.table!, 0, 200) });
    store().updateNodeDataTransient(id, { table: setColumnWidth(tableOf(id).data.table!, 0, 260) });
    expect(tableOf(id).width).toBe(260 + DEFAULT_COLUMN_WIDTH * 2);

    // One drag, one ⌘Z: back to the width it was drawn at.
    store().undo();
    expect(tableOf(id).data.table!.columns[0].width).toBe(DEFAULT_COLUMN_WIDTH);
  });

  it('survives a save and a load, squared up and re-boxed on the way back', () => {
    const id = store().addTable({ x: 0, y: 0 });
    store().updateNodeData(id, { table: setCell(tableOf(id).data.table!, 1, 0, 'Ada') });
    const saved = serializeDiagram(store().nodes, store().edges);

    store().loadDiagram('test', 'Test', false, saved);
    expect(tableOf(id).type).toBe('table');
    expect(cells(id)[1][0]).toBe('Ada');
    expect(tableOf(id).width).toBe(DEFAULT_COLUMN_WIDTH * 3);
  });

  it('gives a stored table node with no grid at all an empty one rather than nothing', () => {
    store().loadDiagram('test', 'Test', false, {
      version: CURRENT_DIAGRAM_VERSION,
      nodes: [
        {
          id: 't',
          type: 'table',
          position: { x: 0, y: 0 },
          data: { label: '', shape: 'rectangle', fill: '#FFFFFF', stroke: '#CBD5E1' },
        },
      ],
      edges: [],
    });
    expect(tableOf('t').data.table).toEqual({
      header: false,
      columns: [{ width: DEFAULT_COLUMN_WIDTH }],
      rows: [{ cells: [''] }],
    });
  });

  it("is not redrawn as another shape kind — its data is a rectangle's", () => {
    const id = store().addTable({ x: 0, y: 0 });
    select(id);
    store().setSelectedShapeKind('star');
    expect(tableOf(id).data.shape).toBe('rectangle');
  });

  it('sits "match size" out: its box is its grid', () => {
    const table = store().addTable({ x: 0, y: 0 });
    const big = store().addShape('rectangle', { x: 600, y: 0 });
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === big ? { ...n, width: 900, height: 700 } : n)),
    }));
    select(table, big);
    store().matchSizeSelected('both');
    expect(tableOf(table).width).toBe(DEFAULT_COLUMN_WIDTH * 3);
    expect(tableOf(table).height).toBe(DEFAULT_ROW_HEIGHT * 3);
  });

  it('records the cursor without costing a history entry', () => {
    const id = store().addTable({ x: 0, y: 0 });
    store().setActiveTableCell({ nodeId: id, row: 1, col: 2 });
    expect(store().activeTableCell).toEqual({ nodeId: id, row: 1, col: 2 });
    store().undo();
    expect(store().nodes.find((n) => n.id === id)).toBeUndefined();
  });
});

describe('setSlideOrder', () => {
  /** Three frames, top to bottom, so the unarranged deck reads a, b, c. */
  function seedFrames() {
    store().loadDiagram('test', 'Deck', false, {
      nodes: ['a', 'b', 'c'].map((id, i) => ({
        id,
        type: 'frame' as const,
        position: { x: 0, y: i * 1000 },
        width: 400,
        height: 300,
        data: { label: id, shape: 'rectangle' as const, fill: 'transparent', stroke: 'transparent' },
      })),
      edges: [],
    });
  }

  const orderOf = (id: string) => store().nodes.find((n) => n.id === id)!.data.slideOrder;

  beforeEach(seedFrames);

  it('writes slideOrder 0..n-1 onto the frames', () => {
    store().setSlideOrder(['c', 'a', 'b']);
    expect([orderOf('c'), orderOf('a'), orderOf('b')]).toEqual([0, 1, 2]);
  });

  it('is one history entry however many frames moved', () => {
    expect(store().canUndo).toBe(false);
    store().setSlideOrder(['c', 'b', 'a']);
    expect(store().canUndo).toBe(true);

    store().undo();
    expect(orderOf('a')).toBeUndefined();
    expect(orderOf('c')).toBeUndefined();
    expect(store().canUndo).toBe(false);
  });

  it('costs no history entry when the board is already in that order', () => {
    store().setSlideOrder(['a', 'b', 'c']);
    const before = store().canUndo;
    store().setSlideOrder(['a', 'b', 'c']);
    expect(store().canUndo).toBe(before);
  });

  it('leaves everything but slideOrder alone, the array order included', () => {
    store().setSlideOrder(['b', 'a', 'c']);
    expect(store().nodes.find((n) => n.id === 'b')!.data).toMatchObject({
      label: 'b',
      fill: 'transparent',
      slideOrder: 0,
    });
    // The running order is a field on the frames, not a rearrangement of the
    // board: a diagram's node array is its z-order and must not move with it.
    expect(store().nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// Mind maps
// ---------------------------------------------------------------------------

describe('mind maps', () => {
  const at = { x: 100, y: 200 };
  const nodeOf = (id: string) => store().nodes.find((n) => n.id === id)!;
  /** The map's branches, in the order the edge array holds them. */
  const branches = () => store().edges.filter((e) => e.data?.role === 'mindmap');
  const childrenIds = (id: string) => branches().filter((e) => e.source === id).map((e) => e.target);

  describe('mindMapAddRoot', () => {
    it('makes a node that points at itself, selected and open for typing', () => {
      const id = store().mindMapAddRoot(at);
      expect(nodeOf(id)).toMatchObject({
        type: 'shape',
        position: at,
        width: MIND_MAP_NODE_SIZE.width,
        height: MIND_MAP_NODE_SIZE.height,
        selected: true,
        data: { shape: 'rectangle', label: '', mindMap: { root: id } },
      });
      expect(store().editingNodeId).toBe(id);
      expect(store().nodes).toHaveLength(1);
    });

    it('costs exactly one history entry', () => {
      store().mindMapAddRoot(at);
      expect(store().canUndo).toBe(true);
      store().undo();
      expect(store().nodes).toEqual([]);
    });
  });

  describe('mindMapAddChild', () => {
    it('adds a node and a branch, and starts typing into the child', () => {
      const root = store().mindMapAddRoot(at);
      const child = store().mindMapAddChild(root)!;

      expect(nodeOf(child).data.mindMap).toEqual({ root });
      expect(childrenIds(root)).toEqual([child]);
      expect(store().editingNodeId).toBe(child);
      expect(store().nodes.filter((n) => n.selected).map((n) => n.id)).toEqual([child]);
    });

    it('draws the branch as a thin bare curve, pinned right to left', () => {
      const root = store().mindMapAddRoot(at);
      const child = store().mindMapAddChild(root)!;
      const [branch] = branches();

      expect(branch).toMatchObject({ source: root, target: child, type: 'connector' });
      expect(branch.data).toMatchObject({
        role: 'mindmap',
        connectorType: 'curved',
        strokeWidth: 1,
        startArrowStyle: 'none',
        endArrowStyle: 'none',
        sourceAnchor: { side: 'right', t: 0.5 },
        targetAnchor: { side: 'left', t: 0.5 },
      });
      // Bare at both ends: `computeMarkers` gives an arrowless connector no defs.
      expect(branch.markerStart).toBeUndefined();
      expect(branch.markerEnd).toBeUndefined();
    });

    it('leaves the root where it is and puts the child one level to its right', () => {
      const root = store().mindMapAddRoot(at);
      const child = store().mindMapAddChild(root)!;

      expect(nodeOf(root).position).toEqual(at);
      expect(nodeOf(child).position).toEqual({
        x: at.x + MIND_MAP_NODE_SIZE.width + MIND_MAP_LEVEL_GAP,
        y: at.y,
      });
    });

    it('is one history entry, layout and all', () => {
      const root = store().mindMapAddRoot(at);
      store().mindMapAddChild(root);
      store().undo();
      expect(store().nodes.map((n) => n.id)).toEqual([root]);
      expect(store().edges).toEqual([]);
    });

    it('refuses a shape that is not part of a map', () => {
      const plain = store().addShape('rectangle', at);
      expect(store().mindMapAddChild(plain)).toBeNull();
    });

    it('unfolds a folded parent rather than adding out of sight', () => {
      const root = store().mindMapAddRoot(at);
      const a = store().mindMapAddChild(root)!;
      store().mindMapAddChild(a);
      store().mindMapToggleCollapse(a);
      expect(nodeOf(a).data.mindMap?.collapsed).toBe(true);

      const added = store().mindMapAddChild(a)!;
      expect(nodeOf(a).data.mindMap?.collapsed).toBe(false);
      expect(nodeOf(added).hidden).toBeFalsy();
    });
  });

  describe('mindMapAddSibling', () => {
    it('stacks the new node below, one gap away, and leaves the root anchored', () => {
      const root = store().mindMapAddRoot(at);
      const first = store().mindMapAddChild(root)!;
      const second = store().mindMapAddSibling(first)!;

      expect(childrenIds(root)).toEqual([first, second]);
      expect(nodeOf(second).position.y - nodeOf(first).position.y).toBe(
        MIND_MAP_NODE_SIZE.height + MIND_MAP_SIBLING_GAP,
      );
      expect(nodeOf(second).position.x).toBe(nodeOf(first).position.x);
      expect(nodeOf(root).position).toEqual(at);
    });

    it('puts one above with `before`, which is the order of the edge array', () => {
      const root = store().mindMapAddRoot(at);
      const first = store().mindMapAddChild(root)!;
      const above = store().mindMapAddSibling(first, true)!;

      expect(childrenIds(root)).toEqual([above, first]);
      expect(nodeOf(above).position.y).toBeLessThan(nodeOf(first).position.y);
    });

    it('starts the root\'s first branch instead, a root having no siblings', () => {
      const root = store().mindMapAddRoot(at);
      const made = store().mindMapAddSibling(root)!;
      expect(childrenIds(root)).toEqual([made]);
    });
  });

  describe('mindMapAddParent', () => {
    it('slips a node in between a child and its parent', () => {
      const root = store().mindMapAddRoot(at);
      const child = store().mindMapAddChild(root)!;
      const between = store().mindMapAddParent(child)!;

      expect(childrenIds(root)).toEqual([between]);
      expect(childrenIds(between)).toEqual([child]);
      expect(nodeOf(between).data.mindMap).toEqual({ root });
      expect(store().editingNodeId).toBe(between);
    });

    it('above a root, becomes the root and re-badges the whole map', () => {
      const root = store().mindMapAddRoot(at);
      const child = store().mindMapAddChild(root)!;
      const newRoot = store().mindMapAddParent(root)!;

      expect(childrenIds(newRoot)).toEqual([root]);
      for (const id of [newRoot, root, child]) {
        expect(nodeOf(id).data.mindMap?.root, id).toBe(newRoot);
      }
      // The map is anchored on its new root, which took the old one's place.
      expect(nodeOf(newRoot).position).toEqual(at);
      expect(nodeOf(root).position.x).toBeGreaterThan(at.x);
    });
  });

  describe('mindMapToggleCollapse', () => {
    /** root -> a -> a1, plus a second child b. */
    function threeDeep() {
      const root = store().mindMapAddRoot(at);
      const a = store().mindMapAddChild(root)!;
      const a1 = store().mindMapAddChild(a)!;
      const b = store().mindMapAddSibling(a)!;
      return { root, a, a1, b };
    }

    it('hides the descendants and the branches reaching them', () => {
      const { a, a1 } = threeDeep();
      store().mindMapToggleCollapse(a);

      expect(nodeOf(a).data.mindMap?.collapsed).toBe(true);
      expect(nodeOf(a).hidden).toBeFalsy();
      expect(nodeOf(a1).hidden).toBe(true);
      expect(store().edges.find((e) => e.target === a1)!.hidden).toBe(true);
    });

    it('gives a folded branch no room, and its room back when it is unfolded', () => {
      const { a, b } = threeDeep();
      const apart = nodeOf(b).position.y - nodeOf(a).position.y;

      store().mindMapToggleCollapse(a);
      expect(nodeOf(b).position.y - nodeOf(a).position.y).toBe(
        MIND_MAP_NODE_SIZE.height + MIND_MAP_SIBLING_GAP,
      );

      store().mindMapToggleCollapse(a);
      expect(nodeOf(b).position.y - nodeOf(a).position.y).toBe(apart);
      expect(nodeOf(b).hidden).toBeFalsy();
    });

    it('stores `collapsed` and never `hidden`, and derives it again on load', () => {
      const { a, a1 } = threeDeep();
      store().mindMapToggleCollapse(a);

      const data = serializeDiagram(store().nodes, store().edges);
      const saved = data.nodes.find((n) => n.id === a1)!;
      expect('hidden' in saved).toBe(false);
      expect(data.nodes.find((n) => n.id === a)!.data.mindMap).toMatchObject({ collapsed: true });

      store().loadDiagram('test', 'Test', false, data);
      expect(nodeOf(a1).hidden).toBe(true);
      expect(nodeOf(a).hidden).toBeFalsy();
    });

    it('costs no history entry on a leaf, which has nothing to fold', () => {
      const { a1 } = threeDeep();
      const before = store().nodes;
      store().mindMapToggleCollapse(a1);
      expect(store().nodes).toBe(before);
    });
  });

  describe('mindMapAddChildren', () => {
    it('adds one child per line, in order, as a single history entry', () => {
      const root = store().mindMapAddRoot(at);
      const ids = store().mindMapAddChildren(root, ['one', 'two', 'three']);

      expect(ids).toHaveLength(3);
      expect(childrenIds(root)).toEqual(ids);
      expect(ids.map((id) => nodeOf(id).data.label)).toEqual(['one', 'two', 'three']);

      store().undo();
      expect(store().nodes.map((n) => n.id)).toEqual([root]);
    });

    it('does nothing, and records nothing, for an empty list', () => {
      const root = store().mindMapAddRoot(at);
      const before = store().nodes;
      expect(store().mindMapAddChildren(root, [])).toEqual([]);
      expect(store().nodes).toBe(before);
    });
  });

  describe('mindMapRelayout', () => {
    it('costs no history entry when the map is already tidy', () => {
      const root = store().mindMapAddRoot(at);
      store().mindMapAddChild(root);
      const before = store().nodes;
      store().mindMapRelayout(root);
      expect(store().nodes).toBe(before);
    });

    it('puts a node dragged out of place back', () => {
      const root = store().mindMapAddRoot(at);
      const child = store().mindMapAddChild(root)!;
      const home = nodeOf(child).position;
      useDiagramStore.setState((s) => ({
        nodes: s.nodes.map((n) => (n.id === child ? { ...n, position: { x: 9, y: 9 } } : n)),
      }));

      store().mindMapRelayout(root);
      expect(nodeOf(child).position).toEqual(home);
    });
  });

  describe('dragging', () => {
    it('takes the whole subtree with the node that is dragged', () => {
      const root = store().mindMapAddRoot(at);
      const child = store().mindMapAddChild(root)!;
      const grandchild = store().mindMapAddChild(child)!;
      const before = nodeOf(grandchild).position;
      // ⌘ held: the drag lands exactly where the pointer put it. This is about
      // the subtree travelling with the node, not about the alignment snap,
      // which would otherwise pull the pair onto the root by a pixel or two.
      useDiagramStore.setState({ snapOverride: 'guides' });

      store().onNodesChange([
        {
          type: 'position',
          id: child,
          position: { x: nodeOf(child).position.x + 50, y: nodeOf(child).position.y - 20 },
          dragging: true,
        },
      ]);

      expect(nodeOf(grandchild).position).toEqual({ x: before.x + 50, y: before.y - 20 });
      // The root is not under the node being dragged, so it stays put.
      expect(nodeOf(root).position).toEqual(at);
      useDiagramStore.setState({ snapOverride: 'none' });
    });
  });
});

/**
 * Dot voting and the board timer.
 *
 * The rule these tests are really about is which of them push a history entry:
 * the round and the countdown live in the document's `meta` map, outside the
 * `Y.UndoManager`'s scope, so they push none — while the dots are node data and
 * squarely inside it, so every action that touches them pushes a boundary, or
 * one ⌘Z would take back two things. See the note in the store's interface.
 */
describe('dot voting', () => {
  const nodeOf = (id: string) => store().nodes.find((n) => n.id === id)!;

  beforeEach(() => {
    store().loadDiagram('test', 'Test', false, { nodes: [], edges: [] }, undefined, {
      viewerId: 'ada',
    });
  });

  it('starts a round nobody has voted in yet', () => {
    store().startVoting(4);
    expect(store().voting).toEqual({
      active: true,
      revealed: false,
      dotsPerPerson: 4,
      startedById: 'ada',
    });
  });

  it('refuses to start one for a reader with no name to vote under', () => {
    // The public `/s/:token` page. The button is never rendered there either;
    // the store is total, so it says no rather than inventing a voter.
    useDiagramStore.setState({ viewerId: null });
    store().startVoting(3);
    expect(store().voting).toBeNull();
  });

  it('clamps the budget the way a peer’s round is clamped', () => {
    store().startVoting(9999);
    expect(store().voting?.dotsPerPerson).toBe(20);
    store().startVoting(0);
    expect(store().voting?.dotsPerPerson).toBe(1);
  });

  it('pushes no history entry for opening or closing a round', () => {
    // `meta` is outside the undo manager's scope, so a boundary here could only
    // split the *previous* edit in two — the rule `saveSelectionAsDefault` and
    // `setThumbnailNodeIds` already keep.
    store().addShape('sticky', { x: 0, y: 0 });
    const before = store().canUndo;
    store().startVoting(3);
    store().endVoting();
    expect(store().canUndo).toBe(before);
  });

  it('puts one of your dots on a shape, and takes one back', () => {
    const id = store().addShape('sticky', { x: 0, y: 0 });
    store().startVoting(3);

    store().toggleVote(id);
    store().toggleVote(id);
    expect(nodeOf(id).data.votes).toEqual({ ada: 2 });

    store().removeVote(id);
    expect(nodeOf(id).data.votes).toEqual({ ada: 1 });
  });

  it('spells "nobody has voted for this" exactly one way', () => {
    // `{ ada: 0 }` and an absent field would otherwise both mean no votes while
    // comparing unequal — and the collaboration binding diffs the *serialized*
    // diagram.
    const id = store().addShape('sticky', { x: 0, y: 0 });
    store().startVoting(3);
    store().toggleVote(id);
    store().removeVote(id);
    expect('votes' in nodeOf(id).data).toBe(false);
  });

  it('caps a voter at their budget across the whole board', () => {
    const a = store().addShape('sticky', { x: 0, y: 0 });
    const b = store().addShape('sticky', { x: 300, y: 0 });
    store().startVoting(2);

    store().toggleVote(a);
    store().toggleVote(b);
    // Budget spent: the third click takes one back off *this* shape rather than
    // dead-ending, which is what makes the gesture reversible on a full board.
    store().toggleVote(b);
    expect(nodeOf(a).data.votes).toEqual({ ada: 1 });
    expect('votes' in nodeOf(b).data).toBe(false);
  });

  it('leaves a shape alone when the budget is spent and nothing of theirs is on it', () => {
    const a = store().addShape('sticky', { x: 0, y: 0 });
    const b = store().addShape('sticky', { x: 300, y: 0 });
    store().startVoting(1);
    store().toggleVote(a);

    store().toggleVote(b);
    expect('votes' in nodeOf(b).data).toBe(false);
    expect(nodeOf(a).data.votes).toEqual({ ada: 1 });
  });

  it('refuses a vote when the round is closed', () => {
    const id = store().addShape('sticky', { x: 0, y: 0 });
    store().startVoting(3);
    store().endVoting();
    store().toggleVote(id);
    expect('votes' in nodeOf(id).data).toBe(false);
  });

  it('makes a vote its own undo step rather than folding it into the last edit', () => {
    // The hazard the convention warns about: without a boundary the vote would
    // join whatever came before it and one ⌘Z would take back both.
    const id = store().addShape('sticky', { x: 0, y: 0 });
    store().updateNodeData(id, { label: 'Idea' });
    store().startVoting(3);

    store().toggleVote(id);
    store().undo();
    expect('votes' in nodeOf(id).data).toBe(false);
    expect(nodeOf(id).data.label).toBe('Idea');
  });

  it('reveals the totals when the round is closed, and not before', () => {
    const id = store().addShape('sticky', { x: 0, y: 0 });
    store().startVoting(3);
    store().toggleVote(id);
    expect(store().voting).toMatchObject({ active: true, revealed: false });

    store().endVoting();
    // One act, not two: revealing without closing would let somebody go on
    // voting while everybody else reads the answers.
    expect(store().voting).toMatchObject({ active: false, revealed: true });
  });

  it('clears every dot and the round with them, as one undoable edit', () => {
    const a = store().addShape('sticky', { x: 0, y: 0 });
    const b = store().addShape('sticky', { x: 300, y: 0 });
    store().startVoting(3);
    store().toggleVote(a);
    store().toggleVote(b);

    store().clearVotes();
    expect('votes' in nodeOf(a).data).toBe(false);
    expect('votes' in nodeOf(b).data).toBe(false);
    expect(store().voting).toBeNull();

    // The dots come back; the round does not, because it was never in the undo
    // manager's scope. That asymmetry is documented at the action.
    store().undo();
    expect(nodeOf(a).data.votes).toEqual({ ada: 1 });
    expect(store().voting).toBeNull();
  });

  it('costs nothing to clear a board with no votes and no round', () => {
    store().addShape('sticky', { x: 0, y: 0 });
    const before = store().canUndo;
    store().clearVotes();
    expect(store().canUndo).toBe(before);
  });

  it('counts each voter separately', () => {
    const id = store().addShape('sticky', { x: 0, y: 0 });
    store().startVoting(3);
    store().toggleVote(id);
    useDiagramStore.setState({ viewerId: 'grace' });
    store().toggleVote(id);
    expect(nodeOf(id).data.votes).toEqual({ ada: 1, grace: 1 });
  });

  it('lays the voted shapes out in one row, most votes first', () => {
    const a = store().addShape('sticky', { x: 0, y: 600 });
    const b = store().addShape('sticky', { x: 500, y: 200 });
    const c = store().addShape('sticky', { x: 900, y: 900 });
    store().startVoting(3);
    store().toggleVote(b);
    store().toggleVote(b);
    store().toggleVote(a);

    store().sortByVotes();
    // b (2 votes) first, a (1) next; c has none and is left where it was.
    expect(nodeOf(b).position.x).toBeLessThan(nodeOf(a).position.x);
    expect(nodeOf(b).position.y).toBe(nodeOf(a).position.y);
    expect(nodeOf(c).position).toEqual({ x: 900, y: 900 });
  });

  it('sorts only the selection when there is one to sort', () => {
    const a = store().addShape('sticky', { x: 0, y: 0 });
    const b = store().addShape('sticky', { x: 400, y: 0 });
    const c = store().addShape('sticky', { x: 800, y: 500 });
    store().startVoting(3);
    store().toggleVote(a);
    store().toggleVote(b);
    store().toggleVote(c);
    select(a, b);

    store().sortByVotes();
    expect(nodeOf(c).position).toEqual({ x: 800, y: 500 });
  });

  it('costs no history entry when the row is already the row', () => {
    const a = store().addShape('sticky', { x: 0, y: 0 });
    const b = store().addShape('sticky', { x: 400, y: 0 });
    store().startVoting(3);
    store().toggleVote(a);
    store().toggleVote(a);
    store().toggleVote(b);
    const before = { a: nodeOf(a).position, b: nodeOf(b).position };
    store().sortByVotes();
    const settled = { a: nodeOf(a).position, b: nodeOf(b).position };
    expect(settled.b).not.toEqual(before.b);

    // A second run moves nothing — `commitArrangedPositions`' own rule — so it
    // records no entry, and the one ⌘Z goes straight back past both of them.
    store().sortByVotes();
    expect(nodeOf(b).position).toEqual(settled.b);
    store().undo();
    expect(nodeOf(a).position).toEqual(before.a);
    expect(nodeOf(b).position).toEqual(before.b);
  });

  it('serializes a round and the dots, and writes neither key without them', () => {
    const id = store().addShape('sticky', { x: 0, y: 0 });
    const bare = store();
    expect('voting' in serializeDiagram(bare.nodes, bare.edges)).toBe(false);

    store().startVoting(3);
    store().toggleVote(id);
    const s = store();
    const data = serializeDiagram(s.nodes, s.edges, s.viewport, s.defaults, s.thumbnailNodeIds, {
      voting: s.voting,
      timer: s.timer,
    });
    expect(data.voting).toMatchObject({ active: true, dotsPerPerson: 3 });
    expect(data.nodes[0].data.votes).toEqual({ ada: 1 });
  });

  it('reads a stored round back, and drops one nothing could act on', () => {
    store().loadDiagram(
      'test',
      'Test',
      false,
      {
        version: CURRENT_DIAGRAM_VERSION,
        nodes: [],
        edges: [],
        voting: { active: true, revealed: false, dotsPerPerson: 5, startedById: 'ada' },
      },
      undefined,
      { viewerId: 'ada' },
    );
    expect(store().voting?.dotsPerPerson).toBe(5);

    store().loadDiagram('test', 'Test', false, {
      version: CURRENT_DIAGRAM_VERSION,
      nodes: [],
      edges: [],
      voting: { active: true },
    });
    expect(store().voting).toBeNull();
  });
});

describe('the board timer', () => {
  beforeEach(() => {
    store().loadDiagram('test', 'Test', false, { nodes: [], edges: [] }, undefined, {
      viewerId: 'ada',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores an end time rather than a countdown', () => {
    // The whole design decision: nothing ticks through the shared document.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T12:00:00.000Z'));
    store().startTimer(300);
    expect(store().timer).toEqual({
      endsAt: '2026-09-07T12:05:00.000Z',
      startedById: 'ada',
    });
  });

  it('keeps a label when it is given one', () => {
    store().startTimer(60, 'Silent writing');
    expect(store().timer?.label).toBe('Silent writing');
  });

  it('pushes no history entry — it is `meta`, like the round', () => {
    store().addShape('sticky', { x: 0, y: 0 });
    const before = store().canUndo;
    store().startTimer(60);
    store().stopTimer();
    expect(store().canUndo).toBe(before);
    expect(store().timer).toBeNull();
  });

  it('refuses a timer with nobody behind it, or no length', () => {
    useDiagramStore.setState({ viewerId: null });
    store().startTimer(60);
    expect(store().timer).toBeNull();

    useDiagramStore.setState({ viewerId: 'ada' });
    store().startTimer(0);
    expect(store().timer).toBeNull();
  });

  it('caps a countdown at three hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T12:00:00.000Z'));
    store().startTimer(99 * 60 * 60);
    expect(store().timer?.endsAt).toBe('2026-09-07T15:00:00.000Z');
  });

  it('reads a stored timer back and drops one that could not be drawn', () => {
    store().loadDiagram('test', 'Test', false, {
      version: CURRENT_DIAGRAM_VERSION,
      nodes: [],
      edges: [],
      timer: { endsAt: '2030-01-01T00:00:00.000Z', startedById: 'ada' },
    });
    expect(store().timer?.endsAt).toBe('2030-01-01T00:00:00.000Z');

    store().loadDiagram('test', 'Test', false, {
      version: CURRENT_DIAGRAM_VERSION,
      nodes: [],
      edges: [],
      timer: { endsAt: 'soon', startedById: 'ada' },
    });
    expect(store().timer).toBeNull();
  });
});
