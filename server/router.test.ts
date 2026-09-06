import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuthUser } from './types.js';
import { MAX_THUMBNAIL_CHARS, THUMBNAIL_DATA_URL_PREFIX } from '../shared/types.js';
import { MAX_TITLE_CHARS } from './validation.js';
import { serveForFile } from './testServer.js';

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowsketch-router-uploads-'));
process.env.UPLOAD_DIR = uploadDir;

const { prismaMock, authState } = vi.hoisted(() => ({
  prismaMock: {
    diagram: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    image: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    diagramMember: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    diagramVersion: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
  authState: { user: null as AuthUser | null },
}));

/** A stand-in for what BetterAuth would put on the request. */
const testUser: AuthUser = {
  id: 'u1',
  name: 'User One',
  email: 'u1@example.test',
  emailVerified: true,
  image: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

vi.mock('./db.js', () => ({ prisma: prismaMock }));

vi.mock('./middleware.js', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!authState.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.user = authState.user;
    next();
  },
}));

const { apiRouter } = await import('./router.js');
const { imagePath } = await import('./storage.js');

const app = express();
// The same body limit `server/index.ts` mounts, so a body the real server
// would parse (a 200 KB thumbnail) is not turned into a 413 by the harness.
app.use('/api', express.json({ limit: '5mb' }));
app.use('/api', apiRouter);
// One port for the whole file, rather than the one-per-request supertest binds
// when handed an app — see `testServer.ts` for what that was costing.
const server = await serveForFile(app);

const owned = { id: 'd1', userId: 'u1', title: 'Mine', starred: false, data: { nodes: [], edges: [] } };

/**
 * The `where` every access check runs: the diagram, restricted to callers who
 * either own it or hold a member row on it. Asserted rather than matched
 * loosely, because this clause *is* the authorization rule.
 */
function accessWhere(id: string, userId = 'u1') {
  return { id, OR: [{ userId }, { members: { some: { userId } } }] };
}

/** A row as the access layer reads it back for a member of `role`. */
function memberRow(role: 'editor' | 'viewer', row: object = { id: 'd1' }) {
  return { ...row, userId: 'owner-user', members: [{ role }] };
}

afterAll(() => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.resetAllMocks();
  authState.user = testUser;
  // A `PUT` that changes `data` also snapshots the previous state. That belongs
  // to `versions.test.ts`; here it only has to stay out of the way, so the
  // newest snapshot is always "just now" and the interval suppresses it.
  prismaMock.diagramVersion.findFirst.mockResolvedValue({ createdAt: new Date() });
  // The orphan scan reads stored versions as well as live diagrams. A diagram
  // with no history is the default; the case where one exists is asserted below.
  prismaMock.diagramVersion.findMany.mockResolvedValue([]);
});

