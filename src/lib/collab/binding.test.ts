/**
 * The store ↔ document binding: that an edit made here arrives there, that an
 * edit made there arrives here without becoming something to undo, and that two
 * people editing at once end up with the same board.
 *
 * The renderer is imported from the server on purpose: what the server will
 * write to `Diagram.data` has to equal what `serializeDiagram` would have
 * written, and asserting that against the real function is the only way to know
 * the snapshot has not drifted from the document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { docToDiagramData } from '../../../server/collab/render';
import { edgeEntries, nodeEntries } from '../../../shared/collabDoc';
import { serializeDiagram, useDiagramStore } from '../../store/useDiagramStore';
import { bindDocToStore, pushDiagramToDoc, TRANSIENT_COMMIT_MS, type DocBinding } from './binding';

const store = () => useDiagramStore.getState();

/** The origin this "client" writes with — what keeps it from reading itself back. */
const LOCAL = Symbol('local');

let binding: DocBinding | null = null;

function bind(doc: Y.Doc, options: { readOnly?: boolean } = {}) {
  binding = bindDocToStore(doc, useDiagramStore, LOCAL, options);
  return binding;
}

/** The diagram exactly as an autosave would have written it. */
function snapshot() {
  const { nodes, edges, viewport } = store();
  return serializeDiagram(nodes, edges, viewport);
}

/** Select exactly these node ids, the way the canvas does. */
function select(...ids: string[]) {
  const wanted = new Set(ids);
  useDiagramStore.setState((s) => ({
    nodes: s.nodes.map((n) => ({ ...n, selected: wanted.has(n.id) })),
  }));
}

beforeEach(() => {
  // The only public way to reset the module-level undo history.
  store().loadDiagram('test', 'Test', false, { nodes: [], edges: [] });
});

afterEach(() => {
  binding?.destroy();
  binding = null;
  vi.useRealTimers();
});

describe('store -> doc', () => {
  it('renders a document that is exactly what the JSON save would have been', () => {
    const doc = new Y.Doc();
    bind(doc);

    // A run of ordinary actions, each of which ends in one `set`.
    const a = store().addShape('rectangle', { x: 10, y: 20 });
    const b = store().addShape('ellipse', { x: 300, y: 40 });
    store().onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null });
    store().updateNodeData(a, { label: 'First' });
    select(b);
    store().updateSelectedNodesData({ bold: true });
    store().duplicateSelection();
    store().setViewport({ x: -12, y: 8, zoom: 1.25 });

    expect(docToDiagramData(doc)).toEqual(snapshot());
  });

  it('keeps z-order, which a Y.Map has no way of expressing on its own', () => {
    const doc = new Y.Doc();
    bind(doc);
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addShape('rectangle', { x: 50, y: 0 });
    expect(docToDiagramData(doc).nodes.map((n) => n.id)).toEqual([a, b]);

    select(a);
    store().bringToFront();
    expect(docToDiagramData(doc).nodes.map((n) => n.id)).toEqual([b, a]);
    expect(docToDiagramData(doc)).toEqual(snapshot());
  });

  it('deletes the entries an edit removed rather than leaving them behind', () => {
    const doc = new Y.Doc();
    bind(doc);
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addShape('rectangle', { x: 50, y: 0 });
    select(a);
    store().deleteSelection();

    expect(nodeEntries(doc).size).toBe(1);
    expect(nodeEntries(doc).has(a)).toBe(false);
    expect(docToDiagramData(doc)).toEqual(snapshot());
  });

  it('writes one transaction per action, and none for a change that is not an edit', () => {
    const doc = new Y.Doc();
    bind(doc);
    let updates = 0;
    doc.on('update', () => { updates += 1; });

    store().addShape('rectangle', { x: 0, y: 0 });
    expect(updates).toBe(1);

    // Selecting is not an edit: it is not in the saved diagram, and a peer's
    // canvas must not be rebuilt because somebody clicked a shape.
    select();
    expect(updates).toBe(1);

    // Neither is a no-op patch, which the store refuses in the first place.
    store().updateNodeData(store().nodes[0].id, { label: '' });
    expect(updates).toBe(1);
  });

  it('holds a gesture until it stops moving, then writes it once', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    bind(doc);
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    let updates = 0;
    doc.on('update', () => { updates += 1; });

    store().beginInteraction();
    for (let x = 10; x <= 100; x += 10) store().moveNodesTransient({ [id]: { x, y: 0 } });
    // Nothing on the wire yet: this is one shape being dragged, not ten edits.
    expect(updates).toBe(0);
    expect(docToDiagramData(doc).nodes[0].position).toEqual({ x: 0, y: 0 });

    vi.advanceTimersByTime(TRANSIENT_COMMIT_MS);
    expect(updates).toBe(1);
    expect(docToDiagramData(doc).nodes[0].position).toEqual({ x: 100, y: 0 });
    expect(docToDiagramData(doc)).toEqual(snapshot());
  });

  it('writes a gesture the moment a real action commits it', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    bind(doc);
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    select(id);

    store().beginInteraction();
    store().updateSelectedNodesDataTransient({ opacity: 0.5 });
    store().updateSelectedNodesData({ opacity: 0.4 });

    // The commit is not transient, so it goes at once rather than waiting out
    // the trailing flush.
    expect(docToDiagramData(doc).nodes[0].data).toMatchObject({ opacity: 0.4 });
  });

  it('writes a gesture still in hand when the diagram is closed', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    bind(doc);
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    store().moveNodesTransient({ [id]: { x: 77, y: 0 } });

    binding!.destroy();
    binding = null;
    expect(docToDiagramData(doc).nodes[0].position).toEqual({ x: 77, y: 0 });
  });

  it('replaces the document when a version is restored onto the open diagram', () => {
    const doc = new Y.Doc();
    bind(doc);
    store().addShape('rectangle', { x: 0, y: 0 });
    store().addShape('ellipse', { x: 200, y: 0 });

    let updates = 0;
    doc.on('update', () => { updates += 1; });

    // What `HistoryPanel` does with the restore response: the same
    // `loadDiagram` every open goes through, which the binding sees as one edit.
    store().loadDiagram('test', 'Restored', false, {
      version: 3,
      nodes: [{ id: 'old', type: 'shape', position: { x: 9, y: 9 }, data: { label: 'Old' } }],
      edges: [],
    });

    expect(updates).toBe(1);
    expect(docToDiagramData(doc).nodes.map((n) => n.id)).toEqual(['old']);
    expect(docToDiagramData(doc)).toEqual(snapshot());
  });

  it('writes nothing at all for a viewer', () => {
    const doc = new Y.Doc();
    bind(doc, { readOnly: true });
    store().addShape('rectangle', { x: 0, y: 0 });
    expect(nodeEntries(doc).size).toBe(0);
  });
});

