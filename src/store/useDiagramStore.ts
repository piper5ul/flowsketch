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
import type { DiagramData, DiagramRole, DiagramViewport } from '../../shared/types';
import type {
  ConnectorData,
  ConnectorKind,
  DiagramNodeType,
  Direction,
  EdgeAnchor,
  ShapeData,
  ShapeKind,
  Tool,
} from '../types';
import { DEFAULT_SWATCH } from '../lib/palette';
import { makeEdgeData } from '../lib/defaults';
import {
  kindOf,
  pickConnectorStyle,
  pickShapeStyle,
  resolveDefaultStyle,
  withDefault,
  type BoardDefaults,
  type DefaultStyleKind,
} from '../lib/defaultStyle';

const SIDE_IDS: readonly string[] = ['top', 'right', 'bottom', 'left'];
/** A React Flow handle id that names one of a shape's four sides. */
function isSideId(id: string | null | undefined): id is Direction {
  return typeof id === 'string' && SIDE_IDS.includes(id);
}
import { computeMarkers } from '../lib/edgeMarkers';
import { canSwapShapeKind, isAnchorNode, isContainerNode, isFrameNode, isGroupNode } from '../lib/nodeKinds';
import {
  absolutePosition,
  boundsOf,
  innermostContaining,
  normalizeParentage,
  sortParentsFirst,
  subtreeIds,
} from '../lib/nodeTree';
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
import { ConflictError, UnauthorizedError, api } from '../lib/api';
import type { ImageBackfillPatch } from '../lib/imageBackfill';
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

/**
 * A node on the board — a drawn shape, or one of the two containers.
 *
 * All three carry a `ShapeData` and live in the same array, so the store's
 * actions stay total over it; `type` is the discriminator (see
 * `DiagramNodeType`). The name is historical: for most of this app's life a
 * node *was* a shape.
 */
export type ShapeNode = Node<ShapeData, DiagramNodeType>;
export type ConnectorEdge = Edge<ConnectorData, 'connector'>;

/** How far a group's box stands off the shapes inside it. */
const GROUP_PADDING = 16;

/** A frame's size when it is first drawn. */
const FRAME_WIDTH = 480;
const FRAME_HEIGHT = 320;

/** A frame's title before the user renames it. */
export const DEFAULT_FRAME_TITLE = 'Frame';

/**
 * A container's `data`. It is a `ShapeData` because every node's is — the
 * rectangle named here draws nothing, since `GroupNode` and `FrameNode` paint
 * themselves. The transparent fill and stroke are what keep a container out of
 * the toolbar's colour controls and out of `canSwapShapeKind`.
 */
function containerData(label: string): ShapeData {
  return { label, shape: 'rectangle', fill: 'transparent', stroke: 'transparent' };
}

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

/**
 * The selection as plain rects **in board coordinates**, in node order, for the
 * `arrange` helpers.
 *
 * A child's `position` is relative to its parent, so feeding raw positions to
 * `arrange.ts` would line a framed shape up with a frame-relative copy of the
 * board and leave it visibly crooked. The rects are absolute here and
 * `commitArrangedPositions` converts each result back on the way in.
 *
 * **A node whose ancestor is also selected sits the command out.** Moving a
 * container moves its contents with it (their positions are offsets from it), so
 * arranging both in one command would apply two moves to the same shape and the
 * result would match neither. Skipping the descendant keeps the container the
 * one thing that moves — the same rule `outermostSelected` applies to grouping.
 */
function selectedRects(nodes: ShapeNode[]): ArrangeRect[] {
  const byId = nodesById(nodes);
  const selectedIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
  return nodes
    .filter((n) => n.selected && !hasSelectedAncestor(n, byId, selectedIds))
    .map((n) => ({ id: n.id, ...absoluteBounds(n, byId) }));
}

