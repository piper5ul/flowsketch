import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge as rfAddEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react';
import { nanoid } from 'nanoid';
import type { DiagramData, DiagramViewport } from '../../shared/types';
import type { ConnectorData, ConnectorKind, Direction, EdgeAnchor, ShapeData, ShapeKind, Tool } from '../types';
import { DEFAULT_SWATCH } from '../lib/palette';
import { makeEdgeData } from '../lib/defaults';
import { computeMarkers } from '../lib/edgeMarkers';
import { canSwapShapeKind } from '../lib/nodeKinds';
import { CURRENT_DIAGRAM_VERSION, migrateDiagramData } from '../lib/diagramMigrations';
import {
  alignNodes,
  distributeNodes,
  matchSize,
  type AlignMode,
  type ArrangePosition,
  type ArrangeRect,
  type ArrangeSize,
  type DistributeAxis,
  type MatchDimension,
} from '../lib/arrange';
import { api } from '../lib/api';
import { toastError } from './useToastStore';

// Re-exported here because this is where the rest of the app reaches for it.
export { computeMarkers };

// ---------------------------------------------------------------------------
// Smart alignment guides — snap dragged nodes to other nodes' edges/centers
// ---------------------------------------------------------------------------

export interface GuideLine {
  axis: 'x' | 'y';
  pos: number;
  from: number;
  to: number;
}

const SNAP_THRESHOLD = 5;

function computeAlignmentSnap(
  dragged: { x: number; y: number; w: number; h: number },
  others: { x: number; y: number; w: number; h: number }[],
): { dx: number; dy: number; guides: GuideLine[] } {
  const guides: GuideLine[] = [];
  let dx = 0, dy = 0;
  let bestDistX = SNAP_THRESHOLD + 1;
  let bestDistY = SNAP_THRESHOLD + 1;

  const dCx = dragged.x + dragged.w / 2;
  const dCy = dragged.y + dragged.h / 2;
  const dRight = dragged.x + dragged.w;
  const dBottom = dragged.y + dragged.h;

  for (const o of others) {
    const oCx = o.x + o.w / 2;
    const oCy = o.y + o.h / 2;
    const oRight = o.x + o.w;
    const oBottom = o.y + o.h;

    const xAlignments = [
      { dVal: dragged.x, oVal: o.x },
      { dVal: dragged.x, oVal: oCx },
      { dVal: dragged.x, oVal: oRight },
      { dVal: dCx, oVal: o.x },
      { dVal: dCx, oVal: oCx },
      { dVal: dCx, oVal: oRight },
      { dVal: dRight, oVal: o.x },
      { dVal: dRight, oVal: oCx },
      { dVal: dRight, oVal: oRight },
    ];
    for (const { dVal, oVal } of xAlignments) {
      const dist = Math.abs(dVal - oVal);
      if (dist < bestDistX) {
        bestDistX = dist;
        dx = oVal - dVal;
      }
    }

    const yAlignments = [
      { dVal: dragged.y, oVal: o.y },
      { dVal: dragged.y, oVal: oCy },
      { dVal: dragged.y, oVal: oBottom },
      { dVal: dCy, oVal: o.y },
      { dVal: dCy, oVal: oCy },
      { dVal: dCy, oVal: oBottom },
      { dVal: dBottom, oVal: o.y },
      { dVal: dBottom, oVal: oCy },
      { dVal: dBottom, oVal: oBottom },
    ];
    for (const { dVal, oVal } of yAlignments) {
      const dist = Math.abs(dVal - oVal);
      if (dist < bestDistY) {
        bestDistY = dist;
        dy = oVal - dVal;
      }
    }
  }

  if (bestDistX > SNAP_THRESHOLD) dx = 0;
  if (bestDistY > SNAP_THRESHOLD) dy = 0;

  const snappedX = dragged.x + dx;
  const snappedCx = snappedX + dragged.w / 2;
  const snappedRight = snappedX + dragged.w;
  const snappedY = dragged.y + dy;
  const snappedCy = snappedY + dragged.h / 2;
  const snappedBottom = snappedY + dragged.h;

  for (const o of others) {
    const oCx = o.x + o.w / 2;
    const oCy = o.y + o.h / 2;
    const oRight = o.x + o.w;
    const oBottom = o.y + o.h;

    if (dx !== 0 || bestDistX <= SNAP_THRESHOLD) {
      for (const xVal of [snappedX, snappedCx, snappedRight]) {
        for (const oVal of [o.x, oCx, oRight]) {
          if (Math.abs(xVal - oVal) < 0.5) {
            const minY = Math.min(snappedY, o.y);
            const maxY = Math.max(snappedBottom, oBottom);
            guides.push({ axis: 'x', pos: oVal, from: minY, to: maxY });
          }
        }
      }
    }
    if (dy !== 0 || bestDistY <= SNAP_THRESHOLD) {
      for (const yVal of [snappedY, snappedCy, snappedBottom]) {
        for (const oVal of [o.y, oCy, oBottom]) {
          if (Math.abs(yVal - oVal) < 0.5) {
            const minX = Math.min(snappedX, o.x);
            const maxX = Math.max(snappedRight, oRight);
            guides.push({ axis: 'y', pos: oVal, from: minX, to: maxX });
          }
        }
      }
    }
  }

  return { dx, dy, guides };
}

