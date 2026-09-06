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
 * this client's undo history.
 *
 * **Undo is the `Y.UndoManager` below, scoped to this client's origin.** ⌘Z
 * takes back what *you* did — on every window, since undoing an edit is itself
 * an edit — and can never reach a collaborator's work, which is what the
 * snapshot stack it replaces could not promise. Where one entry ends and the
 * next begins is still decided by the store, not by a clock: see
 * `DocumentHistory.beginEntry`.
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
import type { ConnectorEdge, DiagramState, DocumentHistory, ShapeNode } from '../../store/useDiagramStore';
import { hasDocumentHistory, serializeDiagram } from '../../store/useDiagramStore';
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
  /**
   * Called when the answer to "is anything still only in this browser?"
   * changes: `true` while a gesture is being held for the trailing flush,
   * `false` once it has been written.
   *
   * "Everything I did is on the server" is not the provider's answer alone: for
   * the 150 ms a gesture is held here it has not been offered to the provider
   * at all, and an indicator that said otherwise would be claiming a drag was
   * safe before it had left this module.
   */
  onPendingWrite?: (pending: boolean) => void;
}

export interface DocBinding {
  /** Writes any gesture still in hand and stops listening in both directions. */
  destroy: () => void;
  /**
   * This browser's undo history in the document — what `useDiagramStore`'s
   * `undo` / `redo` dispatch to while the diagram is bound.
   *
   * Empty for a viewer, whose binding writes nothing there is to take back.
   */
  history: DocumentHistory;
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

