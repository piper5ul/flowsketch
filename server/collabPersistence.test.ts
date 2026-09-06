/**
 * The persistence half of the collaboration server: what `fetch` loads, what
 * the lazy upgrade seeds, and the four writes `store` makes.
 *
 * Prisma, the image index, the collector and version history are all mocked, so
 * what is under test is the *order* and the *rules* — which is where the
 * dual-write risk in `docs/realtime.md` lives.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { Extension, onLoadDocumentPayload, storePayload } from '@hocuspocus/server';
import { CURRENT_DIAGRAM_VERSION } from '../src/lib/diagramMigrations.js';
import { docToDiagramData, seedDocFromDiagramData } from './collab/render.js';

const { prismaMock, imagesMock, versionsMock, indexMock } = vi.hoisted(() => ({
  prismaMock: {
    diagramDoc: { findUnique: vi.fn(), upsert: vi.fn() },
    diagram: { findUnique: vi.fn(), update: vi.fn() },
  },
  imagesMock: { deleteOrphanImages: vi.fn() },
  versionsMock: { recordVersionIfDue: vi.fn(), versionsRouter: {} },
  indexMock: { syncDiagramImages: vi.fn() },
}));

vi.mock('./db.js', () => ({ prisma: prismaMock }));
vi.mock('./auth.js', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('./access.js', () => ({ getDiagramAccess: vi.fn() }));
vi.mock('./images.js', () => imagesMock);
vi.mock('./versions.js', () => versionsMock);
vi.mock('./diagramImages.js', () => indexMock);

const { diagramPersistence } = await import('./collab.js');

const OWNER = 'owner-1';

function node(id: string, imageSrc?: string) {
  return {
    id,
    type: 'shape',
    position: { x: 0, y: 0 },
    width: 100,
    height: 100,
    data: { label: id, shape: 'rectangle', fill: '#fff', stroke: '#000', ...(imageSrc && { imageSrc }) },
  };
}

function diagramJson(nodes: ReturnType<typeof node>[] = []) {
  return { version: CURRENT_DIAGRAM_VERSION, nodes, edges: [] };
}

/** `onLoadDocument`, with the fields the hook reads spelled out. */
function load(extension: Extension, documentName: string, document: Y.Doc) {
  return extension.onLoadDocument!({ documentName, document } as unknown as onLoadDocumentPayload);
}

/** `onStoreDocument`, likewise. The extension encodes `state` from `document`. */
function store(extension: Extension, documentName: string, document: Y.Doc) {
  return extension.onStoreDocument!({
    documentName,
    document,
    lastContext: { user: { id: 'editor-1', name: 'Ed' }, role: 'editor' },
  } as unknown as storePayload);
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.diagramDoc.findUnique.mockResolvedValue(null);
  prismaMock.diagramDoc.upsert.mockResolvedValue({});
  prismaMock.diagram.findUnique.mockResolvedValue({ userId: OWNER, title: 'Board', data: diagramJson() });
  prismaMock.diagram.update.mockResolvedValue({});
  indexMock.syncDiagramImages.mockResolvedValue(undefined);
  versionsMock.recordVersionIfDue.mockResolvedValue(undefined);
  imagesMock.deleteOrphanImages.mockResolvedValue(undefined);
});

describe('fetch', () => {
  it('loads the stored document and never reads the JSON', async () => {
    const source = new Y.Doc();
    seedDocFromDiagramData(source, diagramJson([node('a')]));
    prismaMock.diagramDoc.findUnique.mockResolvedValue({ state: Y.encodeStateAsUpdate(source) });

    const document = new Y.Doc();
    await load(diagramPersistence(), 'diagram:d1', document);

    expect(docToDiagramData(document).nodes.map((n) => n.id)).toEqual(['a']);
    expect(prismaMock.diagram.findUnique).not.toHaveBeenCalled();
    // Nothing to write: the document is exactly what was loaded.
    expect(prismaMock.diagramDoc.upsert).not.toHaveBeenCalled();
  });

  it('seeds from the diagram JSON the first time, and stores that state at once', async () => {
    // A v0 row: no version, no `type`. The lazy upgrade has to migrate it.
    prismaMock.diagram.findUnique.mockResolvedValue({
      data: { nodes: [{ id: 'a', position: { x: 3, y: 4 } }], edges: [] },
    });

    const document = new Y.Doc();
    await load(diagramPersistence(), 'diagram:d1', document);

    const rendered = docToDiagramData(document);
    expect(rendered.version).toBe(CURRENT_DIAGRAM_VERSION);
    expect(rendered.nodes[0]).toMatchObject({ id: 'a', type: 'shape' });

    // Written immediately: the row's existence is what tells the PUT handler
    // this diagram is collaborative now.
    expect(prismaMock.diagramDoc.upsert).toHaveBeenCalledTimes(1);
    const { where, create } = prismaMock.diagramDoc.upsert.mock.calls[0][0];
    expect(where).toEqual({ diagramId: 'd1' });
    const replayed = new Y.Doc();
    Y.applyUpdate(replayed, create.state);
    expect(docToDiagramData(replayed)).toEqual(rendered);
  });

  it('leaves the document empty for a diagram that has been deleted', async () => {
    prismaMock.diagram.findUnique.mockResolvedValue(null);
    const document = new Y.Doc();
    await load(diagramPersistence(), 'diagram:gone', document);
    expect(docToDiagramData(document).nodes).toEqual([]);
    expect(prismaMock.diagramDoc.upsert).not.toHaveBeenCalled();
  });

  it('does not query at all for a document name that is not a diagram', async () => {
    await load(diagramPersistence(), 'notes:d1', new Y.Doc());
    expect(prismaMock.diagramDoc.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.diagram.findUnique).not.toHaveBeenCalled();
  });
});