describe('auth gate', () => {
  it('rejects every route without a session', async () => {
    authState.user = null;
    await request(server).get('/api/diagrams').expect(401);
    await request(server).post('/api/diagrams').send({}).expect(401);
    await request(server).get('/api/diagrams/d1').expect(401);
    await request(server).put('/api/diagrams/d1').send({}).expect(401);
    await request(server).delete('/api/diagrams/d1').expect(401);
    await request(server).patch('/api/diagrams/d1/star').expect(401);
    await request(server).post('/api/diagrams/d1/duplicate').expect(401);
    expect(prismaMock.diagram.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/diagrams', () => {
  /** A row shaped as the listing query selects it. */
  function listRow(over: object = {}) {
    return {
      id: 'd1',
      title: 'Mine',
      starred: false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      thumbnail: null,
      userId: 'u1',
      user: { name: 'User One' },
      members: [],
      ...over,
    };
  }

  it('lists the caller\'s own diagrams, newest first, as metadata', async () => {
    prismaMock.diagram.findMany.mockResolvedValue([listRow()]);
    const res = await request(server).get('/api/diagrams').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).not.toHaveProperty('data');
    expect(res.body[0]).toMatchObject({ id: 'd1', role: 'owner' });
    // An owned diagram carries no ownerName: the owner is the caller.
    expect(res.body[0]).not.toHaveProperty('ownerName');
    expect(prismaMock.diagram.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ userId: 'u1' }, { members: { some: { userId: 'u1' } } }] },
        orderBy: { updatedAt: 'desc' },
      }),
    );
  });

  it('includes diagrams the caller was invited to, with their role and the owner\'s name', async () => {
    prismaMock.diagram.findMany.mockResolvedValue([
      listRow(),
      listRow({ id: 'd2', title: 'Theirs', userId: 'u2', user: { name: 'User Two' }, members: [{ role: 'editor' }] }),
      listRow({ id: 'd3', title: 'Read only', userId: 'u2', user: { name: 'User Two' }, members: [{ role: 'viewer' }] }),
    ]);
    const res = await request(server).get('/api/diagrams').expect(200);
    expect(res.body.map((d: { id: string; role: string }) => [d.id, d.role])).toEqual([
      ['d1', 'owner'],
      ['d2', 'editor'],
      ['d3', 'viewer'],
    ]);
    expect(res.body[1].ownerName).toBe('User Two');
    // Never the raw row: userId and the member rows are inputs to `role`, not output.
    expect(res.body[1]).not.toHaveProperty('userId');
    expect(res.body[1]).not.toHaveProperty('members');
  });

  it('includes createdAt, which the dashboard offers as a sort order', async () => {
    prismaMock.diagram.findMany.mockResolvedValue([]);
    await request(server).get('/api/diagrams').expect(200);
    const [{ select }] = prismaMock.diagram.findMany.mock.calls[0] as [{ select: object }];
    expect(select).toMatchObject({ createdAt: true });
  });
});

describe('POST /api/diagrams', () => {
  it('creates an empty untitled diagram for the caller by default', async () => {
    prismaMock.diagram.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 'new', ...data }));
    const res = await request(server).post('/api/diagrams').send({}).expect(201);
    expect(res.body).toMatchObject({ id: 'new', userId: 'u1', title: 'Untitled', data: { nodes: [], edges: [] } });
  });

  it('accepts a title and initial data', async () => {
    prismaMock.diagram.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 'new', ...data }));
    const res = await request(server).post('/api/diagrams').send({ title: 'Plan', data: { nodes: [{ id: 'n' }], edges: [] } }).expect(201);
    expect(res.body.title).toBe('Plan');
    expect(res.body.data.nodes).toHaveLength(1);
  });

  it('rejects a title longer than 200 characters without touching the database', async () => {
    const res = await request(server).post('/api/diagrams').send({ title: 'x'.repeat(201) }).expect(400);
    expect(res.body).toMatchObject({ error: 'Invalid body' });
    expect(res.body.issues[0]).toMatchObject({ path: 'title' });
    expect(prismaMock.diagram.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/diagrams/:id', () => {
  it('returns the full diagram when the caller owns it', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ ...owned, shareToken: null });
    const res = await request(server).get('/api/diagrams/d1').expect(200);
    expect(res.body).toMatchObject({ id: 'd1', data: { nodes: [], edges: [] }, role: 'owner' });
    expect(prismaMock.diagram.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: accessWhere('d1') }),
    );
  });

  it('404s for a diagram the caller can neither own nor see (indistinguishable from missing)', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    await request(server).get('/api/diagrams/someone-elses').expect(404);
  });

  it('serves a diagram the caller is a viewer of, without the owner\'s share token', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(
      memberRow('viewer', { ...owned, userId: 'u2', shareToken: 'secret-token' }),
    );
    const res = await request(server).get('/api/diagrams/d1').expect(200);
    expect(res.body).toMatchObject({ id: 'd1', role: 'viewer' });
    expect(res.body).not.toHaveProperty('shareToken');
  });

  it('refuses a member row carrying a role it does not recognise', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ ...owned, userId: 'u2', members: [{ role: 'admin' }] });
    await request(server).get('/api/diagrams/d1').expect(404);
  });
});

