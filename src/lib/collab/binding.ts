/**
 * The two-way binding between a diagram's `Y.Doc` and the Zustand store.
 *
 * From phase 2 of `docs/realtime.md` the document is the source of truth for an
 * open diagram, so this module is where an edit becomes something everybody
 * else can see, and where somebody else's edit becomes something on this
 * canvas. The server renders `Diagram.data` from the same document
 * (`server/collab/render.ts`), which is why nothing here writes JSON.
 *
 * **store → doc is a diff, not a hook per action.** Every mutating action ends
 * in one synchronous `set`, so one subscription sees exactly one change per
 * action and writes exactly one `doc.transact` — which is the "one transaction
 * per action" the design asks for, without twenty-five call sites that a
 * twenty-sixth action would be quietly left out of. What is compared is the
 * *serialized* form: a selection change, a measured size or a re-rendered array
 * that leaves the saved diagram identical writes nothing at all, where a
 * per-action hook would have had to know which actions those were.
 *
 * **doc → store rebuilds the arrays** and merges each node's local-only fields
 * (what is selected, what React Flow has measured) back over it, because none
 * of that belongs to anybody but the browser it is in. It goes in through
 * `setState` rather than an action, so a collaborator's edit never lands in
 * this client's undo history — the phase-3 `Y.UndoManager` is what will make
 * undo per-person; until then, undoing your way past somebody else's change is
 * the known limitation phase 2 ships with.
 *
 * **Gestures are committed, not streamed.** A drag, a slider and a text shape
 * growing under the keyboard all report per frame; those states are marked
 * transient by the store (`transientSeq`) and held here until the gesture stops
 * moving, so one shape being dragged across the board is one update rather than
 * sixty a second. Held, not dropped: not every gesture ends in a commit of its
 * own (a text shape's height never does), so the trailing flush is what
 * guarantees the last frame is the one that gets written.
 */
import * as Y from 'yjs';
import type { DiagramData, SerializedEdge, SerializedNode } from '../../../shared/types';
import {
  docMeta,
  edgeEntries,
  edgesOf,
  isSeeded,
  nodeEntries,
  nodesOf,
  VIEWPORT_KEY,
  writeDiagramIntoDoc,
  type DocEntry,
} from '../../../shared/collabDoc';
import type { ConnectorEdge, DiagramState, ShapeNode } from '../../store/useDiagramStore';
import { serializeDiagram } from '../../store/useDiagramStore';
import { normalizeParentage } from '../nodeTree';

/**
 * How long a gesture has to stop moving before it is written to the document.
 *
 * Short enough that a collaborator sees a dropped shape land rather than
 * wondering whether it arrived, long enough that a drag is one update. It is
 * not a save: the edit is already in this browser's store either way.
 */
export const TRANSIENT_COMMIT_MS = 150;

/** The slice of the store this module reads and writes. */
export interface BindableStore {
  getState: () => DiagramState;
  setState: (partial: Partial<DiagramState>) => void;
  subscribe: (listener: (state: DiagramState, previous: DiagramState) => void) => () => void;
}

export interface BindDocOptions {
  /**
   * A viewer's binding is one-way: the document is rendered onto their canvas
   * and nothing on their canvas is written back. The server refuses their
   * writes anyway (`connectionConfig.readOnly`), so this is about not asking.
   */
  readOnly?: boolean;
  /**
   * The diagram as it was loaded, before the socket was open.
   *
   * The board is interactive from the moment the JSON arrives over HTTP, and
   * the document lands a beat later — so anything drawn in between exists only
   * in this browser. Replacing the canvas with the document would throw it
   * away, and pushing the whole canvas over the document would undo whatever a
   * collaborator did in the same beat. The baseline is what tells those two
   * apart: an element that differs from it was edited here and is written to
   * the document; an element that matches it is the document's business.
   */
  baseline?: DiagramData;
}

export interface DocBinding {
  /** Writes any gesture still in hand and stops listening in both directions. */
  destroy: () => void;
}

/** True when two serializable values are the same diagram element. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The element as it goes into the document.
 *
 * `serializeNodes` writes `width` and `height` whether or not the node has
 * them, and Yjs will happily store an explicit `undefined` that JSON has no way
 * of expressing — which would make an element that came back from the document
 * differ from the identical one this client just serialized, and every diff
 * after that a write. Round-tripping through JSON is both the normalization and
 * the deep copy the map needs.
 */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Write `elements` into `map`, touching only the entries that really changed. */
function syncElements<T extends { id: string }>(map: Y.Map<DocEntry<T>>, elements: T[]): boolean {
  let changed = false;
  const kept = new Set<string>();

  elements.forEach((element, order) => {
    kept.add(element.id);
    const current = map.get(element.id);
    // The order is part of the entry: a z-order command rewrites the entries it
    // moved past each other, and nothing else.
    if (current && current.order === order && same(current.value, element)) return;
    map.set(element.id, { order, value: plain(element) });
    changed = true;
  });

  for (const id of [...map.keys()]) {
    if (kept.has(id)) continue;
    map.delete(id);
    changed = true;
  }
  return changed;
}

