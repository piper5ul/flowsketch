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
import { edgeEntries, nodeEntries, writeDiagramIntoDoc } from '../../../shared/collabDoc';
import {
  serializeDiagram,
  setDocumentFlush,
  setDocumentHistory,
  useDiagramStore,
} from '../../store/useDiagramStore';
import { api } from '../api';
import { bindDocToStore, pushDiagramToDoc, TRANSIENT_COMMIT_MS, type DocBinding } from './binding';

// Only `api` itself is a stub — the error classes have to be the real ones, or
// `saveDiagram`'s `instanceof` checks would never match.
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { saveDiagram: vi.fn(async () => ({ updatedAt: '2026-09-06T09:00:00.000Z' })) },
}));

const saveDiagram = vi.mocked(api.saveDiagram);

const store = () => useDiagramStore.getState();

/** The origin this "client" writes with — what keeps it from reading itself back. */
const LOCAL = Symbol('local');

let binding: DocBinding | null = null;

function bind(doc: Y.Doc, options: { readOnly?: boolean } = {}) {
  binding = bindDocToStore(doc, useDiagramStore, LOCAL, options);
  return binding;
}

/**
 * `bind`, plus the registration `useCollabStore` makes for an editor: ⌘Z is
 * the document's per-user history rather than the snapshot stack.
 */
function bindWithHistory(doc: Y.Doc, options: { readOnly?: boolean } = {}) {
  const made = bind(doc, options);
  setDocumentHistory(made.history);
  return made;
}

/** The diagram exactly as an autosave would have written it. */
function snapshot() {
  const { nodes, edges, viewport, defaults, thumbnailNodeIds, voting, timer } = store();
  return serializeDiagram(nodes, edges, viewport, defaults, thumbnailNodeIds, { voting, timer });
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
  setDocumentFlush(null);
  setDocumentHistory(null);
  saveDiagram.mockClear();
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

  it('reports a gesture as still in this browser until the trailing flush writes it', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    const pending: boolean[] = [];
    binding = bindDocToStore(doc, useDiagramStore, LOCAL, {
      onPendingWrite: (value) => pending.push(value),
    });

    // A discrete edit goes at once: nothing was ever held back.
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    expect(pending).toEqual([]);

    store().beginInteraction();
    store().moveNodesTransient({ [id]: { x: 40, y: 0 } });
    expect(pending).toEqual([true]);

    vi.advanceTimersByTime(TRANSIENT_COMMIT_MS);
    expect(pending).toEqual([true, false]);
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

/**
 * Board defaults are shared state, unlike the viewport they sit beside in
 * `meta`: what ⌘⇧D says has to reach the other windows, or a collaborator's
 * next shape comes out in the wrong colour.
 */
describe('board defaults', () => {
  /** Make the one selected shape the board's default, as ⌘⇧D does. */
  function saveDefault(id: string) {
    select(id);
    return store().saveSelectionAsDefault();
  }

  it('writes a default this client saves into the document', () => {
    const doc = new Y.Doc();
    bind(doc);
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().updateNodeData(a, { fill: '#FF0000', fillStyle: 'outline' });

    expect(saveDefault(a)).toBe('shape');

    expect(docToDiagramData(doc).defaults).toMatchObject({
      shape: { fill: '#FF0000', fillStyle: 'outline' },
    });
    // And the snapshot the server would render still equals the JSON an
    // autosave would have written — the whole point of the binding.
    expect(docToDiagramData(doc)).toEqual(snapshot());
  });

  it('renders a collaborator’s default onto this client', () => {
    const doc = new Y.Doc();
    bind(doc);
    store().addShape('rectangle', { x: 0, y: 0 });

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    pushDiagramToDoc(
      peer,
      { ...docToDiagramData(peer), defaults: { shape: { fill: '#00FF00', stroke: '#008800' } } },
      'peer',
    );
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));

    expect(store().defaults).toEqual({ shape: { fill: '#00FF00', stroke: '#008800' } });
    // Which is what the next shape drawn *here* comes out as.
    store().addShape('rectangle', { x: 300, y: 0 });
    expect(store().nodes.at(-1)!.data).toMatchObject({ fill: '#00FF00', stroke: '#008800' });
  });

  it('narrows a collaborator’s default to style before acting on it', () => {
    const doc = new Y.Doc();
    bind(doc);

    // Written straight into the document, the way a browser running another
    // build — or none of ours — could.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    peer.getMap('meta').set('defaults', {
      shape: { fill: '#00FF00', locked: true, imageSrc: '/api/images/abc', label: 'no' },
    });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));

    expect(store().defaults).toEqual({ shape: { fill: '#00FF00' } });
    store().addShape('rectangle', { x: 0, y: 0 });
    const data = store().nodes.at(-1)!.data;
    expect(data.locked).toBeUndefined();
    expect(data.imageSrc).toBeUndefined();
    expect(data.label).toBe('');
  });

  it('carries a default saved before the socket opened into the document', () => {
    // The board is interactive while the socket is opening, so a ⌘⇧D pressed
    // in that beat is this browser's edit like any other.
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().updateNodeData(a, { fill: '#FF0000' });
    const baseline = snapshot();
    saveDefault(a);

    const doc = new Y.Doc();
    writeDiagramIntoDoc(doc, baseline, 'server');
    binding = bindDocToStore(doc, useDiagramStore, LOCAL, { baseline });

    expect(docToDiagramData(doc).defaults).toMatchObject({ shape: { fill: '#FF0000' } });
    expect(store().defaults.shape).toMatchObject({ fill: '#FF0000' });
  });

  it('writes nothing for a board that has no default', () => {
    const doc = new Y.Doc();
    bind(doc);
    store().addShape('rectangle', { x: 0, y: 0 });
    expect(doc.getMap('meta').get('defaults')).toBeUndefined();
    expect('defaults' in docToDiagramData(doc)).toBe(false);
  });

  it('is not something a viewer writes back', () => {
    const doc = new Y.Doc();
    writeDiagramIntoDoc(doc, snapshot(), 'server');
    bind(doc, { readOnly: true });

    const a = store().addShape('rectangle', { x: 0, y: 0 });
    saveDefault(a);

    expect(doc.getMap('meta').get('defaults')).toBeUndefined();
  });
});