describe('PUT /api/diagrams/:id', () => {
  it('updates only the fields that were sent', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1' });
    prismaMock.diagram.update.mockResolvedValue({ ...owned, title: 'Renamed' });
    await request(server).put('/api/diagrams/d1').send({ title: 'Renamed' }).expect(200);
    expect(prismaMock.diagram.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { title: 'Renamed' } });
  });

  it('rejects a non-boolean starred before looking the diagram up', async () => {
    const res = await request(server).put('/api/diagrams/d1').send({ starred: 'yes' }).expect(400);
    expect(res.body).toMatchObject({ error: 'Invalid body' });
    expect(res.body.issues[0]).toMatchObject({ path: 'starred' });
    expect(prismaMock.diagram.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('rejects a body with nothing to update', async () => {
    await request(server).put('/api/diagrams/d1').send({}).expect(400);
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('refuses to update a diagram the caller does not own', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    await request(server).put('/api/diagrams/d1').send({ title: 'Hijack' }).expect(404);
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('lets an editor write', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor'));
    prismaMock.diagram.update.mockResolvedValue({ ...owned, title: 'Edited' });
    await request(server).put('/api/diagrams/d1').send({ title: 'Edited' }).expect(200);
    expect(prismaMock.diagram.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { title: 'Edited' } });
  });

  it('never hands an editor the owner\'s share token back', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor'));
    // `update` reads the whole row back, so the share token is in hand here —
    // the response is where it has to be dropped.
    prismaMock.diagram.update.mockResolvedValue({
      ...owned,
      userId: 'owner-user',
      title: 'Edited',
      shareToken: 'secret-token',
    });

    const res = await request(server).put('/api/diagrams/d1').send({ title: 'Edited' }).expect(200);

    expect(res.body).toMatchObject({ id: 'd1', title: 'Edited' });
    expect(res.body).not.toHaveProperty('shareToken');
  });

  it('keeps the share token in the owner\'s own PUT response', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1' });
    prismaMock.diagram.update.mockResolvedValue({ ...owned, shareToken: 'secret-token' });

    const res = await request(server).put('/api/diagrams/d1').send({ title: 'Renamed' }).expect(200);

    // The owner is the one person the link belongs to; the share dialog reads it.
    expect(res.body.shareToken).toBe('secret-token');
  });

  it('refuses a viewer\'s write with a 403, not a 404: they can already see it', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('viewer'));
    await request(server).put('/api/diagrams/d1').send({ title: 'Nope' }).expect(403);
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('refuses even an editor\'s attempt to star: the flag belongs to the owner', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor'));
    await request(server).put('/api/diagrams/d1').send({ starred: true }).expect(403);
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('frees the owner\'s images when an editor\'s edit drops one', async () => {
    const node = (imageId: string) => ({
      id: 'n1',
      type: 'shape',
      position: { x: 0, y: 0 },
      data: { imageSrc: `/api/images/${imageId}` },
    });
    prismaMock.diagram.findFirst.mockResolvedValue(
      memberRow('editor', { id: 'd1', data: { nodes: [node('dropped')], edges: [] } }),
    );
    prismaMock.diagram.update.mockResolvedValue(owned);
    prismaMock.diagram.findMany.mockResolvedValue([]);
    prismaMock.image.findMany.mockResolvedValue([]);

    await request(server).put('/api/diagrams/d1').send({ data: { nodes: [], edges: [] } }).expect(200);

    // Scoped to `owner-user`, whose uploads they are — never to the editor.
    expect(prismaMock.diagram.findMany).toHaveBeenCalledWith({
      where: { userId: 'owner-user' },
      select: { data: true },
    });
  });

  it('writes a thumbnail without touching the diagram itself', async () => {
    const thumbnail = `${THUMBNAIL_DATA_URL_PREFIX}iVBORw0KGgo=`;
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1' });
    prismaMock.diagram.update.mockResolvedValue({ ...owned, thumbnail });
    await request(server).put('/api/diagrams/d1').send({ thumbnail }).expect(200);
    expect(prismaMock.diagram.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { thumbnail } });
  });

  it('clears the thumbnail when it is sent as null', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1' });
    prismaMock.diagram.update.mockResolvedValue({ ...owned, thumbnail: null });
    await request(server).put('/api/diagrams/d1').send({ thumbnail: null }).expect(200);
    expect(prismaMock.diagram.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { thumbnail: null } });
  });

  it('rejects a thumbnail that is not a PNG data URL', async () => {
    const res = await request(server)
      .put('/api/diagrams/d1')
      .send({ thumbnail: 'data:image/svg+xml;base64,PHN2Zz4=' })
      .expect(400);
    expect(res.body.issues[0]).toMatchObject({ path: 'thumbnail' });
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('rejects an oversized thumbnail before it reaches the database', async () => {
    const huge = THUMBNAIL_DATA_URL_PREFIX + 'A'.repeat(MAX_THUMBNAIL_CHARS);
    await request(server).put('/api/diagrams/d1').send({ thumbnail: huge }).expect(400);
    expect(prismaMock.diagram.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });
});

describe('PUT /api/diagrams/:id — the ifUnmodifiedSince guard', () => {
  /** What the row says it was last written at, and what a client would echo back. */
  const loadedAt = new Date('2026-09-05T10:00:00.000Z');
  const movedOnAt = new Date('2026-09-05T10:05:00.000Z');

  it('writes when the guard matches the row, and answers with the new updatedAt', async () => {
    const savedAt = new Date('2026-09-05T10:07:00.000Z');
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', updatedAt: loadedAt });
    prismaMock.diagram.update.mockResolvedValue({ ...owned, title: 'Renamed', updatedAt: savedAt });

    const res = await request(server)
      .put('/api/diagrams/d1')
      .send({ title: 'Renamed', ifUnmodifiedSince: loadedAt.toISOString() })
      .expect(200);

    expect(res.body.updatedAt).toBe(savedAt.toISOString());
    // The guard is a precondition, never a column: it must not reach Prisma.
    expect(prismaMock.diagram.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { title: 'Renamed' },
    });
  });

  it('refuses the write with a 409 when the row has moved on', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', updatedAt: movedOnAt });

    const res = await request(server)
      .put('/api/diagrams/d1')
      .send({ title: 'Stale', ifUnmodifiedSince: loadedAt.toISOString() })
      .expect(409);

    expect(res.body).toEqual({ error: 'Conflict', updatedAt: movedOnAt.toISOString() });
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('writes regardless of the row when no guard is sent — an overwrite is deliberate', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', updatedAt: movedOnAt });
    prismaMock.diagram.update.mockResolvedValue({ ...owned, title: 'Mine wins' });

    await request(server).put('/api/diagrams/d1').send({ title: 'Mine wins' }).expect(200);
    expect(prismaMock.diagram.update).toHaveBeenCalled();
  });

  it('rejects a guard that is not an ISO timestamp', async () => {
    const res = await request(server)
      .put('/api/diagrams/d1')
      .send({ title: 'Renamed', ifUnmodifiedSince: 'yesterday' })
      .expect(400);
    expect(res.body.issues[0]).toMatchObject({ path: 'ifUnmodifiedSince' });
    expect(prismaMock.diagram.findFirst).not.toHaveBeenCalled();
  });

  it('does not treat the guard on its own as something to update', async () => {
    await request(server)
      .put('/api/diagrams/d1')
      .send({ ifUnmodifiedSince: loadedAt.toISOString() })
      .expect(400);
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/diagrams/:id', () => {
  it('deletes an owned diagram and returns 204', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1' });
    prismaMock.diagram.delete.mockResolvedValue(owned);
    await request(server).delete('/api/diagrams/d1').expect(204);
    expect(prismaMock.diagram.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });

  it('refuses to delete a diagram the caller does not own', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    await request(server).delete('/api/diagrams/d1').expect(404);
    expect(prismaMock.diagram.delete).not.toHaveBeenCalled();
  });

  it('refuses to delete a diagram the caller only edits', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor', { id: 'd1', data: { nodes: [], edges: [] } }));
    await request(server).delete('/api/diagrams/d1').expect(403);
    expect(prismaMock.diagram.delete).not.toHaveBeenCalled();
  });

  it('does not touch the image tables when the diagram references no images', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', data: { nodes: [], edges: [] } });
    prismaMock.diagram.delete.mockResolvedValue(owned);
    await request(server).delete('/api/diagrams/d1').expect(204);
    expect(prismaMock.diagram.findMany).not.toHaveBeenCalled();
    expect(prismaMock.image.deleteMany).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/diagrams/:id — orphaned image cleanup', () => {
  function nodeWithImage(id: string, imageId: string) {
    return { id, type: 'shape', position: { x: 0, y: 0 }, data: { imageSrc: `/api/images/${imageId}` } };
  }

  it('deletes images the diagram owned alone and keeps ones another diagram still uses', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      data: { nodes: [nodeWithImage('n1', 'lonely'), nodeWithImage('n2', 'shared')], edges: [] },
    });
    prismaMock.diagram.delete.mockResolvedValue(owned);
    // What is left after d1 is gone: d2 still references `shared`.
    prismaMock.diagram.findMany.mockResolvedValue([
      { data: { nodes: [nodeWithImage('n9', 'shared')], edges: [] } },
    ]);
    prismaMock.image.findMany.mockResolvedValue([{ id: 'lonely', mime: 'image/png' }]);
    prismaMock.image.deleteMany.mockResolvedValue({ count: 1 });

    fs.mkdirSync(path.join(uploadDir, 'u1'), { recursive: true });
    const lonelyFile = imagePath('u1', 'lonely', 'png');
    const sharedFile = imagePath('u1', 'shared', 'png');
    fs.writeFileSync(lonelyFile, 'x');
    fs.writeFileSync(sharedFile, 'x');

    await request(server).delete('/api/diagrams/d1').expect(204);

    expect(prismaMock.image.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['lonely'] }, userId: 'u1' },
    });
    expect(fs.existsSync(lonelyFile)).toBe(false);
    expect(fs.existsSync(sharedFile)).toBe(true);
  });

  it('scans the survivors only after the diagram row is gone', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      data: { nodes: [nodeWithImage('n1', 'lonely')], edges: [] },
    });
    prismaMock.diagram.delete.mockResolvedValue(owned);
    prismaMock.diagram.findMany.mockResolvedValue([]);
    prismaMock.image.findMany.mockResolvedValue([{ id: 'lonely', mime: 'image/png' }]);
    prismaMock.image.deleteMany.mockResolvedValue({ count: 1 });

    await request(server).delete('/api/diagrams/d1').expect(204);

    // Otherwise the diagram being deleted would count as a live reference to its own images.
    const deletedAt = prismaMock.diagram.delete.mock.invocationCallOrder[0];
    const scannedAt = prismaMock.diagram.findMany.mock.invocationCallOrder[0];
    expect(deletedAt).toBeLessThan(scannedAt);
    expect(prismaMock.diagram.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      select: { data: true },
    });
  });

  it('never deletes an image row belonging to another user', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      data: { nodes: [nodeWithImage('n1', 'not-mine')], edges: [] },
    });
    prismaMock.diagram.delete.mockResolvedValue(owned);
    prismaMock.diagram.findMany.mockResolvedValue([]);
    // Ownership filter matches nothing: the id was in the JSON but the row is someone else's.
    prismaMock.image.findMany.mockResolvedValue([]);

    await request(server).delete('/api/diagrams/d1').expect(204);

    expect(prismaMock.image.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['not-mine'] }, userId: 'u1' },
      select: { id: true, mime: true },
    });
    expect(prismaMock.image.deleteMany).not.toHaveBeenCalled();
  });

  it('still returns 204 when cleanup fails, because the diagram is already gone', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      data: { nodes: [nodeWithImage('n1', 'boom')], edges: [] },
    });
    prismaMock.diagram.delete.mockResolvedValue(owned);
    prismaMock.diagram.findMany.mockRejectedValue(new Error('database on fire'));

    await request(server).delete('/api/diagrams/d1').expect(204);
  });
});