export type ShapeNode = Node<ShapeData, 'shape'>;
export type ConnectorEdge = Edge<ConnectorData, 'connector'>;

/**
 * A node's box. `width`/`height` are what the store sets; `measured` is what
 * React Flow observed for a node whose size follows its content.
 */
function nodeWidth(node: ShapeNode): number {
  return node.width ?? node.measured?.width ?? 0;
}

function nodeHeight(node: ShapeNode): number {
  return node.height ?? node.measured?.height ?? 0;
}

/** The selection as plain rects, in node order, for the `arrange` helpers. */
function selectedRects(nodes: ShapeNode[]): ArrangeRect[] {
  return nodes
    .filter((n) => n.selected)
    .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: nodeWidth(n), h: nodeHeight(n) }));
}

/**
 * `retrying` is owned by the autosaver, not by `saveDiagram`: it is set once
 * the autosaver has scheduled another attempt after a failure (see
 * `src/lib/autosave.ts`), and it survives the failures that follow.
 */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'retrying';

// Toolbar interaction flag — prevents contentEditable blur from
// clearing editing state when the user clicks a formatting button.
let _suppressBlurCommit = false;
export function suppressNextBlurCommit() { _suppressBlurCommit = true; }
export function consumeSuppressBlur(): boolean {
  if (_suppressBlurCommit) { _suppressBlurCommit = false; return true; }
  return false;
}

/** A clipboard payload — what ⌘C captured, and what `pasteClipboard` returns. */
export interface ClipboardPayload {
  nodes: ShapeNode[];
  edges: ConnectorEdge[];
}

interface DiagramState {
  diagramId: string | null;
  title: string;
  starred: boolean;
  saveStatus: SaveStatus;
  editingNodeId: string | null;
  editingEdgeId: string | null;
  nodes: ShapeNode[];
  edges: ConnectorEdge[];
  guides: GuideLine[];
  /** Where the canvas was left, restored on the next open. `null` until it is reported. */
  viewport: DiagramViewport | null;
  tool: Tool;
  defaultFill: string;
  defaultStroke: string;
  defaultConnector: ConnectorKind;
  /** Mirrors the (non-serialized) undo/redo stacks so the UI can disable its buttons. */
  canUndo: boolean;
  canRedo: boolean;

  /** @throws when `data` was written by a newer version — see `migrateDiagramData`. */
  loadDiagram: (id: string, title: string, starred: boolean, data: unknown) => void;
  saveDiagram: (options?: { keepalive?: boolean }) => Promise<void>;
  setTitle: (title: string) => void;
  setStarred: (starred: boolean) => void;
  setEditingNodeId: (id: string | null) => void;
  setEditingEdgeId: (id: string | null) => void;

  setTool: (tool: Tool) => void;
  /** Records a pan or zoom. Transient by design: moving the camera is not an edit. */
  setViewport: (viewport: DiagramViewport) => void;
  onNodesChange: (changes: NodeChange<ShapeNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<ConnectorEdge>[]) => void;
  onConnect: (connection: Connection) => void;

  addShape: (shape: ShapeKind, position: { x: number; y: number }) => string;
  addImageNode: (image: { src: string; width: number; height: number; position: { x: number; y: number } }) => string;

  // An insert whose upload is still in flight. The placeholder itself is not
  // an edit — history is recorded when (and only when) the upload lands.
  addImagePlaceholder: (box: { width: number; height: number; position: { x: number; y: number } }) => string;
  resolveImagePlaceholder: (
    id: string,
    image: { src: string; width: number; height: number; position: { x: number; y: number } },
  ) => void;
  removeImagePlaceholder: (id: string) => void;
  addConnectedShape: (sourceId: string, direction: Direction) => string | null;
  updateNodeData: (id: string, data: Partial<ShapeData>) => void;
  updateSelectedNodesStyle: (patch: Partial<Pick<ShapeData, 'fill' | 'stroke'>>) => void;

  updateEdgeData: (id: string, data: Partial<ConnectorData>) => void;
  updateSelectedEdgesStyle: (patch: Partial<ConnectorData>) => void;
  reconnectEdgeEndpoint: (edgeId: string, end: 'source' | 'target', nodeId: string, anchor: EdgeAnchor) => void;