/** True when any of `node`'s ancestors is in `selectedIds`. */
function hasSelectedAncestor(
  node: ShapeNode,
  byId: Map<string, ShapeNode>,
  selectedIds: ReadonlySet<string>,
): boolean {
  const seen = new Set<string>([node.id]);
  let parentId = node.parentId;
  while (parentId !== undefined && !seen.has(parentId)) {
    if (selectedIds.has(parentId)) return true;
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  return false;
}

/** Every node by id, for the parent-chain walks in `src/lib/nodeTree.ts`. */
function nodesById(nodes: ShapeNode[]): Map<string, ShapeNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

/** A node's box in absolute (board) coordinates, ancestors folded in. */
function absoluteBounds(node: ShapeNode, byId: Map<string, ShapeNode>) {
  const { x, y } = absolutePosition(node, byId);
  return { x, y, w: nodeWidth(node), h: nodeHeight(node) };
}

/**
 * True for a node that can be put in a group.
 *
 * A floating arrow's two invisible endpoints are not shapes the user drew and
 * have no business being re-parented — but a *container* wears the same
 * transparent fill and stroke, which is what `isAnchorNode` reads, so groups
 * and frames have to be let back in explicitly. That is what makes a group of
 * groups possible.
 */
export function canGroupNode(node: ShapeNode): boolean {
  return isContainerNode(node) || !isAnchorNode(node.data);
}

/** True when `groupSelected` would actually make a group of what is selected. */
export function canGroupSelection(nodes: ShapeNode[]): boolean {
  return outermostSelected(nodes).length >= 2;
}

/**
 * The selected nodes that would become a group's direct children: the ones
 * whose own parent is not also selected, since a child already travels with it.
 */
function outermostSelected(nodes: ShapeNode[]): ShapeNode[] {
  const selectedIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
  return nodes.filter(
    (n) => n.selected && canGroupNode(n) && (n.parentId === undefined || !selectedIds.has(n.parentId)),
  );
}

/**
 * `retrying` is owned by the autosaver, not by `saveDiagram`: it is set once
 * the autosaver has scheduled another attempt after a failure (see
 * `src/lib/autosave.ts`), and it survives the failures that follow.
 *
 * `conflict` and `unauthorized` are both terminal until the user acts: neither
 * is worth retrying, because another attempt would fail exactly the same way.
 * `CanvasPage` stops autosaving while `saveStatus` is one of them.
 */
export type SaveStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error'
  | 'retrying'
  | 'conflict'
  | 'unauthorized';

/**
 * What `saveDiagram` did. It never rejects — its other callers `void` it —
 * so the outcome is a value the autosave callback can act on: only `error` is
 * worth another attempt.
 */
export type SaveOutcome = 'saved' | 'error' | 'conflict' | 'unauthorized' | 'skipped';

/**
 * How a collaborative diagram is written: not at all, by this module.
 *
 * Once the Yjs document is bound (`src/lib/collab/binding.ts`), the document
 * *is* the save — the server renders `Diagram.data` from it — so `saveDiagram`
 * must not `PUT` a whole copy of the board over the top of everybody's merged
 * edits. What it does instead is ask whether this browser's edits have reached
 * the server, which is the same question "Saved" has always answered.
 *
 * Registered from outside rather than imported, for the reason
 * `setUnauthorizedHandler` is: `useCollabStore` reads this store, and an import
 * the other way would be a cycle. `null` means the open diagram is not
 * collaborative — a public share page, or a session whose socket was refused —
 * and the JSON save below is still the only thing writing it.
 */
let flushDocument: (() => Promise<boolean>) | null = null;

export function setDocumentFlush(flush: (() => Promise<boolean>) | null): void {
  flushDocument = flush;
}

/** True while the open diagram's contents are being written to the document. */
export function isDocumentBound(): boolean {
  return flushDocument !== null;
}

/**
 * Undo, for a diagram that lives in a shared document.
 *
 * Phase 3 of `docs/realtime.md`: a `Y.UndoManager` scoped to this browser's
 * transaction origin, so ⌘Z reverts *your* edits and never a collaborator's.
 * The snapshot stacks below stay exactly as they were for a diagram with no
 * document behind it — a socket that was refused, an older deployment — and
 * this store dispatches to whichever of the two is in force.
 *
 * Registered from outside rather than imported, for the reason
 * `setDocumentFlush` is: the binding reads this store, and an import the other
 * way would be a cycle.
 */
export interface DocumentHistory {
  undo: () => void;
  redo: () => void;
  /**
   * Where the snapshot history would have pushed an entry: the next edit
   * starts a new undo step rather than joining the one before it.
   *
   * The document has no snapshots to push, so what the two models share is not
   * the entry but the *boundary* — which is why every `pushHistory` call site
   * still marks exactly the right place and none of them had to be visited.
   */
  beginEntry: () => void;
  /** Forget both stacks — a different diagram, or one restored over this one. */
  clear: () => void;
}

let documentHistory: DocumentHistory | null = null;

export function setDocumentHistory(history: DocumentHistory | null): void {
  documentHistory = history;
}

/** True while ⌘Z is the document's per-user undo rather than the snapshot stack. */
export function hasDocumentHistory(): boolean {
  return documentHistory !== null;
}

/** Where the row actually is, once a save has been refused as stale. */
export interface SaveConflict {
  /** The `updatedAt` the server reports — i.e. what another tab wrote. */
  updatedAt: string;
}

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

/**
 * What the diagram being opened is, beyond its contents: who the reader is to
 * it, and whether they may write it back.
 *
 * Deliberately an options bag rather than two more positional arguments —
 * `loadDiagram` already takes five, and a boolean in sixth place would be
 * unreadable at every call site.
 */
export interface LoadDiagramOptions {
  /** What the caller may do with it. Defaults to `owner` — their own diagram. */
  role?: DiagramRole;
  /**
   * Overrides the role's own answer. The public `/s/:token` page loads a
   * diagram nobody is signed in to, so it says `true` outright rather than
   * inventing a role for an anonymous reader.
   */
  readOnly?: boolean;
  /**
   * The diagram's public share token, which the API sends to the owner alone.
   * Held here so the share dialog can render the link it already knows about
   * without re-fetching a diagram body it has no use for.
   */
  shareToken?: string | null;
}

export interface DiagramState {
  diagramId: string | null;
  title: string;
  starred: boolean;
  /**
   * What this reader may do with the open diagram. `owner` until a load says
   * otherwise, so a store that has never been loaded behaves as it always did.
   */
  role: DiagramRole;
  /**
   * True when the diagram must not be edited — a viewer's copy, or the public
   * share page. **The store is not gated on it**: every action still mutates
   * exactly as it would otherwise, because half-applied edits are far worse to
   * debug than an edit that never had a way in. The gate is the UI (the rail,
   * the toolbars and the context menu are not rendered), the command registry
   * (every mutating command's `when` is false) and `saveDiagram`, which
   * refuses to write. Undo history is likewise untouched: there is nothing to
   * undo when nothing can be done.
   */
  readOnly: boolean;
  /** The live public link's token, or `null` when there is no public link. */
  shareToken: string | null;
  saveStatus: SaveStatus;
  /**
   * The `updatedAt` this client is building on — what it loaded, then what
   * each successful save returned. Sent as the guard on the next save so a
   * second tab's write is refused rather than silently overwritten. `null`
   * when the server did not tell us (an older response, or no diagram yet),
   * which simply means the guard is not sent.
   */
  loadedAt: string | null;
  /** Set when a save was refused as stale; cleared by a reload or an overwrite. */
  conflict: SaveConflict | null;
  editingNodeId: string | null;
  editingEdgeId: string | null;
  /**
   * Bumped by `requestLinkEditor` (the K shortcut). The floating toolbar owns
   * the link popover and its input, so a keystroke asks it to open rather
   * than reaching into it; the count only ever goes up and is never saved.
   */
  linkEditorRequest: number;
  nodes: ShapeNode[];
  edges: ConnectorEdge[];
  guides: GuideLine[];
  /** Where the canvas was left, restored on the next open. `null` until it is reported. */
  viewport: DiagramViewport | null;
  tool: Tool;
  /**
   * The style new elements are drawn in **on this board** — what ⌘⇧D saves,
   * what is written into `DiagramData.defaults` and into the collaborative
   * document's `meta` map, and what a collaborator's new shapes pick up too.
   * `{}` on a board nobody has set a default on, which is every diagram written
   * before this existed.
   */
  defaults: BoardDefaults;
  /**
   * The style this *tab* last used, over the top of the board's.
   *
   * Picking a swatch (or a connector kind in the rail) carries over to the next
   * shape, the way Whimsical's quick-add does — but that is a habit of one
   * session, not a decision about the board, so it is never saved and never
   * leaves this browser. `resolveDefaultStyle` puts it above `defaults`, and
   * `saveSelectionAsDefault` clears the kind it writes: pressing ⌘⇧D is the
   * more recent word, and must not be overruled by a swatch picked earlier.
   */
  lastStyle: BoardDefaults;
  /** Mirrors the (non-serialized) undo/redo stacks so the UI can disable its buttons. */
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Bumped by every *transient* write — a frame of a drag, a slider being
   * moved, a text shape growing to fit what is being typed into it.
   *
   * It exists for the collaboration binding (`src/lib/collab/binding.ts`),
   * which has to tell a gesture in progress from the edit it ends in: pushing
   * every frame of a drag into the shared document would put sixty updates a
   * second on the wire for one shape moving. A counter rather than a flag
   * because the binding compares the state it was given with the one before it
   * and nothing has to remember to switch it off; nothing else reads it, and it
   * is not serialized.
   */
  transientSeq: number;

  /** @throws when `data` was written by a newer version — see `migrateDiagramData`. */
  loadDiagram: (
    id: string,
    title: string,
    starred: boolean,
    data: unknown,
    updatedAt?: string | null,
    options?: LoadDiagramOptions,
  ) => void;
  /**
   * Writes the diagram. `overwrite` drops the `ifUnmodifiedSince` guard, which
   * is what the conflict banner's "Overwrite" does: the user has been told
   * another tab wrote, and has chosen this version anyway.
   *
   * Answers `'skipped'` without touching the network in read-only mode: the
   * server would refuse it, and asking is how a viewer merely looking at a
   * board would collect a "Save failed" toast.
   */
  saveDiagram: (options?: { keepalive?: boolean; overwrite?: boolean }) => Promise<SaveOutcome>;
  /**
   * Records that *this* tab wrote the row at `updatedAt`, moving the conflict
   * guard on. Every write has to report here, thumbnails included: they land
   * through the same `PUT` and bump `updatedAt` like any edit, so a tab that
   * ignored its own thumbnail would go on to mistake it for another tab's work.
   */
  noteSaved: (updatedAt: string) => void;
  /** Records the public link being turned on (a token) or off (`null`). */
  setShareToken: (token: string | null) => void;
  setTitle: (title: string) => void;
  setStarred: (starred: boolean) => void;
  setEditingNodeId: (id: string | null) => void;
  setEditingEdgeId: (id: string | null) => void;
  requestLinkEditor: () => void;

  setTool: (tool: Tool) => void;
  /** Records a pan or zoom. Transient by design: moving the camera is not an edit. */
  setViewport: (viewport: DiagramViewport) => void;
  onNodesChange: (changes: NodeChange<ShapeNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<ConnectorEdge>[]) => void;
  onConnect: (connection: Connection) => void;

  addShape: (shape: ShapeKind, position: { x: number; y: number }) => string;
  /**
   * Draws a frame — a titled section — with its top-left at `position`.
   * Inserted at the *start* of the array, because a frame is the ground its
   * contents sit on and must be drawn behind them.
   */
  addFrame: (position: { x: number; y: number }) => string;

  /**
   * Wraps the selection in a group: one invisible box, sized to what is inside
   * it plus a margin, that moves everything with it. Needs two nodes that are
   * not already travelling together, and selects the group it makes.
   */
  groupSelected: () => void;
  /**
   * Undoes that for every selected group: its children go back to where they
   * are on the board and inherit the group's own parent, and the group itself
   * goes. One history entry however many groups were selected.
   */
  ungroupSelected: () => void;
  /**
   * Settles which frame each of `nodeIds` is now in, from where it was dropped.
   *
   * This is the whole of what makes a frame a container: dropping a shape
   * inside one makes it a child, dragging it out makes it a top-level node
   * again, and positions are converted so nothing moves on screen. Group
   * membership is left alone — a group is joined and left with ⌘G / ⌘⇧G, not
   * by dragging. Records one history entry, and none when nothing changed
   * hands.
   */
  reparentByPosition: (nodeIds: string[]) => void;
  addImageNode: (image: { src: string; width: number; height: number; position: { x: number; y: number } }) => string;

  // An insert whose upload is still in flight. The placeholder itself is not
  // an edit — history is recorded when (and only when) the upload lands.
  addImagePlaceholder: (box: { width: number; height: number; position: { x: number; y: number } }) => string;
  resolveImagePlaceholder: (
    id: string,
    image: { src: string; width: number; height: number; position: { x: number; y: number } },
  ) => void;
  removeImagePlaceholder: (id: string) => void;
  /**
   * Repoints nodes at uploaded images, replacing the base64 an old diagram was
   * carrying inline. Records **no** history entry: it is housekeeping, not an
   * edit the user made, and an undo that put the megabytes back would be a
   * trap. Autosave persists it like any other change to `nodes`.
   */
  applyImageBackfill: (patches: readonly ImageBackfillPatch[]) => void;
  addConnectedShape: (sourceId: string, direction: Direction) => string | null;
  updateNodeData: (id: string, data: Partial<ShapeData>) => void;
  updateSelectedNodesStyle: (patch: Partial<Pick<ShapeData, 'fill' | 'stroke'>>) => void;

  updateEdgeData: (id: string, data: Partial<ConnectorData>) => void;
  updateSelectedEdgesStyle: (patch: Partial<ConnectorData>) => void;
  reconnectEdgeEndpoint: (edgeId: string, end: 'source' | 'target', nodeId: string, anchor: EdgeAnchor) => void;
  insertEdgeWaypoint: (id: string, index: number, point: { x: number; y: number }) => void;
  removeEdgeWaypoint: (id: string, index: number) => void;

  // Continuous interactions: `beginInteraction` records the one entry, the
  // transient updaters then run per pointermove without touching history.
  beginInteraction: () => void;
  updateEdgeDataTransient: (id: string, data: Partial<ConnectorData>) => void;
  setEdgeWaypointTransient: (id: string, index: number, point: { x: number; y: number }) => void;
  moveNodesTransient: (positions: Record<string, { x: number; y: number }>) => void;
  /** Resizes a node without history — for sizes derived from content, not from a user gesture. */
  setNodeSizeTransient: (id: string, size: { width?: number; height?: number }) => void;

  nudgeSelected: (dx: number, dy: number) => void;
  duplicateSelection: (options?: { offset?: number; select?: boolean }) => void;
  pasteClipboard: (clip: ClipboardPayload, offset?: number) => ClipboardPayload;

  /**
   * Records the style this session is now using — the rail's connector kind,
   * and the swatch a colour pick applies. Session only: it writes `lastStyle`,
   * never the board's `defaults`, so nothing here is saved with the diagram.
   */
  setDefaultStyle: (patch: { fill?: string; stroke?: string; connector?: ConnectorKind }) => void;
  /**
   * "Save as default style" (⌘⇧D): the one selected node or edge becomes the
   * board's default for its kind, and every new element of that kind is drawn
   * that way — for everybody on the board, since `defaults` rides in the
   * collaborative document.
   *
   * Returns which kind was saved, or `null` when the selection is not exactly
   * one thing with a style to copy (a group, a frame and an image have none).
   *
   * **It pushes no history entry, on purpose and in both undo models.** For a
   * bound diagram the defaults live in the document's `meta` map, which is
   * deliberately outside the `Y.UndoManager`'s scope — so ⌘Z could not take
   * this back there however it was recorded, and pushing a boundary for it
   * would only split the *previous* edit in two. The snapshot stacks are held
   * to the same rule so the two histories agree: setting a default is a
   * preference about what comes next, not a mark on the diagram.
   */
  saveSelectionAsDefault: () => DefaultStyleKind | null;
  /** The `data` a new shape of `kind` starts with, board defaults applied. */
  newShapeData: (kind: ShapeKind) => ShapeData;
  /** The `data` a new connector starts with, board defaults applied. */
  newConnectorData: () => ConnectorData;

  bringToFront: () => void;
  sendToBack: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  toggleLock: () => void;
  updateSelectedNodesData: (patch: Partial<ShapeData>) => void;
  /** `updateSelectedNodesData` without the history entry, for a slider drag. */
  updateSelectedNodesDataTransient: (patch: Partial<ShapeData>) => void;
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
// **This is the history of a diagram with no shared document behind it.** When
// one is bound, `documentHistory` above takes every call below over and these
// stacks stay empty; see the undo model in CLAUDE.md.
//
// The stacks stay module-level so they never reach the serialized diagram; the
// `canUndo` / `canRedo` booleans in the store are the UI's view of them — of
// these stacks, or of the document's, whichever is in force.
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
  // A bound diagram keeps its history in the document. What the call site meant
  // still applies — "everything from here is a new undo step" — so the boundary
  // is passed on and the snapshot is dropped on the floor.
  if (documentHistory) {
    documentHistory.beginEntry();
    return;
  }
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
 *
 * `positions` are **board coordinates** (that is what `selectedRects` fed the
 * geometry), so each one is turned back into an offset from the node's parent
 * before it is stored: the shape lands where the user was shown it would, and
 * the JSON keeps the parent-relative form React Flow reads.
 */
function commitArrangedPositions(positions: Record<string, ArrangePosition>) {
  const state = useDiagramStore.getState();
  const byId = nodesById(state.nodes);
  const relative = new Map<string, ArrangePosition>();
  for (const node of state.nodes) {
    const next = positions[node.id];
    if (!next || node.data.locked) continue;
    // The parent is not itself being moved (a selected ancestor takes its
    // descendants out of the selection), so its absolute position is the offset
    // both before and after this command.
    const origin =
      node.parentId !== undefined && byId.has(node.parentId)
        ? absolutePosition(byId.get(node.parentId)!, byId)
        : { x: 0, y: 0 };
    const position = { x: next.x - origin.x, y: next.y - origin.y };
    if (position.x !== node.position.x || position.y !== node.position.y) relative.set(node.id, position);
  }
  if (relative.size === 0) return;

  pushHistory(state);
  useDiagramStore.setState({
    nodes: state.nodes.map((n) => {
      const position = relative.get(n.id);
      return position ? { ...n, position } : n;
    }),
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

/**
 * Clone nodes/edges with fresh ids, offset positions, and edges remapped onto
 * the clones.
 *
 * Parenting survives the copy, which is what makes duplicating a group or a
 * frame duplicate the thing inside it rather than a hollow box. Two rules
 * follow from a child's position being relative to its parent:
 *
 * - a clone whose parent was copied too points at the *copy*, and is not
 *   offset — its parent already moved, and stepping both would double it;
 * - a clone whose parent was left behind keeps the original as its parent, so
 *   duplicating one shape inside a frame leaves the copy in that frame.
 *
 * The ids are all minted before anything is rewritten, so a parent that
 * happens to come after its child in the list still maps.
 */
function cloneSubgraph(
  nodes: ShapeNode[],
  edges: ConnectorEdge[],
  offset: number,
  selected = true,
): { nodes: ShapeNode[]; edges: ConnectorEdge[] } {
  const idMap = new Map<string, string>();
  for (const n of nodes) idMap.set(n.id, nanoid(8));

  const clonedNodes = nodes.map((n) => {
    const parentCopied = n.parentId !== undefined && idMap.has(n.parentId);
    const step = parentCopied ? 0 : offset;
    return {
      ...n,
      id: idMap.get(n.id)!,
      ...(n.parentId !== undefined ? { parentId: idMap.get(n.parentId) ?? n.parentId } : {}),
      position: { x: n.position.x + step, y: n.position.y + step },
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
  return { nodes: sortParentsFirst(clonedNodes), edges: clonedEdges };
}

function serializeNodes(nodes: ShapeNode[]) {
  return nodes.map((n) => ({
    id: n.id, type: n.type, position: n.position,
    width: n.width, height: n.height, data: n.data,
    // Only written when there is one, so an ordinary diagram's JSON is byte for
    // byte what it always was. `extent` is React Flow's own containment rule;
    // nothing sets it today, and it round-trips so that a build which does is
    // not silently undone by one that does not.
    ...(n.parentId !== undefined ? { parentId: n.parentId } : {}),
    ...(n.extent !== undefined ? { extent: n.extent } : {}),
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
  defaults?: BoardDefaults | null,
): DiagramData {
  return {
    version: CURRENT_DIAGRAM_VERSION,
    nodes: serializeNodes(nodes) as unknown as DiagramData['nodes'],
    edges: serializeEdges(edges) as unknown as DiagramData['edges'],
    // Left out entirely rather than written as null: a diagram nobody has
    // panned should open framed on whatever screen it is opened on.
    ...(viewport ? { viewport } : {}),
    // Same: a board nobody has pressed ⌘⇧D on writes no `defaults` key at all,
    // so an older diagram's JSON is unchanged by this feature existing.
    ...(defaults && Object.keys(defaults).length > 0
      ? { defaults: defaults as DiagramData['defaults'] }
      : {}),
  };
}

/** A sticky note's own colours, which no swatch and no board default supplies. */
const STICKY_FILL = '#FBF3D0';
const STICKY_STROKE = '#E9B10A';

/**
 * The `data` a new shape starts with **before** any board default is laid over
 * it: the app's own answer, and what a diagram with no defaults still draws.
 *
 * A text shape has no box, so it is painted with nothing; a sticky note brings
 * its own paper; everything else starts on the default swatch.
 */
function builtInShapeData(shape: ShapeKind): ShapeData {
  if (shape === 'sticky') return { label: '', shape, fill: STICKY_FILL, stroke: STICKY_STROKE };
  if (shape === 'text') return { label: '', shape, fill: 'transparent', stroke: 'transparent' };
  return { label: '', shape, fill: DEFAULT_SWATCH.fill, stroke: DEFAULT_SWATCH.stroke };
}

/** The connector kind a board with nothing to say about it draws. */
const BUILT_IN_CONNECTOR: ConnectorKind = 'elbow';

/**
 * Which default-style kinds are represented among `nodes`, each once — so a
 * colour applied to a mixed selection updates the session default for a sticky
 * note and for a rectangle without either one inheriting the other's.
 * Containers and images have no style and are simply not among them.
 */
function kindsOf(nodes: readonly ShapeNode[]): Exclude<DefaultStyleKind, 'connector'>[] {
  const kinds = new Set<Exclude<DefaultStyleKind, 'connector'>>();
  for (const node of nodes) {
    const kind = kindOf(node);
    if (kind && kind !== 'connector') kinds.add(kind);
  }
  return [...kinds];
}

/**
 * `builtInShapeData`, with this board's default for the shape's kind — and then
 * this session's — laid over it. The two layers are `resolveDefaultStyle`'s;
 * the whitelist behind them is why a default can only ever restyle a shape and
 * never relabel, relink or lock it.
 */
function shapeDataWithDefaults(
  shape: ShapeKind,
  defaults: BoardDefaults,
  lastStyle: BoardDefaults,
): ShapeData {
  const base = builtInShapeData(shape);
  const kind = kindOf({ type: 'shape', data: { shape } });
  if (!kind || kind === 'connector') return base;
  return { ...base, ...resolveDefaultStyle(defaults, lastStyle, kind) };
}

/** The `data` a new connector starts with, this board's default laid over it. */
function connectorDataWithDefaults(defaults: BoardDefaults, lastStyle: BoardDefaults): ConnectorData {
  const style = resolveDefaultStyle(defaults, lastStyle, 'connector');
  return { ...makeEdgeData(style.connectorType ?? BUILT_IN_CONNECTOR), ...style };
}

/**
 * Which connector kind the rail should show as picked. Derived rather than
 * stored, so there is one answer to "what is the default connector" and the
 * rail cannot drift from what `newConnectorData` actually builds.
 */
export function defaultConnectorKind(state: Pick<DiagramState, 'defaults' | 'lastStyle'>): ConnectorKind {
  return resolveDefaultStyle(state.defaults, state.lastStyle, 'connector').connectorType ?? BUILT_IN_CONNECTOR;
}

export const useDiagramStore = create<DiagramState>((set, get) => ({
  diagramId: null,
  title: 'Untitled',
  starred: false,
  role: 'owner' as DiagramRole,
  readOnly: false,
  shareToken: null,
  saveStatus: 'idle' as SaveStatus,
  loadedAt: null,
  conflict: null,
  editingNodeId: null,
  editingEdgeId: null,
  linkEditorRequest: 0,
  nodes: [],
  edges: [],
  guides: [],
  viewport: null,
  tool: 'select',
  defaults: {} as BoardDefaults,
  lastStyle: {} as BoardDefaults,
  canUndo: false,
  canRedo: false,
  transientSeq: 0,

  loadDiagram: (id, title, starred, data, updatedAt, options) => {
    // Migrate before touching any state: a payload from a newer build throws,
    // and the store must be left as it was rather than half-loaded.
    const migrated = migrateDiagramData(data);

    const role = options?.role ?? 'owner';

    past = [];
    future = [];
    // Whichever history is in force, a load is where it starts again: the board
    // being opened is not one the entries on the stack describe. For a bound
    // diagram this is a version restore or a reload of the same document, and
    // the edit the load then pushes into it is one step of its own.
    documentHistory?.clear();
    suppressHistory = false;
    lastNudgeAt = 0;
    set({
      diagramId: id,
      title,
      starred,
      role,
      // A viewer cannot write, and the caller may say so outright for a reader
      // who has no role at all (the public share page).
      readOnly: options?.readOnly ?? role === 'viewer',
      shareToken: options?.shareToken ?? null,
      saveStatus: 'idle',
      // This load *is* the resolution of a conflict, so the guard restarts
      // from whatever the server just handed back.
      loadedAt: updatedAt ?? null,
      conflict: null,
      // `Diagram.data` is a free-form JSON column: a stored `parentId` may
      // point at a node that is no longer there, and React Flow throws on that
      // rather than drawing the board at all. Normalizing here is the one door
      // every diagram comes through, migration included.
      nodes: normalizeParentage(migrated.nodes as unknown as ShapeNode[]),
      edges: migrated.edges as unknown as ConnectorEdge[],
      // Cleared, not kept: /d/A -> /d/B reuses this store, and B must not open
      // on A's camera.
      viewport: migrated.viewport ?? null,
      // A default belongs to the board it was set on, so this replaces rather
      // than merges — /d/A -> /d/B must not draw B's shapes in A's colours.
      // `migrateDiagramData` has already narrowed it to style keys.
      defaults: (migrated.defaults ?? {}) as BoardDefaults,
      // The session layer goes with it: it is "the colour I last used *here*",
      // and carrying it into another diagram would quietly override that
      // board's own default with a swatch picked on a different board.
      lastStyle: {} as BoardDefaults,
      ...historyFlags(),
    });
  },

  saveDiagram: async (options) => {
    const { diagramId, title, nodes, edges, viewport, defaults, saveStatus, loadedAt, readOnly } = get();
    if (!diagramId || readOnly) return 'skipped';
    const wasFailing = saveStatus === 'error' || saveStatus === 'retrying';
    set({ saveStatus: 'saving' });

    // A collaborative diagram is already being written, continuously, by the
    // socket. There is no body to send and no `ifUnmodifiedSince` to send it
    // with — the conflict this tab used to be refused for is now a merge — so
    // all that is left is to report whether the edit has left the browser. A
    // "no" is a dropped socket, which the autosaver retries like any failure.
    if (flushDocument) {
      const flushed = await flushDocument();
      if (flushed) {
        set({ saveStatus: 'saved', conflict: null });
        return 'saved';
      }
      set({ saveStatus: saveStatus === 'retrying' ? 'retrying' : 'error' });
      return 'error';
    }

    try {
      const result = await api.saveDiagram(
        diagramId,
        {
          // The API rejects a blank title, so a diagram whose name the user
          // cleared would fail every autosave from then on.
          title: title.trim() || 'Untitled',
          data: serializeDiagram(nodes, edges, viewport, defaults),
          // Only sent when this client knows what version it is building on,
          // and never on an overwrite the user asked for.
          ...(loadedAt !== null && !options?.overwrite ? { ifUnmodifiedSince: loadedAt } : {}),
        },
        options,
      );
      set({ saveStatus: 'saved', conflict: null });
      // The row moved, so the guard moves with it. A response that says nothing
      // (an older server) simply leaves the guard where it was.
      if (result?.updatedAt) get().noteSaved(result.updatedAt);
      return 'saved';
    } catch (err) {
      // Neither of these is worth retrying: the same body would be refused the
      // same way until the user reloads, overwrites, or signs back in.
      if (err instanceof ConflictError) {
        set({ saveStatus: 'conflict', conflict: { updatedAt: err.updatedAt } });
        return 'conflict';
      }
      if (err instanceof UnauthorizedError) {
        set({ saveStatus: 'unauthorized' });
        return 'unauthorized';
      }
      // Once the autosaver is retrying, every further failure of that streak
      // keeps saying "retrying" rather than flashing "save failed" per attempt.
      set({ saveStatus: saveStatus === 'retrying' ? 'retrying' : 'error' });
      // A broken connection would otherwise stack one toast per attempt. Only
      // the first failure of a streak is announced; the SaveIndicator carries
      // the state after that.
      if (!wasFailing) toastError('Save failed — retrying');
      return 'error';
    }
  },

  noteSaved: (updatedAt) => {
    const { loadedAt } = get();
    // Monotonic: two writes from this tab can be in flight at once (a diagram
    // save and a thumbnail), and the later response is not always the later
    // write. Both timestamps come from the same server in the same ISO format,
    // so comparing them as strings is comparing them as instants.
    if (loadedAt !== null && updatedAt <= loadedAt) return;
    set({ loadedAt: updatedAt });
  },

  setShareToken: (shareToken) => set({ shareToken }),

  setTitle: (title) => set({ title }),
  setStarred: (starred) => set({ starred }),
  setEditingNodeId: (id) => set({ editingNodeId: id, editingEdgeId: null }),
  setEditingEdgeId: (id) => set({ editingEdgeId: id, editingNodeId: null }),
  requestLinkEditor: () => set((s) => ({ linkEditorRequest: s.linkEditorRequest + 1 })),

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

    // A frame of a drag or of a resize, with the release still to come — the
    // same thing the transient actions below record, and marked the same way so
    // the collaboration binding waits for the gesture to finish.
    const mid = (isDragging || changes.some((c) => c.type === 'dimensions' && c.resizing === true))
      && !dragEnded && !resized;
    const transient = mid ? (s: DiagramState) => ({ transientSeq: s.transientSeq + 1 }) : () => ({});

    if (isDragging) {
      const state = get();
      const posChanges = changes.filter(
        (c): c is NodeChange<ShapeNode> & { type: 'position' } => c.type === 'position' && c.dragging === true,
      );
      const draggedIds = new Set(posChanges.map((c) => c.id));
      // Guides are drawn on the board, so both sides of the comparison are in
      // board coordinates: a node inside a container carries a position that is
      // an offset from it, and lining a shape up against that raw number would
      // snap it to a place nothing is.
      const byId = nodesById(state.nodes);
      const others = state.nodes
        .filter((n) => !draggedIds.has(n.id))
        .map((n) => absoluteBounds(n, byId));

      // Where each dragged node would land before any snapping. The offset the
      // snap produces is a delta, so it applies to the relative position React
      // Flow wants back just as well as to the absolute one it is computed from.
      const dragged = posChanges.flatMap((change) => {
        const node = state.nodes.find((n) => n.id === change.id);
        if (!node) return [];
        const relX = change.position?.x ?? node.position.x;
        const relY = change.position?.y ?? node.position.y;
        const origin = absolutePosition({ ...node, position: { x: 0, y: 0 } }, byId);
        return [{
          change,
          relX,
          relY,
          x: relX + origin.x,
          y: relY + origin.y,
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
          for (const d of dragged) d.change.position = { x: d.relX + dx, y: d.relY + dy };
        }
        set((s) => ({ nodes: applyNodeChanges(changes, s.nodes), guides, ...transient(s) }));
        return;
      }
    }

    if (dragEnded) {
      set((s) => ({ nodes: applyNodeChanges(changes, s.nodes), guides: [] }));
      return;
    }

    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes), ...transient(s) }));
  },

  onEdgesChange: (changes) => {
    const structural = changes.some((c) => c.type === 'add' || c.type === 'remove');
    if (structural) pushHistory(get());
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }));
  },

  onConnect: (connection) => {
    pushHistory(get());
    set((s) => {
      // A connection dragged between two side handles is pinned to those
      // sides, the way a connector drawn by hand is pinned to where it was
      // pressed and released; one that landed on a body handle keeps the
      // automatic side for that end.
      const data: ConnectorData = {
        ...connectorDataWithDefaults(s.defaults, s.lastStyle),
        ...(isSideId(connection.sourceHandle) ? { sourceAnchor: { side: connection.sourceHandle, t: 0.5 } } : {}),
        ...(isSideId(connection.targetHandle) ? { targetAnchor: { side: connection.targetHandle, t: 0.5 } } : {}),
      };
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
    const { defaults, lastStyle } = get();
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
      // Size is deliberately not part of a default (Whimsical's is not either),
      // so the table above is the whole of how big a new shape is.
      data: shapeDataWithDefaults(shape, defaults, lastStyle),
    };
    set((s) => ({ nodes: [...s.nodes, node], editingNodeId: shape === 'text' ? id : null }));
    return id;
  },

  addFrame: (position) => {
    pushHistory(get());
    const id = nanoid(8);
    const node: ShapeNode = {
      id,
      type: 'frame',
      position,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      data: containerData(DEFAULT_FRAME_TITLE),
    };
    // A frame is a section of the board, not something drawn on top of it: it
    // goes to the front of the array so everything already there — and
    // everything dropped into it later — is drawn over it.
    set((s) => ({ nodes: [node, ...s.nodes] }));
    return id;
  },

  groupSelected: () => {
    const state = get();
    const members = outermostSelected(state.nodes);
    if (members.length < 2) return;

    const byId = nodesById(state.nodes);
    const bounds = boundsOf(members.map((n) => absoluteBounds(n, byId)));
    if (!bounds) return;

    // Grouping shapes that already share a container keeps them in it: the
    // group slots in between. A selection spanning two containers cannot, so
    // the group goes to the board itself.
    const sharedParentId = members.every((n) => n.parentId === members[0].parentId)
      ? members[0].parentId
      : undefined;
    const origin =
      sharedParentId !== undefined && byId.has(sharedParentId)
        ? absolutePosition(byId.get(sharedParentId)!, byId)
        : { x: 0, y: 0 };

    const x = bounds.x - GROUP_PADDING;
    const y = bounds.y - GROUP_PADDING;
    const groupId = nanoid(8);
    const group: ShapeNode = {
      id: groupId,
      type: 'group',
      position: { x: x - origin.x, y: y - origin.y },
      width: bounds.w + GROUP_PADDING * 2,
      height: bounds.h + GROUP_PADDING * 2,
      selected: true,
      data: containerData(''),
      ...(sharedParentId !== undefined ? { parentId: sharedParentId } : {}),
    };

    const memberIds = new Set(members.map((n) => n.id));
    // Everything under a member travels with it, and has to stay behind its own
    // parent in the array.
    const moving = subtreeIds(state.nodes, memberIds);
    const rest = state.nodes.filter((n) => !moving.has(n.id));
    const moved = state.nodes
      .filter((n) => moving.has(n.id))
      .map((n) => {
        if (!memberIds.has(n.id)) return { ...n, selected: false };
        const abs = absolutePosition(n, byId);
        return { ...n, parentId: groupId, position: { x: abs.x - x, y: abs.y - y }, selected: false };
      });

    pushHistory(state);
    // The group and its contents go to the end: a group the user has just made
    // is the thing they are working on, and this keeps every parent ahead of
    // its children without having to thread the subtree back into place.
    set({
      nodes: [...rest.map((n) => ({ ...n, selected: false })), group, ...moved],
      edges: state.edges.map((e) => ({ ...e, selected: false })),
    });
  },

  ungroupSelected: () => {
    const state = get();
    const groups = state.nodes.filter((n) => n.selected && isGroupNode(n));
    if (groups.length === 0) return;

    const dissolved = new Map(groups.map((g) => [g.id, g]));
    pushHistory(state);
    set({
      nodes: sortParentsFirst(
        state.nodes
          .filter((n) => !dissolved.has(n.id))
          .map((n) => {
            const parent = n.parentId !== undefined ? dissolved.get(n.parentId) : undefined;
            if (!parent) return n;
            // The child's offset within the group plus the group's own offset
            // is its offset within whatever the group was in — which is exactly
            // its position on the board when the group had no parent.
            return {
              ...n,
              ...(parent.parentId !== undefined ? { parentId: parent.parentId } : { parentId: undefined }),
              position: {
                x: n.position.x + parent.position.x,
                y: n.position.y + parent.position.y,
              },
              // The freed children become the selection, so the ⌘G that made
              // the group and the ⌘⇧G that undoes it leave the same shapes in
              // hand.
              selected: true,
            };
          }),
      ),
    });
  },

  reparentByPosition: (nodeIds) => {
    const state = get();
    const byId = nodesById(state.nodes);
    const dragged = new Set(nodeIds);
    const frames = state.nodes.filter(isFrameNode);

    const moved = state.nodes.filter((node) => {
      if (!dragged.has(node.id)) return false;
      // A child dragged along with its parent has not been dropped anywhere.
      if (node.parentId !== undefined && dragged.has(node.parentId)) return false;
      // A group's membership is explicit; only the group itself can change frame.
      const parent = node.parentId !== undefined ? byId.get(node.parentId) : undefined;
      return !parent || isFrameNode(parent);
    });

    const changes = new Map<string, { parentId: string | undefined; position: { x: number; y: number } }>();
    for (const node of moved) {
      const bounds = absoluteBounds(node, byId);
      // A frame cannot be dropped into itself or into one of its own children.
      const own = subtreeIds(state.nodes, [node.id]);
      const candidates = frames
        .filter((f) => !own.has(f.id))
        .map((f) => ({ ...f, ...absoluteBounds(f, byId) }));
      const target = innermostContaining(bounds, candidates, byId);

      const nextParentId = target?.id;
      if ((node.parentId ?? undefined) === nextParentId) continue;
      const origin = target ? absolutePosition(byId.get(target.id)!, byId) : { x: 0, y: 0 };
      changes.set(node.id, {
        parentId: nextParentId,
        position: { x: bounds.x - origin.x, y: bounds.y - origin.y },
      });
    }
    if (changes.size === 0) return;

    pushHistory(state);
    set({
      nodes: sortParentsFirst(
        state.nodes.map((n) => {
          const change = changes.get(n.id);
          return change ? { ...n, parentId: change.parentId, position: change.position } : n;
        }),
      ),
    });
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

  applyImageBackfill: (patches) => {
    if (patches.length === 0) return;
    const byId = new Map(patches.map((patch) => [patch.id, patch]));
    set((s) => ({
      nodes: s.nodes.map((n) => {
        const patch = byId.get(n.id);
        // Only the source and the shape change: the node keeps the box it was
        // drawn at, so the picture does not move under the user.
        return patch ? { ...n, data: { ...n.data, imageSrc: patch.imageSrc, shape: patch.shape } } : n;
      }),
    }));
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

    const layout: Record<Direction, { position: { x: number; y: number }; sourceHandle: Direction; targetHandle: Direction }> = {
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
      // Quick-add inherits from the shape it grew out of, not from the board's
      // default: the user is extending *this* row of boxes, and a default that
      // overrode the shape they clicked the handle on would be the wrong
      // answer even when the default is the one they set.
      data: { label: '', shape: source.data.shape, fill: source.data.fill, stroke: source.data.stroke },
    };
    // Pinned to the two facing sides: a quick-added shape that is later moved
    // keeps leaving from, and arriving at, the sides it was added across.
    const edgeData: ConnectorData = {
      ...connectorDataWithDefaults(state.defaults, state.lastStyle),
      sourceAnchor: { side: sourceHandle, t: 0.5 },
      targetAnchor: { side: targetHandle, t: 0.5 },
    };
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
      // The colour carries over to the next shape — but only to the next shape
      // of the *kind* it was applied to, and only in this tab. Recolouring a
      // sticky note has never been a statement about rectangles; before board
      // defaults existed there was one shared pair of colours and it was.
      lastStyle: kindsOf(s.nodes.filter((n) => n.selected)).reduce(
        (acc, kind) => withDefault(acc, kind, { ...acc?.[kind], ...pickShapeStyle(patch) }) ?? {},
        s.lastStyle,
      ),
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
      transientSeq: s.transientSeq + 1,
    }));
  },

  // Mid-drag: the one bend under the pointer moves and the rest stay put. The
  // entry the drag is worth was pushed before it started — by `beginInteraction`
  // for a bend that was already there, or by the insert that created one.
  setEdgeWaypointTransient: (id, index, point) => {
    set((s) => ({
      edges: s.edges.map((e) => {
        if (e.id !== id) return e;
        const waypoints = e.data?.waypoints ?? [];
        if (index < 0 || index >= waypoints.length) return e;
        return {
          ...e,
          data: { ...e.data!, waypoints: waypoints.map((w, i) => (i === index ? point : w)) },
        };
      }),
      transientSeq: s.transientSeq + 1,
    }));
  },

  moveNodesTransient: (positions) => {
    set((s) => ({
      nodes: s.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)),
      transientSeq: s.transientSeq + 1,
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
      transientSeq: s.transientSeq + 1,
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
      transientSeq: s.transientSeq + 1,
    }));
  },

  // A bend dragged out of a run of the path takes that run's index, so the
  // list stays in path order however many bends a connector collects. An index
  // past the end appends, which is what an elbow's extra corners can ask for:
  // the router turns one bend into several points on the path.
  insertEdgeWaypoint: (id, index, point) => {
    const edge = get().edges.find((e) => e.id === id);
    if (!edge) return;
    const waypoints = edge.data?.waypoints ?? [];
    const at = Math.max(0, Math.min(index, waypoints.length));
    pushHistory(get());
    set((s) => ({
      edges: s.edges.map((e) =>
        e.id === id
          ? { ...e, data: { ...e.data!, waypoints: [...waypoints.slice(0, at), point, ...waypoints.slice(at)] } }
          : e,
      ),
    }));
  },

  // Double-clicking a bend drops it; the run either side of it becomes one.
  removeEdgeWaypoint: (id, index) => {
    const edge = get().edges.find((e) => e.id === id);
    const waypoints = edge?.data?.waypoints ?? [];
    if (!edge || index < 0 || index >= waypoints.length) return;
    pushHistory(get());
    set((s) => ({
      edges: s.edges.map((e) =>
        e.id === id ? { ...e, data: { ...e.data!, waypoints: waypoints.filter((_, i) => i !== index) } } : e,
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

  // Session only — see `lastStyle`. A colour picked here is remembered for
  // every kind of shape, because the caller (the rail, a swatch with nothing
  // selected) has not said which kind it means; `updateSelectedNodesStyle` is
  // the path that knows, and it is narrower.
  setDefaultStyle: (patch) =>
    set((s) => {
      let lastStyle: BoardDefaults = s.lastStyle;
      const style = pickShapeStyle(patch);
      if (Object.keys(style).length > 0) {
        for (const kind of ['shape', 'sticky', 'text'] as const) {
          lastStyle = withDefault(lastStyle, kind, { ...lastStyle[kind], ...style }) ?? {};
        }
      }
      if (patch.connector) {
        lastStyle =
          withDefault(lastStyle, 'connector', {
            ...lastStyle.connector,
            connectorType: patch.connector,
          }) ?? {};
      }
      return { lastStyle };
    }),

  saveSelectionAsDefault: () => {
    const state = get();
    const nodes = state.nodes.filter((n) => n.selected);
    const edges = state.edges.filter((e) => e.selected);
    // Exactly one thing: "make *this* the default" has no answer for a
    // selection of five shapes in three colours, and the command's `when`
    // withholds it for that reason. Checked here too — the store's actions are
    // total and are called from tests and from a toolbar as well as a keystroke.
    if (nodes.length + edges.length !== 1) return null;

    // No `pushHistory`: for a bound diagram the defaults live in the document's
    // `meta`, which is outside the undo manager's scope, so a boundary here
    // would only split the previous edit in two. The snapshot stacks follow the
    // same rule so both histories say the same thing.
    if (edges.length === 1) {
      const style = pickConnectorStyle(edges[0].data ?? {});
      if (Object.keys(style).length === 0) return null;
      set((s) => ({
        defaults: withDefault(s.defaults, 'connector', style) ?? {},
        // The board has just been told what a connector looks like; this tab's
        // own last-used connector would otherwise go on overriding it.
        lastStyle: withDefault(s.lastStyle, 'connector', undefined) ?? {},
      }));
      return 'connector';
    }

    const node = nodes[0];
    const kind = kindOf(node);
    // A group, a frame and an image have no fill and stroke of their own.
    if (!kind || kind === 'connector') return null;
    const style = pickShapeStyle(node.data);
    if (Object.keys(style).length === 0) return null;
    set((s) => ({
      defaults: withDefault(s.defaults, kind, style) ?? {},
      lastStyle: withDefault(s.lastStyle, kind, undefined) ?? {},
    }));
    return kind;
  },

  newShapeData: (kind) => shapeDataWithDefaults(kind, get().defaults, get().lastStyle),

  newConnectorData: () => connectorDataWithDefaults(get().defaults, get().lastStyle),

  // Node stacking order follows array order (later = drawn on top), so
  // z-ordering is just a matter of reordering `nodes` — and then of putting
  // every parent back ahead of its children, which is the order React Flow has
  // to read them in. `sortParentsFirst` is the identity on a diagram with no
  // containers in it, so an ordinary board reorders exactly as it always did.
  bringToFront: () => {
    pushHistory(get());
    set((s) => {
      const selected = s.nodes.filter((n) => n.selected);
      if (selected.length === 0) return {};
      const rest = s.nodes.filter((n) => !n.selected);
      return { nodes: sortParentsFirst([...rest, ...selected]) };
    });
  },

  sendToBack: () => {
    pushHistory(get());
    set((s) => {
      const selected = s.nodes.filter((n) => n.selected);
      if (selected.length === 0) return {};
      const rest = s.nodes.filter((n) => !n.selected);
      return { nodes: sortParentsFirst([...selected, ...rest]) };
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
      return { nodes: sortParentsFirst(nodes) };
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
      return { nodes: sortParentsFirst(nodes) };
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

  // The same patch, mid-gesture. A slider is a drag like any other: one entry
  // up front from `beginInteraction`, then a frame's worth of change per move,
  // none of which the user would want to undo one at a time.
  updateSelectedNodesDataTransient: (patch) => {
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.selected && n.data.shape !== 'image' ? { ...n, data: { ...n.data, ...patch } } : n,
      ),
      transientSeq: s.transientSeq + 1,
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
    // A container is one thing: copying a group copies what is inside it, so
    // the selection is widened to the whole subtree before anything is cloned.
    const selIds = subtreeIds(state.nodes, state.nodes.filter((n) => n.selected).map((n) => n.id));
    const selNodes = state.nodes.filter((n) => selIds.has(n.id));
    if (selNodes.length === 0) return;
    pushHistory(state);

    const selEdges = state.edges.filter((e) => selIds.has(e.source) && selIds.has(e.target));
    const clones = cloneSubgraph(selNodes, selEdges, offset, select);

    set((s) =>
      select
        ? {
            nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...clones.nodes],
            edges: [...s.edges.map((e) => ({ ...e, selected: false })), ...clones.edges],
          }
        : {
            // Clones go first so they render behind the originals — and then
            // parents back ahead of their own children.
            nodes: sortParentsFirst([...clones.nodes, ...s.nodes]),
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
    set((s) => {
      // A copy carries the container it was taken from, which the *other*
      // diagram it is pasted into does not have. React Flow throws on a parent
      // that is not there, so a clone whose parent did not come with it lands
      // on the board itself; a clipboard pasted back where it came from keeps
      // every parent it had.
      const present = new Set([...s.nodes, ...pasted.nodes].map((n) => n.id));
      const nodes = pasted.nodes.map((n) =>
        n.parentId !== undefined && !present.has(n.parentId) ? { ...n, parentId: undefined } : n,
      );
      return {
        nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...nodes],
        edges: [...s.edges.map((e) => ({ ...e, selected: false })), ...pasted.edges],
      };
    });

    return {
      nodes: pasted.nodes.map((n) => ({ ...n, selected: false })),
      edges: pasted.edges.map((e) => ({ ...e, selected: false })),
    };
  },

  // Deleting a container deletes what is in it: a group or a frame is one
  // thing on the board, and leaving its contents behind — at positions that
  // were relative to a node that no longer exists — is not a state React Flow
  // can draw. A locked shape still sits the delete out, but only in its own
  // right: locking a shape does not pin the group around it open.
  deleteSelection: () => {
    pushHistory(get());
    set((s) => {
      const selected = s.nodes.filter((n) => n.selected && !n.data.locked).map((n) => n.id);
      const deletedNodeIds = subtreeIds(s.nodes, selected);
      return {
        nodes: s.nodes.filter((n) => !deletedNodeIds.has(n.id) && (!n.selected || n.data.locked)),
        edges: s.edges.filter((e) => !e.selected && !deletedNodeIds.has(e.source) && !deletedNodeIds.has(e.target)),
      };
    });
  },

  // Both of these are the *diagram's* undo, not the store's: a bound diagram's
  // history is per person and lives in the document, and the snapshot stacks
  // are what a diagram with no document behind it still uses.
  undo: () => {
    if (documentHistory) {
      documentHistory.undo();
      return;
    }
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
    if (documentHistory) {
      documentHistory.redo();
      return;
    }
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