/**
 * Push the store's diagram into the document, as one transaction.
 *
 * Nothing is written when nothing differs — an action that changed only the
 * selection, or one that a peer's identical edit has already landed, must not
 * put an empty update on the wire.
 */
export function pushDiagramToDoc(doc: Y.Doc, data: DiagramData, origin: unknown): boolean {
  let changed = false;
  doc.transact(() => {
    changed = syncElements(nodeEntries(doc), data.nodes) || changed;
    changed = syncElements(edgeEntries(doc), data.edges) || changed;

    // The camera is this client's, and is written for the snapshot's sake
    // alone: it is what a diagram reopens at. Nothing reads it back off the
    // document — a peer scrolling their own window must not move yours.
    const meta = docMeta(doc);
    if (data.viewport && !same(meta.get(VIEWPORT_KEY), data.viewport)) {
      meta.set(VIEWPORT_KEY, plain(data.viewport));
      changed = true;
    }
  }, origin);
  return changed;
}

/**
 * Write the edits made between `baseline` and `current` into the document,
 * leaving everything else to it.
 *
 * The three cases, per element: changed or added here since the load, so it is
 * written; gone here since the load, so it is deleted; untouched here, so
 * whatever the document holds — a collaborator's newer version of it, very
 * possibly — is left exactly as it is.
 *
 * The array index counts as part of the element: a `bringToFront` moves a shape
 * without changing a byte of it, and reading only the values would lose that.
 */
export function applyLocalEditsSince(
  doc: Y.Doc,
  baseline: DiagramData,
  current: DiagramData,
  origin: unknown,
): void {
  doc.transact(() => {
    mergeSince(nodeEntries(doc), baseline.nodes, current.nodes);
    mergeSince(edgeEntries(doc), baseline.edges, current.edges);
  }, origin);
}

function mergeSince<T extends { id: string }>(
  map: Y.Map<DocEntry<T>>,
  before: T[],
  after: T[],
): void {
  const wasValue = new Map(before.map((element) => [element.id, element]));
  const wasOrder = new Map(before.map((element, order) => [element.id, order]));

  after.forEach((element, order) => {
    const was = wasValue.get(element.id);
    if (was && wasOrder.get(element.id) === order && same(was, element)) return;
    map.set(element.id, { order, value: plain(element) });
  });

  const present = new Set(after.map((element) => element.id));
  for (const element of before) {
    if (!present.has(element.id)) map.delete(element.id);
  }
}

/**
 * The document's nodes as store nodes, with this browser's own state kept.
 *
 * Selection, what React Flow measured and whether a node is mid-drag are all
 * local: they are not in the saved diagram and they are not somebody else's
 * business. `normalizeParentage` runs for the same reason it runs in
 * `loadDiagram` — a `parentId` pointing at a node a collaborator has just
 * deleted makes React Flow throw instead of drawing the board.
 */
export function docNodesOntoStore(
  serialized: SerializedNode[],
  existing: readonly ShapeNode[],
): ShapeNode[] {
  const byId = new Map(existing.map((node) => [node.id, node]));
  return normalizeParentage(
    serialized.map((node) => {
      const previous = byId.get(node.id);
      const next = { ...node } as unknown as ShapeNode;
      if (!previous) return next;
      return {
        ...next,
        selected: previous.selected,
        ...(previous.measured !== undefined && { measured: previous.measured }),
        ...(previous.dragging !== undefined && { dragging: previous.dragging }),
      };
    }),
  );
}

/** The edge counterpart. Only the selection is local. */
export function docEdgesOntoStore(
  serialized: SerializedEdge[],
  existing: readonly ConnectorEdge[],
): ConnectorEdge[] {
  const byId = new Map(existing.map((edge) => [edge.id, edge]));
  return serialized.map((edge) => {
    const next = { ...edge } as unknown as ConnectorEdge;
    const previous = byId.get(edge.id);
    return previous ? { ...next, selected: previous.selected } : next;
  });
}

/** The store's diagram, in the form the document holds it. */
function diagramOf(state: DiagramState): DiagramData {
  return serializeDiagram(state.nodes, state.edges, state.viewport);
}

/**
 * Bind `doc` and `store` together for as long as a diagram is open.
 *
 * Call it once the provider reports `synced`: the document is the source of
 * truth, and the store was filled from the JSON snapshot, which is the
 * document's *output* and may be a couple of seconds behind it.
 *
 * "Source of truth" is not quite "replace the canvas", though, because the
 * board is interactive while the socket is opening — so anything drawn in that
 * window would be thrown away. `options.baseline` (the diagram as the page
 * loaded it) is what separates the two: what differs from it was done here and
 * is written to the document; what matches it is left to the document, so a
 * collaborator's newer version of an untouched shape survives. Without a
 * baseline the document simply wins.
 *
 * A document that has never been written is the other way round. The server
 * seeds one from `Diagram.data` on the first collaborative open, so this only
 * happens when that could not run at all; writing the loaded board in is better
 * than emptying the canvas in front of the user.
 */