  // Continuous interactions: `beginInteraction` records the one entry, the
  // transient updaters then run per pointermove without touching history.
  beginInteraction: () => void;
  updateEdgeDataTransient: (id: string, data: Partial<ConnectorData>) => void;
  moveNodesTransient: (positions: Record<string, { x: number; y: number }>) => void;
  /** Resizes a node without history — for sizes derived from content, not from a user gesture. */
  setNodeSizeTransient: (id: string, size: { width?: number; height?: number }) => void;

  nudgeSelected: (dx: number, dy: number) => void;
  duplicateSelection: (options?: { offset?: number; select?: boolean }) => void;
  pasteClipboard: (clip: ClipboardPayload, offset?: number) => ClipboardPayload;

  setDefaultStyle: (patch: { fill?: string; stroke?: string; connector?: ConnectorKind }) => void;

  bringToFront: () => void;
  sendToBack: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  toggleLock: () => void;
  updateSelectedNodesData: (patch: Partial<ShapeData>) => void;
  /** Redraws the selection as another kind of shape, keeping everything else. */
  setSelectedShapeKind: (kind: ShapeKind) => void;

  /** Lines the selection up on its own bounding box. Needs two nodes to mean anything. */
  alignSelected: (mode: AlignMode) => void;
  /** Equalises the gaps between the selection's edges. Needs three: the ends stay put. */
  distributeSelected: (axis: DistributeAxis) => void;
  /** Resizes the selection to its largest node. Needs two. */
  matchSizeSelected: (dim: MatchDimension) => void;

  deleteSelection: () => void;
  undo: () => void;
  redo: () => void;
}

// ---- tiny undo/redo history (snapshot-based, good enough for a diagram tool) ----
// The stacks stay module-level so they never reach the serialized diagram; the
// `canUndo` / `canRedo` booleans in the store are the UI's view of them.
type Snapshot = { nodes: ShapeNode[]; edges: ConnectorEdge[] };
let past: Snapshot[] = [];
let future: Snapshot[] = [];
let suppressHistory = false;

/** Consecutive arrow-key nudges inside this window share one history entry. */
const NUDGE_COALESCE_MS = 500;
let lastNudgeAt = 0;

function snapshotOf(state: DiagramState): Snapshot {
  return { nodes: state.nodes, edges: state.edges };
}

function historyFlags() {
  return { canUndo: past.length > 0, canRedo: future.length > 0 };
}

function pushSnapshot(snapshot: Snapshot) {
  if (suppressHistory) return;
  past = [...past.slice(-49), snapshot];
  future = [];
  useDiagramStore.setState(historyFlags());
}

function pushHistory(state: DiagramState) {
  pushSnapshot(snapshotOf(state));
}

/**
 * Applies positions computed by one of the `arrange` helpers, as a single
 * history entry — or none at all when nothing would actually move, so a command
 * run on an already-aligned selection does not cost the user a ⌘Z. Locked nodes
 * sit the move out the way they sit out a nudge, but they still counted towards
 * the geometry, so locking a node makes it the anchor everything else lines up on.
 */
function commitArrangedPositions(positions: Record<string, ArrangePosition>) {
  const state = useDiagramStore.getState();
  const movedIds = new Set(
    state.nodes
      .filter((n) => {
        const next = positions[n.id];
        return !n.data.locked && next && (next.x !== n.position.x || next.y !== n.position.y);
      })
      .map((n) => n.id),
  );
  if (movedIds.size === 0) return;

  pushHistory(state);
  useDiagramStore.setState({
    nodes: state.nodes.map((n) => (movedIds.has(n.id) ? { ...n, position: positions[n.id] } : n)),
  });
}

/** The size counterpart of `commitArrangedPositions`, with the same rules. */
function commitArrangedSizes(sizes: Record<string, ArrangeSize>) {
  const state = useDiagramStore.getState();
  const resizedIds = new Set(
    state.nodes
      .filter((n) => {
        const next = sizes[n.id];
        return !n.data.locked && next && (next.w !== nodeWidth(n) || next.h !== nodeHeight(n));
      })
      .map((n) => n.id),
  );
  if (resizedIds.size === 0) return;

  pushHistory(state);
  useDiagramStore.setState({
    nodes: state.nodes.map((n) =>
      resizedIds.has(n.id) ? { ...n, width: sizes[n.id].w, height: sizes[n.id].h } : n,
    ),
  });
}

/** The `ConnectorData` fields `computeMarkers` reads. */
const MARKER_KEYS = [
  'stroke',
  'startArrowStyle',
  'endArrowStyle',
  'strokeWidth',
] as const satisfies readonly (keyof ConnectorData)[];

/** True when a connector patch changes something the arrowheads are derived from. */
function touchesMarkers(patch: Partial<ConnectorData>): boolean {
  return MARKER_KEYS.some((key) => key in patch);
}

/**
 * True when every key in `patch` already holds that exact value — a commit that
 * would leave the diagram untouched and so must not cost the user a ⌘Z.
 */