/**
 * The board's custom thumbnail rides beside the defaults in `meta` and is
 * shared the same way: the dashboard card is the same card in every window.
 */
describe('board thumbnail', () => {
  it('writes a thumbnail this client sets into the document', () => {
    const doc = new Y.Doc();
    bind(doc);
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().addShape('rectangle', { x: 900, y: 0 });

    store().setThumbnailNodeIds([a]);

    expect(docToDiagramData(doc).thumbnailNodeIds).toEqual([a]);
    // And the snapshot the server would render is still exactly the JSON an
    // autosave would have written.
    expect(docToDiagramData(doc)).toEqual(snapshot());
  });

  it('renders a collaborator’s thumbnail onto this client', () => {
    const doc = new Y.Doc();
    bind(doc);
    const a = store().addShape('rectangle', { x: 0, y: 0 });

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    pushDiagramToDoc(peer, { ...docToDiagramData(peer), thumbnailNodeIds: [a] }, 'peer');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));

    expect(store().thumbnailNodeIds).toEqual([a]);
  });

  it('narrows a collaborator’s thumbnail to ids before acting on it', () => {
    const doc = new Y.Doc();
    bind(doc);

    // Written straight into the document, the way a browser running another
    // build — or none of ours — could.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    peer.getMap('meta').set('thumbnailNodeIds', ['a', '', null, 3, 'a']);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));

    expect(store().thumbnailNodeIds).toEqual(['a']);
  });

  it('clears it on every window when this one does', () => {
    const doc = new Y.Doc();
    bind(doc);
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().setThumbnailNodeIds([a]);

    store().setThumbnailNodeIds(null);

    expect(doc.getMap('meta').get('thumbnailNodeIds')).toBeUndefined();
    expect('thumbnailNodeIds' in docToDiagramData(doc)).toBe(false);
  });

  it('carries one set before the socket opened into the document', () => {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const baseline = snapshot();
    store().setThumbnailNodeIds([a]);

    const doc = new Y.Doc();
    writeDiagramIntoDoc(doc, baseline, 'server');
    binding = bindDocToStore(doc, useDiagramStore, LOCAL, { baseline });

    expect(docToDiagramData(doc).thumbnailNodeIds).toEqual([a]);
    expect(store().thumbnailNodeIds).toEqual([a]);
  });

  it('writes nothing for a board whose card is the automatic picture', () => {
    const doc = new Y.Doc();
    bind(doc);
    store().addShape('rectangle', { x: 0, y: 0 });
    expect(doc.getMap('meta').get('thumbnailNodeIds')).toBeUndefined();
    expect('thumbnailNodeIds' in docToDiagramData(doc)).toBe(false);
  });

  it('is not something a viewer writes back', () => {
    const doc = new Y.Doc();
    writeDiagramIntoDoc(doc, snapshot(), 'server');
    bind(doc, { readOnly: true });

    const a = store().addShape('rectangle', { x: 0, y: 0 });
    store().setThumbnailNodeIds([a]);

    expect(doc.getMap('meta').get('thumbnailNodeIds')).toBeUndefined();
  });
});