describe('doc -> store', () => {
  it('renders a collaborator’s edit onto the canvas', () => {
    const doc = new Y.Doc();
    bind(doc);
    const mine = store().addShape('rectangle', { x: 0, y: 0 });

    // A second client, merged in the way the server would deliver it.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    pushDiagramToDoc(
      peer,
      {
        ...docToDiagramData(peer),
        nodes: [
          ...docToDiagramData(peer).nodes,
          {
            id: 'theirs',
            type: 'shape',
            position: { x: 400, y: 0 },
            width: 100,
            height: 80,
            data: { label: 'Theirs', shape: 'ellipse', fill: '#fff', stroke: '#000' },
          },
        ],
      },
      'peer',
    );
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));

    expect(store().nodes.map((n) => n.id)).toEqual([mine, 'theirs']);
    expect(store().nodes[1].data.label).toBe('Theirs');
  });

  it('does not put a collaborator’s edit in this client’s undo history', () => {
    const doc = new Y.Doc();
    bind(doc);
    // A fresh load leaves nothing to undo; a remote edit must not change that.
    expect(store().canUndo).toBe(false);

    const peer = new Y.Doc();
    pushDiagramToDoc(
      peer,
      {
        version: 3,
        nodes: [
          {
            id: 'theirs',
            type: 'shape',
            position: { x: 0, y: 0 },
            width: 10,
            height: 10,
            data: {},
          },
        ],
        edges: [],
      },
      'peer',
    );
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));

    expect(store().nodes).toHaveLength(1);
    expect(store().canUndo).toBe(false);
  });

  it('keeps what is selected here when the document changes elsewhere', () => {
    const doc = new Y.Doc();
    bind(doc);
    const mine = store().addShape('rectangle', { x: 0, y: 0 });
    select(mine);

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const data = docToDiagramData(peer);
    pushDiagramToDoc(
      peer,
      { ...data, nodes: [{ ...data.nodes[0], position: { x: 99, y: 99 } }] },
      'peer',
    );
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));

    expect(store().nodes[0].position).toEqual({ x: 99, y: 99 });
    expect(store().nodes[0].selected).toBe(true);
  });

  it('does not write back what it has just read', () => {
    const doc = new Y.Doc();
    bind(doc);
    store().addShape('rectangle', { x: 0, y: 0 });

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const data = docToDiagramData(peer);
    pushDiagramToDoc(peer, { ...data, nodes: [{ ...data.nodes[0], width: 222 }] }, 'peer');

    let updates = 0;
    doc.on('update', () => { updates += 1; });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));

    // One update: the peer's, applied. Reading it into the store must not send
    // anything back, or two clients would talk past each other for ever.
    expect(updates).toBe(1);
  });

  it('takes the document as the source of truth when the binding is made', () => {
    // What the JSON snapshot loaded — a second or two behind the document.
    store().loadDiagram('test', 'Test', false, {
      nodes: [{ id: 'stale', type: 'shape', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });

    const doc = new Y.Doc();
    pushDiagramToDoc(
      doc,
      {
        version: 3,
        nodes: [{ id: 'fresh', type: 'shape', position: { x: 1, y: 1 }, data: {} }],
        edges: [],
      },
      'peer',
    );
    // Seeded by the server on the first collaborative open.
    doc.getMap('meta').set('seeded', true);

    bind(doc);
    expect(store().nodes.map((n) => n.id)).toEqual(['fresh']);
  });

  it('pushes the loaded board into a document nothing has ever written', () => {
    store().loadDiagram('test', 'Test', false, {
      nodes: [{ id: 'loaded', type: 'shape', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
    const doc = new Y.Doc();
    bind(doc);

    // Emptying the canvas would be the wrong answer to a document that could
    // not be seeded.
    expect(store().nodes.map((n) => n.id)).toEqual(['loaded']);
    expect(docToDiagramData(doc).nodes.map((n) => n.id)).toEqual(['loaded']);
  });
});

describe('merging', () => {
  /** Two documents that have seen each other, as two open browsers have. */
  function twoClients() {
    const a = new Y.Doc();
    pushDiagramToDoc(
      a,
      {
        version: 3,
        nodes: [
          { id: 'n1', type: 'shape', position: { x: 0, y: 0 }, data: { label: 'one' } },
          { id: 'n2', type: 'shape', position: { x: 100, y: 0 }, data: { label: 'two' } },
        ],
        edges: [],
      },
      'seed',
    );
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    return { a, b };
  }

  /** Exchange every update both ways, as the server fans them out. */
  function converge(a: Y.Doc, b: Y.Doc) {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  }

  it('merges two people editing different shapes, and both end up equal', () => {
    const { a, b } = twoClients();

    const fromA = docToDiagramData(a);
    pushDiagramToDoc(
      a,
      { ...fromA, nodes: [{ ...fromA.nodes[0], position: { x: 5, y: 5 } }, fromA.nodes[1]] },
      'a',
    );

    const fromB = docToDiagramData(b);
    pushDiagramToDoc(
      b,
      { ...fromB, nodes: [fromB.nodes[0], { ...fromB.nodes[1], position: { x: 200, y: 50 } }] },
      'b',
    );

    converge(a, b);

    const merged = docToDiagramData(a);
    expect(merged).toEqual(docToDiagramData(b));
    expect(merged.nodes[0].position).toEqual({ x: 5, y: 5 });
    expect(merged.nodes[1].position).toEqual({ x: 200, y: 50 });
  });

  it('lets the last writer win on the same shape, and agrees which that was', () => {
    const { a, b } = twoClients();

    const fromA = docToDiagramData(a);
    pushDiagramToDoc(a, { ...fromA, nodes: [{ ...fromA.nodes[0], data: { label: 'A' } }, fromA.nodes[1]] }, 'a');
    const fromB = docToDiagramData(b);
    pushDiagramToDoc(b, { ...fromB, nodes: [{ ...fromB.nodes[0], data: { label: 'B' } }, fromB.nodes[1]] }, 'b');

    converge(a, b);

    // Which of the two wins is Yjs's business (the higher client id); that both
    // windows draw the *same* board is this app's.
    expect(docToDiagramData(a)).toEqual(docToDiagramData(b));
    expect(['A', 'B']).toContain(docToDiagramData(a).nodes[0].data.label);
  });

  it('keeps a shape one person deleted deleted, however the updates arrive', () => {
    const { a, b } = twoClients();

    const fromA = docToDiagramData(a);
    pushDiagramToDoc(a, { ...fromA, nodes: [fromA.nodes[1]] }, 'a');

    const fromB = docToDiagramData(b);
    pushDiagramToDoc(b, { ...fromB, nodes: [fromB.nodes[0], { ...fromB.nodes[1], data: { label: 'edited' } }] }, 'b');

    converge(a, b);

    expect(docToDiagramData(a)).toEqual(docToDiagramData(b));
    expect(docToDiagramData(a).nodes.map((n) => n.id)).toEqual(['n2']);
    expect(edgeEntries(a).size).toBe(0);
  });
});