function isNoOpPatch<T extends object>(current: T, patch: Partial<T>): boolean {
  return (Object.keys(patch) as (keyof T)[]).every((key) => Object.is(current[key], patch[key]));
}

/** Clone nodes/edges with fresh ids, offset positions, and edges remapped onto the clones. */
function cloneSubgraph(
  nodes: ShapeNode[],
  edges: ConnectorEdge[],
  offset: number,
  selected = true,
): { nodes: ShapeNode[]; edges: ConnectorEdge[] } {
  const idMap = new Map<string, string>();
  const clonedNodes = nodes.map((n) => {
    const newId = nanoid(8);
    idMap.set(n.id, newId);
    return {
      ...n,
      id: newId,
      position: { x: n.position.x + offset, y: n.position.y + offset },
      selected,
    };
  });
  const clonedEdges = edges.map((e) => ({
    ...e,
    id: nanoid(8),
    source: idMap.get(e.source) ?? e.source,
    target: idMap.get(e.target) ?? e.target,
    selected,
  }));
  return { nodes: clonedNodes, edges: clonedEdges };
}

function serializeNodes(nodes: ShapeNode[]) {
  return nodes.map((n) => ({
    id: n.id, type: n.type, position: n.position,
    width: n.width, height: n.height, data: n.data,
  }));
}

function serializeEdges(edges: ConnectorEdge[]) {
  return edges.map((e) => ({
    id: e.id, source: e.source, target: e.target, type: e.type,
    sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
    zIndex: e.zIndex, markerStart: e.markerStart, markerEnd: e.markerEnd,
    data: e.data,
  }));
}

/** The exact JSON written to `Diagram.data` — always stamped with a version. */
export function serializeDiagram(
  nodes: ShapeNode[],
  edges: ConnectorEdge[],
  viewport?: DiagramViewport | null,
): DiagramData {
  return {
    version: CURRENT_DIAGRAM_VERSION,
    nodes: serializeNodes(nodes) as unknown as DiagramData['nodes'],
    edges: serializeEdges(edges) as unknown as DiagramData['edges'],
    // Left out entirely rather than written as null: a diagram nobody has
    // panned should open framed on whatever screen it is opened on.
    ...(viewport ? { viewport } : {}),
  };
}