describe('store', () => {
  it('writes the document, the snapshot, a version and the image index', async () => {
    const document = new Y.Doc();
    seedDocFromDiagramData(document, diagramJson([node('a')]));

    await store(diagramPersistence(), 'diagram:d1', document);

    // 1. the document itself, and it round-trips.
    const [{ create }] = prismaMock.diagramDoc.upsert.mock.calls[0];
    const replayed = new Y.Doc();
    Y.applyUpdate(replayed, create.state);
    expect(docToDiagramData(replayed).nodes.map((n) => n.id)).toEqual(['a']);

    // 2. the JSON snapshot, rendered from the document rather than sent by a client.
    expect(prismaMock.diagram.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { data: docToDiagramData(document) },
    });

    // 3. history, of the state this write replaces, attributed to whoever was
    //    last on the socket but freeing the *owner's* uploads.
    expect(versionsMock.recordVersionIfDue).toHaveBeenCalledWith({
      diagramId: 'd1',
      data: diagramJson(),
      title: 'Board',
      createdById: 'editor-1',
      ownerId: OWNER,
    });

    // 4. the image index, against the rendered JSON.
    expect(indexMock.syncDiagramImages).toHaveBeenCalledWith('d1', docToDiagramData(document));
  });

  it('collects the images the edit dropped, as the PUT handler does', async () => {
    prismaMock.diagram.findUnique.mockResolvedValue({
      userId: OWNER,
      title: 'Board',
      data: diagramJson([node('a', '/api/images/img1'), node('b', '/api/images/img2')]),
    });
    const document = new Y.Doc();
    seedDocFromDiagramData(document, diagramJson([node('a', '/api/images/img1')]));

    await store(diagramPersistence(), 'diagram:d1', document);

    expect(imagesMock.deleteOrphanImages).toHaveBeenCalledWith(OWNER, ['img2']);
  });

  it('holds the collector back when the index could not be synced', async () => {
    prismaMock.diagram.findUnique.mockResolvedValue({
      userId: OWNER,
      title: 'Board',
      data: diagramJson([node('a', '/api/images/img1')]),
    });
    indexMock.syncDiagramImages.mockRejectedValue(new Error('nope'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const document = new Y.Doc();
    seedDocFromDiagramData(document, diagramJson());
    await store(diagramPersistence(), 'diagram:d1', document);

    expect(imagesMock.deleteOrphanImages).not.toHaveBeenCalled();
  });

  it('keeps going when the version snapshot fails: the edit is already safe', async () => {
    versionsMock.recordVersionIfDue.mockRejectedValue(new Error('nope'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const document = new Y.Doc();
    seedDocFromDiagramData(document, diagramJson([node('a')]));
    await expect(store(diagramPersistence(), 'diagram:d1', document)).resolves.toBeUndefined();

    expect(indexMock.syncDiagramImages).toHaveBeenCalled();
  });

  it('writes no snapshot for a diagram deleted while it was open', async () => {
    prismaMock.diagram.findUnique.mockResolvedValue(null);
    const document = new Y.Doc();
    seedDocFromDiagramData(document, diagramJson([node('a')]));

    await store(diagramPersistence(), 'diagram:d1', document);

    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
    expect(versionsMock.recordVersionIfDue).not.toHaveBeenCalled();
    expect(indexMock.syncDiagramImages).not.toHaveBeenCalled();
  });

  it('attributes the snapshot to the owner when no connection is left to name', async () => {
    const document = new Y.Doc();
    seedDocFromDiagramData(document, diagramJson([node('a')]));
    const extension = diagramPersistence();
    await extension.onStoreDocument!({
      documentName: 'diagram:d1',
      document,
    } as unknown as storePayload);

    expect(versionsMock.recordVersionIfDue).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: OWNER, ownerId: OWNER }),
    );
  });
});