describe('PUT /api/diagrams/:id — orphaned image cleanup', () => {
  function nodeWithImage(id: string, imageId: string) {
    return { id, type: 'shape', position: { x: 0, y: 0 }, data: { imageSrc: `/api/images/${imageId}` } };
  }
  /** What the row looked like before the edit, as the handler reads it. */
  function existingWith(...imageIds: string[]) {
    return { id: 'd1', userId: 'u1', data: { nodes: imageIds.map((i, n) => nodeWithImage(`n${n}`, i)), edges: [] } };
  }
  /** The body of an edit that leaves `imageIds` on the canvas. */
  function bodyWith(...imageIds: string[]) {
    return { data: { nodes: imageIds.map((i, n) => nodeWithImage(`n${n}`, i)), edges: [] } };
  }

  it('deletes an image the edit removed from the canvas', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(existingWith('dropped', 'kept'));
    prismaMock.diagram.update.mockResolvedValue(owned);
    // The survivor scan runs after the update, so d1 already reads back edited.
    prismaMock.diagram.findMany.mockResolvedValue([{ data: bodyWith('kept').data }]);
    prismaMock.image.findMany.mockResolvedValue([{ id: 'dropped', mime: 'image/png' }]);
    prismaMock.image.deleteMany.mockResolvedValue({ count: 1 });

    fs.mkdirSync(path.join(uploadDir, 'u1'), { recursive: true });
    const droppedFile = imagePath('u1', 'dropped', 'png');
    fs.writeFileSync(droppedFile, 'x');

    await request(server).put('/api/diagrams/d1').send(bodyWith('kept')).expect(200);

    expect(prismaMock.image.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['dropped'] }, userId: 'u1' },
    });
    expect(fs.existsSync(droppedFile)).toBe(false);
  });

  it('keeps a dropped image that another diagram still references', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(existingWith('shared'));
    prismaMock.diagram.update.mockResolvedValue(owned);
    // d2 still uses `shared`, so removing it from d1 must not delete the file.
    prismaMock.diagram.findMany.mockResolvedValue([
      { data: bodyWith().data },
      { data: bodyWith('shared').data },
    ]);
    prismaMock.image.findMany.mockResolvedValue([]);

    fs.mkdirSync(path.join(uploadDir, 'u1'), { recursive: true });
    const sharedFile = imagePath('u1', 'shared', 'png');
    fs.writeFileSync(sharedFile, 'x');

    await request(server).put('/api/diagrams/d1').send(bodyWith()).expect(200);

    expect(prismaMock.image.findMany).not.toHaveBeenCalled();
    expect(prismaMock.image.deleteMany).not.toHaveBeenCalled();
    expect(fs.existsSync(sharedFile)).toBe(true);
  });

  it('keeps a dropped image that only a stored version still draws', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(existingWith('in-history'));
    prismaMock.diagram.update.mockResolvedValue(owned);
    // Nothing on any live board references it any more…
    prismaMock.diagram.findMany.mockResolvedValue([{ data: bodyWith().data }]);
    // …but a snapshot of the owner's own diagram still does, and restoring that
    // snapshot has to bring the picture back with it.
    prismaMock.diagramVersion.findMany.mockResolvedValue([{ data: bodyWith('in-history').data }]);

    fs.mkdirSync(path.join(uploadDir, 'u1'), { recursive: true });
    const historicFile = imagePath('u1', 'in-history', 'png');
    fs.writeFileSync(historicFile, 'x');

    await request(server).put('/api/diagrams/d1').send(bodyWith()).expect(200);

    // Scoped to the owner's own history, as the diagram scan is to their boards.
    expect(prismaMock.diagramVersion.findMany).toHaveBeenCalledWith({
      where: { diagram: { userId: 'u1' } },
      select: { data: true },
    });
    expect(prismaMock.image.deleteMany).not.toHaveBeenCalled();
    expect(fs.existsSync(historicFile)).toBe(true);
  });

  it('deletes a dropped image once no version references it either', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(existingWith('dropped'));
    prismaMock.diagram.update.mockResolvedValue(owned);
    prismaMock.diagram.findMany.mockResolvedValue([{ data: bodyWith().data }]);
    // History exists but draws something else, so it is no reason to keep it.
    prismaMock.diagramVersion.findMany.mockResolvedValue([{ data: bodyWith('other').data }]);
    prismaMock.image.findMany.mockResolvedValue([{ id: 'dropped', mime: 'image/png' }]);
    prismaMock.image.deleteMany.mockResolvedValue({ count: 1 });

    await request(server).put('/api/diagrams/d1').send(bodyWith()).expect(200);

    expect(prismaMock.image.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['dropped'] }, userId: 'u1' },
    });
  });

  it('scans the survivors only after the row is updated', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(existingWith('dropped'));
    prismaMock.diagram.update.mockResolvedValue(owned);
    prismaMock.diagram.findMany.mockResolvedValue([{ data: bodyWith().data }]);
    prismaMock.image.findMany.mockResolvedValue([]);

    await request(server).put('/api/diagrams/d1').send(bodyWith()).expect(200);

    // Otherwise the pre-edit JSON would still count as a live reference.
    const updatedAt = prismaMock.diagram.update.mock.invocationCallOrder[0];
    const scannedAt = prismaMock.diagram.findMany.mock.invocationCallOrder[0];
    expect(updatedAt).toBeLessThan(scannedAt);
  });

  it('does not scan when the edit drops no image', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(existingWith('kept'));
    prismaMock.diagram.update.mockResolvedValue(owned);

    await request(server).put('/api/diagrams/d1').send(bodyWith('kept', 'added')).expect(200);

    expect(prismaMock.diagram.findMany).not.toHaveBeenCalled();
    expect(prismaMock.image.deleteMany).not.toHaveBeenCalled();
  });

  it('does not scan for a PUT that carries no data', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(existingWith('kept'));
    prismaMock.diagram.update.mockResolvedValue({ ...owned, title: 'Renamed' });

    await request(server).put('/api/diagrams/d1').send({ title: 'Renamed' }).expect(200);

    expect(prismaMock.diagram.findMany).not.toHaveBeenCalled();
    expect(prismaMock.image.deleteMany).not.toHaveBeenCalled();
  });

  it('still returns 200 when cleanup fails, because the edit is already saved', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(existingWith('boom'));
    prismaMock.diagram.update.mockResolvedValue(owned);
    prismaMock.diagram.findMany.mockRejectedValue(new Error('database on fire'));

    await request(server).put('/api/diagrams/d1').send(bodyWith()).expect(200);
  });
});