export const useDiagramStore = create<DiagramState>((set, get) => ({
  diagramId: null,
  title: 'Untitled',
  starred: false,
  saveStatus: 'idle' as SaveStatus,
  editingNodeId: null,
  editingEdgeId: null,
  nodes: [],
  edges: [],
  guides: [],
  viewport: null,
  tool: 'select',
  defaultFill: DEFAULT_SWATCH.fill,
  defaultStroke: DEFAULT_SWATCH.stroke,
  defaultConnector: 'elbow',
  canUndo: false,
  canRedo: false,

  loadDiagram: (id, title, starred, data) => {
    // Migrate before touching any state: a payload from a newer build throws,
    // and the store must be left as it was rather than half-loaded.
    const migrated = migrateDiagramData(data);

    past = [];
    future = [];
    suppressHistory = false;
    lastNudgeAt = 0;
    set({
      diagramId: id,
      title,
      starred,
      saveStatus: 'idle',
      nodes: migrated.nodes as unknown as ShapeNode[],
      edges: migrated.edges as unknown as ConnectorEdge[],
      // Cleared, not kept: /d/A -> /d/B reuses this store, and B must not open
      // on A's camera.
      viewport: migrated.viewport ?? null,
      ...historyFlags(),
    });
  },

  saveDiagram: async (options) => {
    const { diagramId, title, nodes, edges, viewport, saveStatus } = get();
    if (!diagramId) return;
    const wasFailing = saveStatus === 'error' || saveStatus === 'retrying';
    set({ saveStatus: 'saving' });
    try {
      await api.saveDiagram(
        diagramId,
        {
          // The API rejects a blank title, so a diagram whose name the user
          // cleared would fail every autosave from then on.
          title: title.trim() || 'Untitled',
          data: serializeDiagram(nodes, edges, viewport),
        },
        options,
      );
      set({ saveStatus: 'saved' });
    } catch {
      // Once the autosaver is retrying, every further failure of that streak
      // keeps saying "retrying" rather than flashing "save failed" per attempt.
      set({ saveStatus: saveStatus === 'retrying' ? 'retrying' : 'error' });
      // A broken connection would otherwise stack one toast per attempt. Only
      // the first failure of a streak is announced; the SaveIndicator carries
      // the state after that.
      if (!wasFailing) toastError('Save failed — retrying');
    }
  },

  setTitle: (title) => set({ title }),
  setStarred: (starred) => set({ starred }),
  setEditingNodeId: (id) => set({ editingNodeId: id, editingEdgeId: null }),
  setEditingEdgeId: (id) => set({ editingEdgeId: id, editingNodeId: null }),

  setTool: (tool) => set({ tool }),

  setViewport: (viewport) => set({ viewport }),

  onNodesChange: (changes) => {
    const lockedIds = new Set(get().nodes.filter((n) => n.data.locked).map((n) => n.id));
    if (lockedIds.size > 0) {
      changes = changes.filter((c) => {
        if (c.type === 'add') return true;
        if (!lockedIds.has(c.id)) return true;
        if (c.type === 'select' || c.type === 'remove') return true;
        if (c.type === 'dimensions' && !c.resizing) return true;
        return false;
      });
    }
    const dragEnded = changes.some((c) => c.type === 'position' && c.dragging === false);
    const isDragging = changes.some((c) => c.type === 'position' && c.dragging === true);
    const structural = changes.some((c) => c.type === 'add' || c.type === 'remove');
    const resized = changes.some((c) => c.type === 'dimensions' && c.resizing === false);
    if (dragEnded || structural || resized) pushHistory(get());

    if (isDragging) {
      const state = get();
      const posChanges = changes.filter(
        (c): c is NodeChange<ShapeNode> & { type: 'position' } => c.type === 'position' && c.dragging === true,
      );
      const draggedIds = new Set(posChanges.map((c) => c.id));
      const others = state.nodes
        .filter((n) => !draggedIds.has(n.id))
        .map((n) => ({ x: n.position.x, y: n.position.y, w: nodeWidth(n), h: nodeHeight(n) }));

      // Where each dragged node would land before any snapping.
      const dragged = posChanges.flatMap((change) => {
        const node = state.nodes.find((n) => n.id === change.id);
        if (!node) return [];
        return [{
          change,
          x: change.position?.x ?? node.position.x,
          y: change.position?.y ?? node.position.y,
          w: nodeWidth(node),
          h: nodeHeight(node),
        }];
      });

      if (others.length > 0 && dragged.length > 0) {
        // A multi-selection snaps as one rigid box: the guides are computed for
        // its bounding box and the resulting offset is applied to every node in
        // it, so the shapes keep their spacing instead of collapsing onto the
        // same guide one by one.
        const x = Math.min(...dragged.map((d) => d.x));
        const y = Math.min(...dragged.map((d) => d.y));
        const w = Math.max(...dragged.map((d) => d.x + d.w)) - x;
        const h = Math.max(...dragged.map((d) => d.y + d.h)) - y;

        const { dx, dy, guides } = computeAlignmentSnap({ x, y, w, h }, others);

        if (dx !== 0 || dy !== 0) {
          for (const d of dragged) d.change.position = { x: d.x + dx, y: d.y + dy };
        }
        set((s) => ({ nodes: applyNodeChanges(changes, s.nodes), guides }));
        return;
      }
    }

    if (dragEnded) {
      set((s) => ({ nodes: applyNodeChanges(changes, s.nodes), guides: [] }));
      return;
    }

    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) }));
  },

  onEdgesChange: (changes) => {
    const structural = changes.some((c) => c.type === 'add' || c.type === 'remove');
    if (structural) pushHistory(get());
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }));
  },

  onConnect: (connection) => {
    pushHistory(get());
    set((s) => {
      const data = makeEdgeData(s.defaultConnector);
      return {
        edges: rfAddEdge(
          {
            ...connection,
            type: 'connector',
            zIndex: 1000,
            ...computeMarkers(data),
            data,
          },
          s.edges,
        ) as ConnectorEdge[],
      };
    });
  },

  addShape: (shape, position) => {
    pushHistory(get());
    const id = nanoid(8);
    const { defaultFill, defaultStroke } = get();
    const sizeByShape: Record<ShapeKind, { width: number; height: number }> = {
      rectangle: { width: 180, height: 100 },
      ellipse: { width: 120, height: 120 },
      diamond: { width: 180, height: 120 },
      sticky: { width: 160, height: 160 },
      text: { width: 160, height: 40 },
      pill: { width: 180, height: 70 },
      triangle: { width: 140, height: 120 },
      hexagon: { width: 160, height: 100 },
      cylinder: { width: 120, height: 130 },
      parallelogram: { width: 190, height: 100 },
      document: { width: 170, height: 120 },
      cloud: { width: 190, height: 130 },
      star: { width: 140, height: 140 },
      callout: { width: 180, height: 120 },
      arrow: { width: 170, height: 90 },
      // Never used in practice: images are inserted through `addImageNode`,
      // which always knows the real pixel size. Present so the table stays
      // exhaustive over ShapeKind.
      image: { width: 240, height: 180 },
    };
    const node: ShapeNode = {
      id,
      type: 'shape',
      position,
      ...sizeByShape[shape],
      data: {
        label: '',
        shape,
        fill: shape === 'sticky' ? '#FBF3D0' : shape === 'text' ? 'transparent' : defaultFill,
        stroke: shape === 'text' ? 'transparent' : shape === 'sticky' ? '#E9B10A' : defaultStroke,
      },
    };
    set((s) => ({ nodes: [...s.nodes, node], editingNodeId: shape === 'text' ? id : null }));
    return id;
  },

  // An inserted image (paste, drop, file picker). Its node is the image: no
  // fill, no stroke, no label — so the caller has to supply the size it should
  // be drawn at rather than falling back to a shape default.
  addImageNode: ({ src, width, height, position }) => {
    pushHistory(get());
    const id = nanoid(8);
    const node: ShapeNode = {
      id,
      type: 'shape',
      position,
      width,
      height,
      data: { label: '', shape: 'image', fill: 'transparent', stroke: 'transparent', imageSrc: src },
    };
    set((s) => ({ nodes: [...s.nodes, node] }));
    return id;
  },

  // A grey box standing in for an image while its bytes are on their way to
  // the server. Deliberately not undoable: an upload that later fails would
  // otherwise leave a ⌘Z that appears to do nothing.
  addImagePlaceholder: ({ width, height, position }) => {
    const id = nanoid(8);
    const node: ShapeNode = {
      id,
      type: 'shape',
      position,
      width,
      height,
      data: { label: '', shape: 'image', fill: 'transparent', stroke: 'transparent', uploading: true },
    };
    set((s) => ({ nodes: [...s.nodes, node] }));
    return id;
  },

  resolveImagePlaceholder: (id, { src, width, height, position }) => {
    const state = get();
    // The user can delete or undo the placeholder away mid-upload; when they
    // have, the arriving image has nowhere to go and nothing to record.
    if (!state.nodes.some((n) => n.id === id)) return;

    // The one history entry for the whole insert, holding the diagram as it
    // was *before* the placeholder appeared — which is where ⌘Z should land.
    pushSnapshot({ nodes: state.nodes.filter((n) => n.id !== id), edges: state.edges });

    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              position,
              width,
              height,
              data: { label: '', shape: 'image', fill: 'transparent', stroke: 'transparent', imageSrc: src },
            }
          : n,
      ),
    }));
  },

  removeImagePlaceholder: (id) => {
    set((s) => ({ nodes: s.nodes.filter((n) => n.id !== id) }));
  },

  // Click a directional handle on a hovered shape to instantly spawn a
  // connected neighbor in that direction, Whimsical-style quick-add.
  addConnectedShape: (sourceId, direction) => {
    const state = get();
    const source = state.nodes.find((n) => n.id === sourceId);
    if (!source) return null;
    pushHistory(state);

    const gap = 90;
    const width = source.width ?? 180;
    const height = source.height ?? 100;
    const newWidth = width;
    const newHeight = height;
    const sx = source.position.x;
    const sy = source.position.y;

    const layout: Record<Direction, { position: { x: number; y: number }; sourceHandle: string; targetHandle: string }> = {
      right: {
        position: { x: sx + width + gap, y: sy + height / 2 - newHeight / 2 },
        sourceHandle: 'right',
        targetHandle: 'left',
      },
      left: {
        position: { x: sx - newWidth - gap, y: sy + height / 2 - newHeight / 2 },
        sourceHandle: 'left',
        targetHandle: 'right',
      },
      bottom: {
        position: { x: sx + width / 2 - newWidth / 2, y: sy + height + gap },
        sourceHandle: 'bottom',
        targetHandle: 'top',
      },
      top: {
        position: { x: sx + width / 2 - newWidth / 2, y: sy - newHeight - gap },
        sourceHandle: 'top',
        targetHandle: 'bottom',
      },
    };
    const { position, sourceHandle, targetHandle } = layout[direction];

    const id = nanoid(8);
    const node: ShapeNode = {
      id,
      type: 'shape',
      position,
      width: newWidth,
      height: newHeight,
      selected: true,
      data: { label: '', shape: source.data.shape, fill: source.data.fill, stroke: source.data.stroke },
    };
    const edgeData = makeEdgeData(state.defaultConnector);
    const edge: ConnectorEdge = {
      id: nanoid(8),
      source: sourceId,
      target: id,
      sourceHandle,
      targetHandle,
      type: 'connector',
      zIndex: 1000,
      ...computeMarkers(edgeData),
      data: edgeData,
    };
    set((s) => ({
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), node],
      edges: [...s.edges, edge],
    }));
    return id;
  },

  // A discrete edit (label commit, formatting, link, …). Undoable, unless the
  // patch is a no-op — committing unchanged text must not add a history entry.
  updateNodeData: (id, data) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node || isNoOpPatch(node.data, data)) return;
    pushHistory(get());
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
    }));
  },

  updateSelectedNodesStyle: (patch) => {
    pushHistory(get());
    set((s) => ({
      nodes: s.nodes.map((n) => (n.selected ? { ...n, data: { ...n.data, ...patch } } : n)),
      defaultFill: patch.fill ?? s.defaultFill,
      defaultStroke: patch.stroke ?? s.defaultStroke,
    }));
  },

  updateEdgeData: (id, data) => {
    const edge = get().edges.find((e) => e.id === id);
    if (!edge || (edge.data && isNoOpPatch(edge.data, data))) return;
    pushHistory(get());
    set((s) => ({
      edges: s.edges.map((e) => {
        if (e.id !== id) return e;
        const next = { ...e.data!, ...data };
        // Arrowheads are derived from `data` but live on the edge, so any patch
        // that touches what they are derived from has to regenerate them.
        return { ...e, ...(touchesMarkers(data) ? computeMarkers(next) : {}), data: next };
      }),
    }));
  },

  // ---- continuous interactions ----------------------------------------------
  // A pointer drag records one entry up front via `beginInteraction`, then runs
  // its per-move updates through a transient action that skips history.

  beginInteraction: () => {
    pushHistory(get());
  },

  updateEdgeDataTransient: (id, data) => {
    set((s) => ({
      edges: s.edges.map((e) => (e.id === id ? { ...e, data: { ...e.data!, ...data } } : e)),
    }));
  },

  moveNodesTransient: (positions) => {
    set((s) => ({
      nodes: s.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)),
    }));
  },

  // A text shape's height follows its content rather than a user gesture, so
  // growing it must never cost the user an undo step.
  setNodeSizeTransient: (id, size) => {
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id
          ? { ...n, width: size.width ?? n.width, height: size.height ?? n.height }
          : n,
      ),
    }));
  },

  // Continuous drag updates (no history push per-frame), mirroring the bend-drag pattern.
  reconnectEdgeEndpoint: (edgeId, end, nodeId, anchor) => {
    set((s) => ({
      edges: s.edges.map((e) =>
        e.id === edgeId
          ? {
              ...e,
              source: end === 'source' ? nodeId : e.source,
              target: end === 'target' ? nodeId : e.target,
              data: {
                ...e.data!,
                [end === 'source' ? 'sourceAnchor' : 'targetAnchor']: anchor,
              },
            }
          : e,
      ),
    }));
  },

  updateSelectedEdgesStyle: (patch) => {
    pushHistory(get());
    set((s) => ({
      edges: s.edges.map((e) => {
        if (!e.selected) return e;
        const data = { ...e.data!, ...patch };
        return { ...e, ...computeMarkers(data), data };
      }),
    }));
  },

  setDefaultStyle: (patch) =>
    set((s) => ({
      defaultFill: patch.fill ?? s.defaultFill,
      defaultStroke: patch.stroke ?? s.defaultStroke,
      defaultConnector: patch.connector ?? s.defaultConnector,
    })),

  // Node stacking order follows array order (later = drawn on top), so
  // z-ordering is just a matter of reordering `nodes`.
  bringToFront: () => {
    pushHistory(get());
    set((s) => {
      const selected = s.nodes.filter((n) => n.selected);
      if (selected.length === 0) return {};
      const rest = s.nodes.filter((n) => !n.selected);
      return { nodes: [...rest, ...selected] };
    });
  },

  sendToBack: () => {
    pushHistory(get());
    set((s) => {
      const selected = s.nodes.filter((n) => n.selected);
      if (selected.length === 0) return {};
      const rest = s.nodes.filter((n) => !n.selected);
      return { nodes: [...selected, ...rest] };
    });
  },

  bringForward: () => {
    pushHistory(get());
    set((s) => {
      const nodes = [...s.nodes];
      for (let i = nodes.length - 2; i >= 0; i--) {
        if (nodes[i].selected && !nodes[i + 1].selected) {
          [nodes[i], nodes[i + 1]] = [nodes[i + 1], nodes[i]];
        }
      }
      return { nodes };
    });
  },

  sendBackward: () => {
    pushHistory(get());
    set((s) => {
      const nodes = [...s.nodes];
      for (let i = 1; i < nodes.length; i++) {
        if (nodes[i].selected && !nodes[i - 1].selected) {
          [nodes[i], nodes[i - 1]] = [nodes[i - 1], nodes[i]];
        }
      }
      return { nodes };
    });
  },

  toggleLock: () => {
    pushHistory(get());
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.selected ? { ...n, data: { ...n.data, locked: !n.data.locked } } : n,
      ),
    }));
  },

  // Formatting (and the copied style behind ⌘⌥C / ⌘⌥V) applied to the whole
  // selection at once. Images carry no text and no fill or stroke of their own,
  // so they sit it out rather than collecting data nothing will ever render.
  updateSelectedNodesData: (patch) => {
    pushHistory(get());
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.selected && n.data.shape !== 'image' ? { ...n, data: { ...n.data, ...patch } } : n,
      ),
    }));
  },

  // Swapping the outline under a shape, not replacing the shape: the label,
  // the box it was drawn at and its colours all survive, so a flowchart can be
  // re-drawn as one without retyping it. Nodes that have no outline to swap
  // (images, text) or that are locked sit it out, and a swap that would change
  // nothing costs no history entry.
  setSelectedShapeKind: (kind) => {
    const willChange = (n: ShapeNode) =>
      n.selected && canSwapShapeKind(n.data) && n.data.shape !== kind;

    const state = get();
    if (!state.nodes.some(willChange)) return;

    pushHistory(state);
    set((s) => ({
      nodes: s.nodes.map((n) => (willChange(n) ? { ...n, data: { ...n.data, shape: kind } } : n)),
    }));
  },

  alignSelected: (mode) => {
    const rects = selectedRects(get().nodes);
    if (rects.length < 2) return;
    commitArrangedPositions(alignNodes(rects, mode));
  },

  distributeSelected: (axis) => {
    const rects = selectedRects(get().nodes);
    if (rects.length < 3) return;
    commitArrangedPositions(distributeNodes(rects, axis));
  },

  matchSizeSelected: (dim) => {
    const rects = selectedRects(get().nodes);
    if (rects.length < 2) return;
    commitArrangedSizes(matchSize(rects, dim));
  },

  // Arrow-key nudge. A burst of key repeats is one edit as far as the user is
  // concerned, so entries coalesce until the keyboard goes quiet. Locked nodes
  // sit it out, the same way `onNodesChange` drops their drag positions.
  nudgeSelected: (dx, dy) => {
    const state = get();
    const selectedIds = new Set(
      state.nodes.filter((n) => n.selected && !n.data.locked).map((n) => n.id),
    );
    // Nothing will move, so this must not cost the user a ⌘Z.
    if (selectedIds.size === 0) return;

    const now = Date.now();
    if (now - lastNudgeAt > NUDGE_COALESCE_MS) pushHistory(state);
    lastNudgeAt = now;

    set((s) => ({
      nodes: s.nodes.map((n) =>
        selectedIds.has(n.id)
          ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
          : n,
      ),
    }));
  },

  // ⌘D duplicates to an offset and moves the selection onto the copies. ⌥-drag
  // asks for `{ offset: 0, select: false }` instead: the copy is left behind,
  // unselected and underneath, while the originals travel with the pointer.
  duplicateSelection: ({ offset = 30, select = true }: { offset?: number; select?: boolean } = {}) => {
    const state = get();
    const selNodes = state.nodes.filter((n) => n.selected);
    if (selNodes.length === 0) return;
    pushHistory(state);

    const selIds = new Set(selNodes.map((n) => n.id));
    const selEdges = state.edges.filter((e) => selIds.has(e.source) && selIds.has(e.target));
    const clones = cloneSubgraph(selNodes, selEdges, offset, select);

    set((s) =>
      select
        ? {
            nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...clones.nodes],
            edges: [...s.edges.map((e) => ({ ...e, selected: false })), ...clones.edges],
          }
        : {
            // Clones go first so they render behind the originals.
            nodes: [...clones.nodes, ...s.nodes],
            edges: [...s.edges, ...clones.edges],
          },
    );
  },

  // Returns what was pasted (deselected) so the caller can make it the next
  // clipboard, which is how repeated ⌘V keeps stepping away from the original.
  pasteClipboard: (clip, offset = 30) => {
    if (clip.nodes.length === 0) return { nodes: [], edges: [] };
    pushHistory(get());

    const pasted = cloneSubgraph(clip.nodes, clip.edges, offset);
    set((s) => ({
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...pasted.nodes],
      edges: [...s.edges.map((e) => ({ ...e, selected: false })), ...pasted.edges],
    }));

    return {
      nodes: pasted.nodes.map((n) => ({ ...n, selected: false })),
      edges: pasted.edges.map((e) => ({ ...e, selected: false })),
    };
  },

  deleteSelection: () => {
    pushHistory(get());
    set((s) => {
      const deletedNodeIds = new Set(s.nodes.filter((n) => n.selected && !n.data.locked).map((n) => n.id));
      return {
        nodes: s.nodes.filter((n) => !n.selected || n.data.locked),
        edges: s.edges.filter((e) => !e.selected && !deletedNodeIds.has(e.source) && !deletedNodeIds.has(e.target)),
      };
    });
  },

  undo: () => {
    if (past.length === 0) return;
    const state = get();
    const previous = past[past.length - 1];
    past = past.slice(0, -1);
    future = [snapshotOf(state), ...future];
    suppressHistory = true;
    lastNudgeAt = 0;
    set({ nodes: previous.nodes, edges: previous.edges, ...historyFlags() });
    suppressHistory = false;
  },

  redo: () => {
    if (future.length === 0) return;
    const state = get();
    const next = future[0];
    future = future.slice(1);
    past = [...past, snapshotOf(state)];
    suppressHistory = true;
    lastNudgeAt = 0;
    set({ nodes: next.nodes, edges: next.edges, ...historyFlags() });
    suppressHistory = false;
  },
}));