  /** Whether a gesture is being held here, reported only when it changes. */
  let pendingWrite = false;
  const setPendingWrite = (next: boolean) => {
    if (pendingWrite === next) return;
    pendingWrite = next;
    options.onPendingWrite?.(next);
  };

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
    // Offered to the provider: from here whether it has arrived is its answer.
    setPendingWrite(false);
  };

  const cancelTransient = () => {
    if (transientTimer === null) return;
    clearTimeout(transientTimer);
    transientTimer = null;
  };

  const nodeMap = nodeEntries(doc);
  const edgeMap = edgeEntries(doc);
  const metaMap = docMeta(doc);

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

  // ---- undo ----------------------------------------------------------------
  /**
   * This browser's edits, and only this browser's: `trackedOrigins` is the one
   * origin every local transaction carries, so a collaborator's work is not on
   * the stack and ⌘Z cannot reach it.
   *
   * Built *after* the seed and the baseline merge above, which are written with
   * the same origin: neither is an edit the user made in front of the document,
   * and an undo that emptied the canvas back to a document that was never there
   * would be the worst first impression this feature could make.
   *
   * `meta` is deliberately out of scope. The viewport lives there, is written
   * for the snapshot's sake and is never read back out, so tracking it would
   * hand the user an undo entry for panning that changes nothing they can see.
   */
  const undoManager = new Y.UndoManager([nodeMap, edgeMap], {
    trackedOrigins: new Set([origin]),
    // Never split an entry on a clock. Where one undo step ends is decided by
    // the store — every `pushHistory` call site, plus the start of a gesture —
    // and `beginEntry` below is the only thing that opens a new one. A timeout
    // would additionally split a drag the user paused in the middle of, and
    // would coalesce two arrow-key nudges 200 ms apart differently from the
    // 500 ms window `nudgeSelected` has always used.
    captureTimeout: Number.POSITIVE_INFINITY,
  });

  /**
   * True between the first frame of a gesture and the write that commits it.
   *
   * A drag is one undo step, and the store says so twice: once when the gesture
   * starts (the first transient frame) and again when it ends (`onNodesChange`
   * pushes history on the release). Honouring the second would split the
   * release off from the movement, so a boundary asked for while a gesture is
   * open is dropped — the gesture already opened one.
   */
  let gestureOpen = false;

  const syncFlags = () => {
    // Only when this history is the one the store is dispatching to. A viewer's
    // binding registers none (there is nothing of theirs to take back), and a
    // stack that nothing can pop must not be what greys the toolbar's buttons.
    if (!hasDocumentHistory()) return;
    store.setState({
      canUndo: undoManager.undoStack.length > 0,
      canRedo: undoManager.redoStack.length > 0,
    });
  };

  /**
   * The element ids the undo or redo now running has changed.
   *
   * Filled by the observers below while the transaction is open — a `YEvent`'s
   * changes cannot be read once the handler that carried it has returned, and
   * `stack-item-popped` fires after the transaction is closed — and read by
   * that handler to decide what to select.
   */
  const touched = new Set<string>();

  /**
   * Put the selection on what the undo just changed, as far as it still exists.
   *
   * Selection is not in the document — it is this browser's alone — so without
   * this an undo would put a shape back somewhere off screen with nothing at
   * all to say where it went.
   */
  const selectTouched = (ids: ReadonlySet<string>) => {
    if (ids.size === 0) return;
    const state = store.getState();
    const nodes = state.nodes.map((node) =>
      node.selected === ids.has(node.id) ? node : { ...node, selected: ids.has(node.id) },
    );
    const edges = state.edges.map((edge) =>
      edge.selected === ids.has(edge.id) ? edge : { ...edge, selected: ids.has(edge.id) },
    );
    if (nodes.every((node, i) => node === state.nodes[i]) && edges.every((edge, i) => edge === state.edges[i])) {
      return;
    }
    // Not an edit: what is selected is not in the document, and pushing it back
    // would be a transaction that writes nothing.
    applyingRemote = true;
    try {
      store.setState({ nodes, edges });
    } finally {
      applyingRemote = false;
    }
  };

  undoManager.on('stack-item-added', syncFlags);
  undoManager.on('stack-cleared', syncFlags);
  undoManager.on('stack-item-popped', () => {
    syncFlags();
    // Emitted after the transaction has closed, so the canvas already shows the
    // result and `touched` holds exactly what moved.
    selectTouched(touched);
  });
  syncFlags();

  /** Run `step` with `touched` holding only what that step changes. */
  const tracked = (step: () => void) => {
    touched.clear();
    step();
    touched.clear();
  };

  const history: DocumentHistory = {
    undo: () => tracked(() => undoManager.undo()),
    redo: () => tracked(() => undoManager.redo()),
    beginEntry: () => {
      if (gestureOpen) return;
      undoManager.stopCapturing();
    },
    clear: () => {
      undoManager.clear();
      gestureOpen = false;
      syncFlags();
    },
  };

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

  /**
   * `markDirty`, and a note of which elements moved.
   *
   * The keys have to be read here, inside the handler Yjs called: a `YEvent`
   * refuses to describe its changes once its transaction has been cleaned up,
   * and `stack-item-popped` — the one place that wants them — fires after that.
   */
  function markDirtyElements<T>(event: Y.YMapEvent<T>, transaction: Y.Transaction): void {
    markDirty(event, transaction);
    for (const key of event.keys.keys()) touched.add(key);
  }

  nodeMap.observe(markDirtyElements);
  edgeMap.observe(markDirtyElements);
  metaMap.observe(markDirty);
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
      // The first frame of a gesture is where its undo entry starts. The store
      // cannot say so itself — a drag pushes history on the *release* — and
      // without it a drag the user paused in the middle of would have its first
      // half folded into whatever they did before picking the shape up.
      if (!gestureOpen) {
        undoManager.stopCapturing();
        gestureOpen = true;
      }
      // Mid-gesture. Hold it: the commit that ends the gesture will push, and
      // the timer catches the gestures that have no commit of their own. It is
      // in this browser and nowhere else until one of those happens.
      setPendingWrite(true);
      transientTimer = setTimeout(() => {
        transientTimer = null;
        if (!destroyed) push(store.getState());
      }, TRANSIENT_COMMIT_MS);
      return;
    }
    gestureOpen = false;
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
      nodeMap.unobserve(markDirtyElements);
      edgeMap.unobserve(markDirtyElements);
      metaMap.unobserve(markDirty);
      doc.off('afterTransaction', flush);
      undoManager.destroy();
    },
    history,
  };
}