/**
 * The round of dot voting and the shared countdown ride in `meta` beside the
 * defaults and the thumbnail, on the same rules: everybody on the board votes
 * in the same round and watches the same clock, so both are read back out.
 */
describe('voting and the timer', () => {
  /** Somebody to attribute a dot to — the store is loaded without one. */
  beforeEach(() => {
    useDiagramStore.setState({ viewerId: 'ada' });
  });

  it('writes a round this client opens into the document', () => {
    const doc = new Y.Doc();
    bind(doc);
    store().addShape('sticky', { x: 0, y: 0 });

    store().startVoting(3);

    expect(docToDiagramData(doc).voting).toMatchObject({ active: true, dotsPerPerson: 3 });
    // And the snapshot the server would render is still exactly the JSON an
    // autosave would have written.
    expect(docToDiagramData(doc)).toEqual(snapshot());
  });

  it('carries a dot to the document as ordinary node data', () => {
    const doc = new Y.Doc();
    bind(doc);
    const id = store().addShape('sticky', { x: 0, y: 0 });
    store().startVoting(3);

    store().toggleVote(id);

    expect(docToDiagramData(doc).nodes[0].data.votes).toEqual({ ada: 1 });
    expect(docToDiagramData(doc)).toEqual(snapshot());
  });

  it('renders a collaborator’s round — and their reveal — onto this client', () => {
    const doc = new Y.Doc();
    bind(doc);
    store().addShape('sticky', { x: 0, y: 0 });

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const round = { active: true, revealed: false, dotsPerPerson: 2, startedById: 'grace' };
    pushDiagramToDoc(peer, { ...docToDiagramData(peer), voting: round }, 'peer');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
    expect(store().voting).toEqual(round);

    // Closing the round has to reach every window at once, or one person is
    // still voting blind while another reads the answers.
    pushDiagramToDoc(
      peer,
      { ...docToDiagramData(peer), voting: { ...round, active: false, revealed: true } },
      'peer',
    );
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
    expect(store().voting).toMatchObject({ active: false, revealed: true });
  });

  it('narrows a collaborator’s round before acting on it', () => {
    const doc = new Y.Doc();
    bind(doc);

    // Written straight into the document, the way a browser running another
    // build — or none of ours — could.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    peer.getMap('meta').set('voting', { active: true, dotsPerPerson: 3 });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));

    expect(store().voting).toBeNull();
  });

  it('round-trips a timer, and takes it off every window when one stops it', () => {
    const doc = new Y.Doc();
    bind(doc);
    store().startTimer(300);
    const endsAt = store().timer!.endsAt;
    expect(docToDiagramData(doc).timer).toEqual({ endsAt, startedById: 'ada' });

    store().stopTimer();
    expect(doc.getMap('meta').get('timer')).toBeUndefined();
    expect('timer' in docToDiagramData(doc)).toBe(false);
  });

  it('renders a collaborator’s timer onto this client', () => {
    const doc = new Y.Doc();
    bind(doc);

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const timer = { endsAt: '2030-01-01T00:00:00.000Z', startedById: 'grace' };
    pushDiagramToDoc(peer, { ...docToDiagramData(peer), timer }, 'peer');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));

    expect(store().timer).toEqual(timer);
  });

  it('writes neither key for a board that has never been voted on or timed', () => {
    const doc = new Y.Doc();
    bind(doc);
    store().addShape('sticky', { x: 0, y: 0 });
    expect(doc.getMap('meta').get('voting')).toBeUndefined();
    expect(doc.getMap('meta').get('timer')).toBeUndefined();
  });

  it('carries a round opened before the socket into the document', () => {
    store().addShape('sticky', { x: 0, y: 0 });
    const baseline = snapshot();
    store().startVoting(4);

    const doc = new Y.Doc();
    writeDiagramIntoDoc(doc, baseline, 'server');
    binding = bindDocToStore(doc, useDiagramStore, LOCAL, { baseline });

    expect(docToDiagramData(doc).voting).toMatchObject({ dotsPerPerson: 4 });
    expect(store().voting).toMatchObject({ dotsPerPerson: 4 });
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

  it('keeps a shape drawn while the socket was still opening', () => {
    // The board as the page loaded it over HTTP.
    store().loadDiagram('test', 'Test', false, {
      version: 3,
      nodes: [{ id: 'loaded', type: 'shape', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
    const baseline = snapshot();

    // The document, as the server holds it — the same board.
    const doc = new Y.Doc();
    pushDiagramToDoc(doc, baseline, 'server');
    doc.getMap('meta').set('seeded', true);

    // The user draws before the socket has finished opening.
    const drawn = store().addShape('rectangle', { x: 200, y: 200 });

    binding = bindDocToStore(doc, useDiagramStore, LOCAL, { baseline });

    // Both are there: the document did not roll the canvas back, and the
    // canvas did not overwrite the document.
    expect(store().nodes.map((n) => n.id)).toEqual(['loaded', drawn]);
    expect(docToDiagramData(doc).nodes.map((n) => n.id)).toEqual(['loaded', drawn]);
  });

  it('leaves a collaborator’s newer version of an untouched shape alone', () => {
    store().loadDiagram('test', 'Test', false, {
      version: 3,
      nodes: [
        { id: 'theirs', type: 'shape', position: { x: 0, y: 0 }, data: { label: 'old' } },
        { id: 'mine', type: 'shape', position: { x: 0, y: 0 }, data: { label: 'mine' } },
      ],
      edges: [],
    });
    const baseline = snapshot();

    // The document has moved on since the snapshot the page loaded: a
    // collaborator relabelled a shape, and deleted nothing.
    const doc = new Y.Doc();
    pushDiagramToDoc(
      doc,
      {
        ...baseline,
        nodes: [{ ...baseline.nodes[0], data: { label: 'new' } }, baseline.nodes[1]],
      },
      'peer',
    );
    doc.getMap('meta').set('seeded', true);

    // Meanwhile this browser edited the *other* shape.
    store().updateNodeData('mine', { label: 'edited' });

    binding = bindDocToStore(doc, useDiagramStore, LOCAL, { baseline });

    const merged = docToDiagramData(doc);
    // Not touched here, so the document's version of it stands…
    expect(merged.nodes[0].data.label).toBe('new');
    // …and the one that was is written over it.
    expect(merged.nodes[1].data.label).toBe('edited');
    expect(store().nodes.map((n) => n.data.label)).toEqual(['new', 'edited']);
  });

  it('carries a pre-sync deletion into the document rather than undoing it', () => {
    store().loadDiagram('test', 'Test', false, {
      version: 3,
      nodes: [
        { id: 'a', type: 'shape', position: { x: 0, y: 0 }, data: {} },
        { id: 'b', type: 'shape', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [],
    });
    const baseline = snapshot();
    const doc = new Y.Doc();
    pushDiagramToDoc(doc, baseline, 'server');
    doc.getMap('meta').set('seeded', true);

    select('a');
    store().deleteSelection();

    binding = bindDocToStore(doc, useDiagramStore, LOCAL, { baseline });

    expect(docToDiagramData(doc).nodes.map((n) => n.id)).toEqual(['b']);
    expect(store().nodes.map((n) => n.id)).toEqual(['b']);
  });

  it('does not replace a single node object when the document agrees with the canvas', () => {
    store().loadDiagram('test', 'Test', false, {
      version: 3,
      nodes: [{ id: 'a', type: 'shape', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
    const baseline = snapshot();
    const doc = new Y.Doc();
    pushDiagramToDoc(doc, baseline, 'server');
    doc.getMap('meta').set('seeded', true);

    // Identity, not equality: re-rendering every shape would blur a label
    // somebody is in the middle of typing into.
    const before = store().nodes;
    binding = bindDocToStore(doc, useDiagramStore, LOCAL, { baseline });
    expect(store().nodes).toBe(before);
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

/**
 * Undo, once the diagram lives in a document: `Y.UndoManager` scoped to this
 * browser's origin, dispatched to by the store's `undo` / `redo`. What the
 * snapshot stack could not promise is the first test here — ⌘Z takes back what
 * *you* did and never what somebody else did.
 */
describe('undo', () => {
  /** A second browser on the same document, holding the same board. */
  function peerOf(doc: Y.Doc) {
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    return peer;
  }

  /** Exchange every update both ways, as the server fans them out. */
  function converge(a: Y.Doc, b: Y.Doc) {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  }

  /** The other browser moves a shape, with no store of its own to do it through. */
  function moveOnPeer(doc: Y.Doc, id: string, position: { x: number; y: number }) {
    const data = docToDiagramData(doc);
    pushDiagramToDoc(
      doc,
      { ...data, nodes: data.nodes.map((node) => (node.id === id ? { ...node, position } : node)) },
      'peer',
    );
  }

  const positionOf = (doc: Y.Doc, id: string) =>
    docToDiagramData(doc).nodes.find((node) => node.id === id)!.position;

  const selectedIds = () => store().nodes.filter((node) => node.selected).map((node) => node.id);

  it('takes back this browser’s move on both documents and leaves a collaborator’s alone', () => {
    const doc = new Y.Doc();
    bindWithHistory(doc);
    const mine = store().addShape('rectangle', { x: 0, y: 0 });
    const theirs = store().addShape('ellipse', { x: 200, y: 0 });
    const peer = peerOf(doc);

    // Both of us move a shape, at the same time, on different shapes.
    moveOnPeer(peer, theirs, { x: 260, y: 40 });
    select(mine);
    store().nudgeSelected(10, 0);
    converge(doc, peer);
    expect(positionOf(doc, mine)).toEqual({ x: 10, y: 0 });
    expect(positionOf(doc, theirs)).toEqual({ x: 260, y: 40 });

    store().undo();
    converge(doc, peer);

    // Mine went back — in their window as well as mine, because undoing an
    // edit is itself an edit — and theirs was never mine to take back.
    expect(store().nodes.find((node) => node.id === mine)!.position).toEqual({ x: 0, y: 0 });
    expect(positionOf(doc, mine)).toEqual({ x: 0, y: 0 });
    expect(positionOf(peer, mine)).toEqual({ x: 0, y: 0 });
    expect(positionOf(doc, theirs)).toEqual({ x: 260, y: 40 });
    expect(positionOf(peer, theirs)).toEqual({ x: 260, y: 40 });
  });

  it('re-applies it on redo, again for everybody', () => {
    const doc = new Y.Doc();
    bindWithHistory(doc);
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    const peer = peerOf(doc);

    select(id);
    store().nudgeSelected(10, 0);
    store().undo();
    store().redo();
    converge(doc, peer);

    expect(store().nodes[0].position).toEqual({ x: 10, y: 0 });
    expect(positionOf(peer, id)).toEqual({ x: 10, y: 0 });
  });

  it('has nothing to undo after a collaborator’s edit, and ⌘Z leaves it standing', () => {
    const doc = new Y.Doc();
    bindWithHistory(doc);
    const peer = peerOf(doc);
    pushDiagramToDoc(
      peer,
      {
        version: 3,
        nodes: [{ id: 'theirs', type: 'shape', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
      },
      'peer',
    );
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
    expect(store().nodes).toHaveLength(1);
    expect(store().canUndo).toBe(false);

    store().undo();
    expect(store().nodes).toHaveLength(1);
  });

  it('makes a drag one step, even one the user paused in the middle of', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    bindWithHistory(doc);
    const id = store().addShape('rectangle', { x: 0, y: 0 });

    // React Flow reports a frame at a time and the release last.
    store().onNodesChange([{ id, type: 'position', position: { x: 30, y: 0 }, dragging: true }]);
    // Long enough that the trailing flush writes the frames so far — the pause
    // must not become an undo step of its own.
    vi.advanceTimersByTime(TRANSIENT_COMMIT_MS * 2);
    store().onNodesChange([{ id, type: 'position', position: { x: 60, y: 0 }, dragging: true }]);
    store().onNodesChange([{ id, type: 'position', position: { x: 90, y: 0 }, dragging: false }]);
    expect(store().nodes[0].position).toEqual({ x: 90, y: 0 });

    store().undo();
    expect(store().nodes[0].position).toEqual({ x: 0, y: 0 });
    // Drawing the shape was a step of its own, so it is still on the board.
    expect(store().nodes).toHaveLength(1);
  });

  it('coalesces arrow-key nudges the way the snapshot history did', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const doc = new Y.Doc();
    bindWithHistory(doc);
    const id = store().addShape('rectangle', { x: 0, y: 0 });
    select(id);

    // Three presses inside the 500 ms window are one edit...
    store().nudgeSelected(1, 0);
    vi.advanceTimersByTime(200);
    store().nudgeSelected(1, 0);
    vi.advanceTimersByTime(200);
    store().nudgeSelected(1, 0);
    // ...and one after the keyboard has gone quiet is another.
    vi.advanceTimersByTime(600);
    store().nudgeSelected(1, 0);
    expect(store().nodes[0].position).toEqual({ x: 4, y: 0 });

    store().undo();
    expect(store().nodes[0].position).toEqual({ x: 3, y: 0 });
    store().undo();
    expect(store().nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it('mirrors the document’s stacks onto canUndo / canRedo', () => {
    const doc = new Y.Doc();
    bindWithHistory(doc);
    expect(store().canUndo).toBe(false);
    expect(store().canRedo).toBe(false);

    store().addShape('rectangle', { x: 0, y: 0 });
    expect(store().canUndo).toBe(true);
    expect(store().canRedo).toBe(false);

    store().undo();
    expect(store().nodes).toHaveLength(0);
    expect(store().canUndo).toBe(false);
    expect(store().canRedo).toBe(true);

    store().redo();
    expect(store().nodes).toHaveLength(1);
    expect(store().canUndo).toBe(true);
    expect(store().canRedo).toBe(false);
  });

  it('puts the selection back on what the undo changed', () => {
    const doc = new Y.Doc();
    bindWithHistory(doc);
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addShape('ellipse', { x: 300, y: 0 });
    select(a);
    store().nudgeSelected(10, 0);
    // The user has clicked something else by the time they press ⌘Z; the shape
    // that moves back is off screen unless the selection follows it.
    select(b);

    store().undo();
    expect(selectedIds()).toEqual([a]);
  });

  it('forgets the old board when one is restored over it, and makes the restore one step', () => {
    const doc = new Y.Doc();
    bindWithHistory(doc);
    store().addShape('rectangle', { x: 0, y: 0 });
    store().addShape('ellipse', { x: 300, y: 0 });
    expect(store().canUndo).toBe(true);

    // What a version restore does: the board becomes something else entirely.
    store().loadDiagram('test', 'Test', false, { nodes: [], edges: [] });
    expect(store().nodes).toHaveLength(0);

    // The two shapes went with the board they were drawn on; the one thing left
    // to take back is the restore, and taking it back is all one step.
    store().undo();
    expect(store().nodes).toHaveLength(2);
    expect(store().canUndo).toBe(false);
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

describe('the offline cache', () => {
  /**
   * Phase 4 of `docs/realtime.md`: `y-indexeddb` keeps a copy of the document
   * in the browser and replays it into the `Y.Doc` on the next open, before —
   * or instead of — the server answering.
   *
   * The persistence layer itself is not what is under test here (it needs a
   * browser, and its whole contribution is an encoded update), so the stored
   * bytes are produced with `Y.encodeStateAsUpdate` and replayed with
   * `Y.applyUpdate`, which is exactly what `IndexeddbPersistence` does with
   * them. What *is* under test is the order the store sees it all in: the
   * cached board has to render on its own, and the server's state has to merge
   * into it afterwards rather than replace it.
   */
  const shape = (id: string, x: number, label: string) => ({
    id,
    type: 'shape',
    position: { x, y: 0 },
    data: { label },
  });

  /** The diagram as the server holds it, and the JSON the page loads. */
  const serverJson = { version: 3, nodes: [shape('shared', 0, 'Shared')], edges: [] };

  /**
   * The state this browser left behind: the diagram as the server had it, plus
   * the shape drawn while the socket was down and never sent to anybody.
   */
  function cachedUpdate() {
    const cached = new Y.Doc();
    writeDiagramIntoDoc(cached, serverJson, 'seed');
    pushDiagramToDoc(
      cached,
      { ...serverJson, nodes: [...serverJson.nodes, shape('offline', 200, 'Drawn offline')] },
      'offline-edit',
    );
    return Y.encodeStateAsUpdate(cached);
  }

  it('draws the cached board before the provider has synced anything', () => {
    // The page has loaded the diagram over HTTP, which is the *snapshot* —
    // rendered from the document, and missing everything this browser did
    // while it was offline.
    store().loadDiagram('test', 'Test', false, serverJson);
    const baseline = snapshot();

    // The provider's document, with IndexedDB replayed into it and nothing
    // from the server in it at all.
    const doc = new Y.Doc();
    Y.applyUpdate(doc, cachedUpdate());
    binding = bindDocToStore(doc, useDiagramStore, LOCAL, { baseline });

    expect(store().nodes.map((n) => n.id)).toEqual(['shared', 'offline']);
    expect(store().nodes[1].data.label).toBe('Drawn offline');
  });

  it('merges the server’s state into the cached one when the socket comes back', () => {
    store().loadDiagram('test', 'Test', false, serverJson);
    const baseline = snapshot();

    const doc = new Y.Doc();
    Y.applyUpdate(doc, cachedUpdate());
    binding = bindDocToStore(doc, useDiagramStore, LOCAL, { baseline });

    // Meanwhile, on the server: a collaborator drew something of their own on
    // the same diagram, starting from the same seed.
    const server = new Y.Doc();
    writeDiagramIntoDoc(server, serverJson, 'seed');
    pushDiagramToDoc(
      server,
      { ...serverJson, nodes: [...serverJson.nodes, shape('theirs', 400, 'Theirs')] },
      'peer',
    );

    // The socket comes back and the two states are exchanged, in the order the
    // provider does it: the server's into ours, then ours out to the server.
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));

    // Neither edit was lost, and neither window has to reload to see the other.
    expect(docToDiagramData(doc)).toEqual(docToDiagramData(server));
    expect(store().nodes.map((n) => n.id).sort()).toEqual(['offline', 'shared', 'theirs']);
    // …and the canvas is the document, not a stale render of it.
    expect(docToDiagramData(doc).nodes.map((n) => n.id)).toEqual(store().nodes.map((n) => n.id));
  });

  it('leaves the loaded board alone when the cache is empty', () => {
    // Nothing stored yet — a diagram opened on this machine for the first
    // time. Binding to that document must not empty the canvas the page has
    // already drawn from the JSON.
    store().loadDiagram('test', 'Test', false, serverJson);
    const baseline = snapshot();

    const doc = new Y.Doc();
    binding = bindDocToStore(doc, useDiagramStore, LOCAL, { baseline });

    expect(store().nodes.map((n) => n.id)).toEqual(['shared']);
    expect(docToDiagramData(doc).nodes.map((n) => n.id)).toEqual(['shared']);
  });
});

describe('the invariant: a bound diagram is never saved as a whole copy', () => {
  /** Everything on the board a mutating action can be run against. */
  function busyDiagram() {
    const a = store().addShape('rectangle', { x: 0, y: 0 });
    const b = store().addShape('ellipse', { x: 300, y: 0 });
    store().onConnect({ source: a, target: b, sourceHandle: null, targetHandle: null });
    return { a, b };
  }

  it('sends nothing through the API, however many actions are run', async () => {
    const doc = new Y.Doc();
    bind(doc);
    // What `useCollabStore` registers once the document is bound.
    setDocumentFlush(async () => true);

    const { a, b } = busyDiagram();
    store().updateNodeData(a, { label: 'One' });
    store().updateEdgeData(store().edges[0].id, { connectorType: 'curved' });
    select(a, b);
    store().updateSelectedNodesData({ bold: true });
    store().updateSelectedEdgesStyle({ strokeWidth: 3 });
    store().alignSelected('left');
    store().groupSelected();
    store().duplicateSelection();
    store().bringToFront();
    store().toggleLock();
    store().nudgeSelected(4, 0);
    store().setSelectedShapeKind('hexagon');
    store().addFrame({ x: 0, y: 400 });
    store().reparentByPosition([a]);
    store().applyImageBackfill([{ id: a, imageSrc: '/api/images/i1', shape: 'image' }]);
    store().deleteSelection();
    store().setViewport({ x: 1, y: 2, zoom: 1 });

    // Every one of them reached the document…
    expect(docToDiagramData(doc)).toEqual(snapshot());
    // …and none of them reached the JSON column.
    expect(saveDiagram).not.toHaveBeenCalled();

    // Not even the autosave loop, which still runs and still says "Saved".
    await expect(store().saveDiagram()).resolves.toBe('saved');
    expect(saveDiagram).not.toHaveBeenCalled();
    expect(store().saveStatus).toBe('saved');
  });

  it('reports an edit still stuck in the browser as a failure worth retrying', async () => {
    setDocumentFlush(async () => false);
    store().addShape('rectangle', { x: 0, y: 0 });

    await expect(store().saveDiagram()).resolves.toBe('error');
    expect(store().saveStatus).toBe('error');
    expect(saveDiagram).not.toHaveBeenCalled();
  });

  it('still writes the whole board for a diagram with no document behind it', async () => {
    store().addShape('rectangle', { x: 0, y: 0 });

    await expect(store().saveDiagram()).resolves.toBe('saved');
    expect(saveDiagram).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ data: snapshot() }),
      undefined,
    );
  });
});