describe('POST /api/diagrams/:id/duplicate', () => {
  const source = {
    userId: 'u1',
    title: 'Roadmap',
    data: { nodes: [{ id: 'n1' }], edges: [] },
    thumbnail: `${THUMBNAIL_DATA_URL_PREFIX}iVBORw0KGgo=`,
  };

  it('creates an unstarred copy of the diagram, thumbnail included', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(source);
    prismaMock.diagram.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 'd2', ...data }));

    const res = await request(server).post('/api/diagrams/d1/duplicate').expect(201);

    expect(res.body).toMatchObject({ id: 'd2', title: 'Roadmap (copy)', data: source.data });
    expect(prismaMock.diagram.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        title: 'Roadmap (copy)',
        data: source.data,
        thumbnail: source.thumbnail,
        starred: false,
      },
    });
  });

  it('looks the source up under the caller, so another user\'s diagram is a 404', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    await request(server).post('/api/diagrams/someone-elses/duplicate').expect(404);
    expect(prismaMock.diagram.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: accessWhere('someone-elses') }),
    );
    expect(prismaMock.diagram.create).not.toHaveBeenCalled();
  });

  it('stays owner-only: a member may open the diagram but not copy it', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor', source));
    await request(server).post('/api/diagrams/d1/duplicate').expect(403);
    expect(prismaMock.diagram.create).not.toHaveBeenCalled();
  });

  it('keeps the copied title inside the length the API accepts', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ ...source, title: 'x'.repeat(MAX_TITLE_CHARS) });
    prismaMock.diagram.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 'd2', ...data }));

    const res = await request(server).post('/api/diagrams/d1/duplicate').expect(201);

    expect(res.body.title).toHaveLength(MAX_TITLE_CHARS);
    expect(res.body.title.endsWith(' (copy)')).toBe(true);
  });
});

describe('PATCH /api/diagrams/:id/star', () => {
  it('flips the starred flag and returns the new value', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', starred: false });
    prismaMock.diagram.update.mockResolvedValue({ ...owned, starred: true });
    const res = await request(server).patch('/api/diagrams/d1/star').expect(200);
    expect(res.body).toEqual({ starred: true });
    expect(prismaMock.diagram.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { starred: true } });
  });

  it('stays owner-only: starring is a column on the row, not a per-user flag', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor', { id: 'd1', starred: false }));
    await request(server).patch('/api/diagrams/d1/star').expect(403);
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });
});