export function bindDocToStore(
  doc: Y.Doc,
  store: BindableStore,
  origin: unknown,
  options: BindDocOptions = {},
): DocBinding {
  const readOnly = options.readOnly ?? false;
  /** Set while `pull` is writing, so its own `setState` is not pushed back. */
  let applyingRemote = false;
  /** A gesture whose last frame has not been written yet. */
  let transientTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  /**
   * The diagram the store is known to be holding, as JSON.
   *
   * A remote transaction is not necessarily a remote *edit* — a peer's viewport
   * lands in the same document, and so does an update that says only what this
   * client already had. Rebuilding every node object for one of those would
   * re-render the whole canvas, and would blur a label somebody is in the
   * middle of typing into.
   */
  let rendered: string | null = null;

  const contentOf = (data: DiagramData) => JSON.stringify([data.nodes, data.edges]);

  const pull = () => {
    const nodes = nodesOf(doc);
    const edges = edgesOf(doc);
    const next = JSON.stringify([nodes, edges]);
    if (next === rendered) return;
    rendered = next;

    const state = store.getState();
    applyingRemote = true;
    try {
      // The viewport is deliberately not read back — see `pushDiagramToDoc`.
      store.setState({
        nodes: docNodesOntoStore(nodes, state.nodes),
        edges: docEdgesOntoStore(edges, state.edges),
      });
    } finally {
      applyingRemote = false;
    }
  };

  const push = (state: DiagramState) => {
    if (readOnly) return;
    const data = diagramOf(state);
    pushDiagramToDoc(doc, data, origin);
    rendered = contentOf(data);
  };

  const cancelTransient = () => {
    if (transientTimer === null) return;
    clearTimeout(transientTimer);
    transientTimer = null;
  };

  const local = diagramOf(store.getState());
  if (!isSeeded(doc)) {
    // Nothing has ever been written here — the server seeds a document on the
    // first collaborative open, so this is a document that could not be seeded
    // at all. Emptying the canvas in front of the user is the wrong answer, so
    // the loaded board is written in as the seed instead.
    if (!readOnly) {
      writeDiagramIntoDoc(doc, local, origin);
      rendered = contentOf(local);
    }
  } else {
    // Anything drawn between the page load and this moment is a local edit, and
    // has to reach the document before the document is rendered over it.
    if (!readOnly && options.baseline) {
      applyLocalEditsSince(doc, options.baseline, local, origin);
    }
    // Seeded with what the store already holds, so a document that agrees with
    // the canvas costs no re-render at all.
    rendered = contentOf(local);
    pull();
  }

  // ---- doc -> store --------------------------------------------------------
  // The three observers all fire inside one transaction, so they only mark the
  // store dirty; `afterTransaction` is what rebuilds it, once.
  let dirty = false;
  const markDirty = (_event: unknown, transaction: Y.Transaction) => {
    // Our own write, already in the store — reading it back would be a round
    // trip that replaces every node object for nothing.
    if (transaction.origin === origin) return;
    dirty = true;
  };
  const flush = () => {
    if (!dirty) return;
    dirty = false;
    pull();
  };

  const nodes = nodeEntries(doc);
  const edges = edgeEntries(doc);
  const meta = docMeta(doc);
  nodes.observe(markDirty);
  edges.observe(markDirty);
  meta.observe(markDirty);
  doc.on('afterTransaction', flush);

  // ---- store -> doc --------------------------------------------------------
  const unsubscribe = store.subscribe((state, previous) => {
    if (applyingRemote) return;
    // Nothing that is saved with the diagram moved. A selection, a hovered
    // handle, a save status: not this module's business.
    if (
      state.nodes === previous.nodes &&
      state.edges === previous.edges &&
      state.viewport === previous.viewport
    ) {
      return;
    }

    cancelTransient();
    if (state.transientSeq !== previous.transientSeq) {
      // Mid-gesture. Hold it: the commit that ends the gesture will push, and
      // the timer catches the gestures that have no commit of their own.
      transientTimer = setTimeout(() => {
        transientTimer = null;
        if (!destroyed) push(store.getState());
      }, TRANSIENT_COMMIT_MS);
      return;
    }
    push(state);
  });

  return {
    destroy: () => {
      destroyed = true;
      const hadGesture = transientTimer !== null;
      cancelTransient();
      // A diagram closed mid-drag still has that drag: the store already holds
      // it, and leaving it out of the document would be the one way this
      // binding could lose an edit.
      if (hadGesture) push(store.getState());
      unsubscribe();
      nodes.unobserve(markDirty);
      edges.unobserve(markDirty);
      meta.unobserve(markDirty);
      doc.off('afterTransaction', flush);
    },
  };
}
