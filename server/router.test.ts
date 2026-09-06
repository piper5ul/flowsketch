import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuthUser } from './types.js';
import { MAX_THUMBNAIL_CHARS, THUMBNAIL_DATA_URL_PREFIX } from '../shared/types.js';
import { MAX_TITLE_CHARS } from './validation.js';

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowsketch-router-uploads-'));
process.env.UPLOAD_DIR = uploadDir;

const { prismaMock, authState } = vi.hoisted(() => ({
  prismaMock: {
    diagram: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    image: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
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

const owned = { id: 'd1', userId: 'u1', title: 'Mine', starred: false, data: { nodes: [], edges: [] } };

afterAll(() => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.resetAllMocks();
  authState.user = testUser;
});

describe('auth gate', () => {
  it('rejects every route without a session', async () => {
    authState.user = null;
    await request(app).get('/api/diagrams').expect(401);
    await request(app).post('/api/diagrams').send({}).expect(401);
    await request(app).get('/api/diagrams/d1').expect(401);
    await request(app).put('/api/diagrams/d1').send({}).expect(401);
    await request(app).delete('/api/diagrams/d1').expect(401);
    await request(app).patch('/api/diagrams/d1/star').expect(401);
    await request(app).post('/api/diagrams/d1/duplicate').expect(401);
    expect(prismaMock.diagram.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/diagrams', () => {
  it('lists only the caller\'s diagrams, newest first, as metadata', async () => {
    prismaMock.diagram.findMany.mockResolvedValue([{ id: 'd1', title: 'Mine', starred: false, updatedAt: new Date(0), thumbnail: null }]);
    const res = await request(app).get('/api/diagrams').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).not.toHaveProperty('data');
    expect(prismaMock.diagram.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' }, orderBy: { updatedAt: 'desc' } }),
    );
  });

  it('includes createdAt, which the dashboard offers as a sort order', async () => {
    prismaMock.diagram.findMany.mockResolvedValue([]);
    await request(app).get('/api/diagrams').expect(200);
    const [{ select }] = prismaMock.diagram.findMany.mock.calls[0] as [{ select: object }];
    expect(select).toMatchObject({ createdAt: true });
  });
});

describe('POST /api/diagrams', () => {
  it('creates an empty untitled diagram for the caller by default', async () => {
    prismaMock.diagram.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 'new', ...data }));
    const res = await request(app).post('/api/diagrams').send({}).expect(201);
    expect(res.body).toMatchObject({ id: 'new', userId: 'u1', title: 'Untitled', data: { nodes: [], edges: [] } });
  });

  it('accepts a title and initial data', async () => {
    prismaMock.diagram.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 'new', ...data }));
    const res = await request(app).post('/api/diagrams').send({ title: 'Plan', data: { nodes: [{ id: 'n' }], edges: [] } }).expect(201);
    expect(res.body.title).toBe('Plan');
    expect(res.body.data.nodes).toHaveLength(1);
  });

  it('rejects a title longer than 200 characters without touching the database', async () => {
    const res = await request(app).post('/api/diagrams').send({ title: 'x'.repeat(201) }).expect(400);
    expect(res.body).toMatchObject({ error: 'Invalid body' });
    expect(res.body.issues[0]).toMatchObject({ path: 'title' });
    expect(prismaMock.diagram.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/diagrams/:id', () => {
  it('returns the full diagram when the caller owns it', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(owned);
    const res = await request(app).get('/api/diagrams/d1').expect(200);
    expect(res.body).toMatchObject({ id: 'd1', data: { nodes: [], edges: [] } });
    expect(prismaMock.diagram.findFirst).toHaveBeenCalledWith({ where: { id: 'd1', userId: 'u1' } });
  });

  it('404s for a diagram the caller does not own (indistinguishable from missing)', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    await request(app).get('/api/diagrams/someone-elses').expect(404);
  });
});

describe('PUT /api/diagrams/:id', () => {
  it('updates only the fields that were sent', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1' });
    prismaMock.diagram.update.mockResolvedValue({ ...owned, title: 'Renamed' });
    await request(app).put('/api/diagrams/d1').send({ title: 'Renamed' }).expect(200);
    expect(prismaMock.diagram.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { title: 'Renamed' } });
  });

  it('rejects a non-boolean starred before looking the diagram up', async () => {
    const res = await request(app).put('/api/diagrams/d1').send({ starred: 'yes' }).expect(400);
    expect(res.body).toMatchObject({ error: 'Invalid body' });
    expect(res.body.issues[0]).toMatchObject({ path: 'starred' });
    expect(prismaMock.diagram.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('rejects a body with nothing to update', async () => {
    await request(app).put('/api/diagrams/d1').send({}).expect(400);
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('refuses to update a diagram the caller does not own', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    await request(app).put('/api/diagrams/d1').send({ title: 'Hijack' }).expect(404);
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('writes a thumbnail without touching the diagram itself', async () => {
    const thumbnail = `${THUMBNAIL_DATA_URL_PREFIX}iVBORw0KGgo=`;
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1' });
    prismaMock.diagram.update.mockResolvedValue({ ...owned, thumbnail });
    await request(app).put('/api/diagrams/d1').send({ thumbnail }).expect(200);
    expect(prismaMock.diagram.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { thumbnail } });
  });

  it('clears the thumbnail when it is sent as null', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1' });
    prismaMock.diagram.update.mockResolvedValue({ ...owned, thumbnail: null });
    await request(app).put('/api/diagrams/d1').send({ thumbnail: null }).expect(200);
    expect(prismaMock.diagram.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { thumbnail: null } });
  });

  it('rejects a thumbnail that is not a PNG data URL', async () => {
    const res = await request(app)
      .put('/api/diagrams/d1')
      .send({ thumbnail: 'data:image/svg+xml;base64,PHN2Zz4=' })
      .expect(400);
    expect(res.body.issues[0]).toMatchObject({ path: 'thumbnail' });
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('rejects an oversized thumbnail before it reaches the database', async () => {
    const huge = THUMBNAIL_DATA_URL_PREFIX + 'A'.repeat(MAX_THUMBNAIL_CHARS);
    await request(app).put('/api/diagrams/d1').send({ thumbnail: huge }).expect(400);
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
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', updatedAt: loadedAt });
    prismaMock.diagram.update.mockResolvedValue({ ...owned, title: 'Renamed', updatedAt: savedAt });

    const res = await request(app)
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
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', updatedAt: movedOnAt });

    const res = await request(app)
      .put('/api/diagrams/d1')
      .send({ title: 'Stale', ifUnmodifiedSince: loadedAt.toISOString() })
      .expect(409);

    expect(res.body).toEqual({ error: 'Conflict', updatedAt: movedOnAt.toISOString() });
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('writes regardless of the row when no guard is sent — an overwrite is deliberate', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', updatedAt: movedOnAt });
    prismaMock.diagram.update.mockResolvedValue({ ...owned, title: 'Mine wins' });

    await request(app).put('/api/diagrams/d1').send({ title: 'Mine wins' }).expect(200);
    expect(prismaMock.diagram.update).toHaveBeenCalled();
  });

  it('rejects a guard that is not an ISO timestamp', async () => {
    const res = await request(app)
      .put('/api/diagrams/d1')
      .send({ title: 'Renamed', ifUnmodifiedSince: 'yesterday' })
      .expect(400);
    expect(res.body.issues[0]).toMatchObject({ path: 'ifUnmodifiedSince' });
    expect(prismaMock.diagram.findFirst).not.toHaveBeenCalled();
  });

  it('does not treat the guard on its own as something to update', async () => {
    await request(app)
      .put('/api/diagrams/d1')
      .send({ ifUnmodifiedSince: loadedAt.toISOString() })
      .expect(400);
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/diagrams/:id', () => {
  it('deletes an owned diagram and returns 204', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1' });
    prismaMock.diagram.delete.mockResolvedValue(owned);
    await request(app).delete('/api/diagrams/d1').expect(204);
    expect(prismaMock.diagram.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });

  it('refuses to delete a diagram the caller does not own', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    await request(app).delete('/api/diagrams/d1').expect(404);
    expect(prismaMock.diagram.delete).not.toHaveBeenCalled();
  });

  it('does not touch the image tables when the diagram references no images', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', data: { nodes: [], edges: [] } });
    prismaMock.diagram.delete.mockResolvedValue(owned);
    await request(app).delete('/api/diagrams/d1').expect(204);
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

    await request(app).delete('/api/diagrams/d1').expect(204);

    expect(prismaMock.image.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['lonely'] }, userId: 'u1' },
    });
    expect(fs.existsSync(lonelyFile)).toBe(false);
    expect(fs.existsSync(sharedFile)).toBe(true);
  });

  it('scans the survivors only after the diagram row is gone', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({
      id: 'd1',
      data: { nodes: [nodeWithImage('n1', 'lonely')], edges: [] },
    });
    prismaMock.diagram.delete.mockResolvedValue(owned);
    prismaMock.diagram.findMany.mockResolvedValue([]);
    prismaMock.image.findMany.mockResolvedValue([{ id: 'lonely', mime: 'image/png' }]);
    prismaMock.image.deleteMany.mockResolvedValue({ count: 1 });

    await request(app).delete('/api/diagrams/d1').expect(204);

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
      data: { nodes: [nodeWithImage('n1', 'not-mine')], edges: [] },
    });
    prismaMock.diagram.delete.mockResolvedValue(owned);
    prismaMock.diagram.findMany.mockResolvedValue([]);
    // Ownership filter matches nothing: the id was in the JSON but the row is someone else's.
    prismaMock.image.findMany.mockResolvedValue([]);

    await request(app).delete('/api/diagrams/d1').expect(204);

    expect(prismaMock.image.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['not-mine'] }, userId: 'u1' },
      select: { id: true, mime: true },
    });
    expect(prismaMock.image.deleteMany).not.toHaveBeenCalled();
  });

  it('still returns 204 when cleanup fails, because the diagram is already gone', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({
      id: 'd1',
      data: { nodes: [nodeWithImage('n1', 'boom')], edges: [] },
    });
    prismaMock.diagram.delete.mockResolvedValue(owned);
    prismaMock.diagram.findMany.mockRejectedValue(new Error('database on fire'));

    await request(app).delete('/api/diagrams/d1').expect(204);
  });
});

describe('PUT /api/diagrams/:id — orphaned image cleanup', () => {
  function nodeWithImage(id: string, imageId: string) {
    return { id, type: 'shape', position: { x: 0, y: 0 }, data: { imageSrc: `/api/images/${imageId}` } };
  }
  /** What the row looked like before the edit, as the handler reads it. */
  function existingWith(...imageIds: string[]) {
    return { id: 'd1', data: { nodes: imageIds.map((i, n) => nodeWithImage(`n${n}`, i)), edges: [] } };
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

    await request(app).put('/api/diagrams/d1').send(bodyWith('kept')).expect(200);

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

    await request(app).put('/api/diagrams/d1').send(bodyWith()).expect(200);

    expect(prismaMock.image.findMany).not.toHaveBeenCalled();
    expect(prismaMock.image.deleteMany).not.toHaveBeenCalled();
    expect(fs.existsSync(sharedFile)).toBe(true);
  });

  it('scans the survivors only after the row is updated', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(existingWith('dropped'));
    prismaMock.diagram.update.mockResolvedValue(owned);
    prismaMock.diagram.findMany.mockResolvedValue([{ data: bodyWith().data }]);
    prismaMock.image.findMany.mockResolvedValue([]);

    await request(app).put('/api/diagrams/d1').send(bodyWith()).expect(200);

    // Otherwise the pre-edit JSON would still count as a live reference.
    const updatedAt = prismaMock.diagram.update.mock.invocationCallOrder[0];
    const scannedAt = prismaMock.diagram.findMany.mock.invocationCallOrder[0];
    expect(updatedAt).toBeLessThan(scannedAt);
  });

  it('does not scan when the edit drops no image', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(existingWith('kept'));
    prismaMock.diagram.update.mockResolvedValue(owned);

    await request(app).put('/api/diagrams/d1').send(bodyWith('kept', 'added')).expect(200);

    expect(prismaMock.diagram.findMany).not.toHaveBeenCalled();
    expect(prismaMock.image.deleteMany).not.toHaveBeenCalled();
  });

  it('does not scan for a PUT that carries no data', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(existingWith('kept'));
    prismaMock.diagram.update.mockResolvedValue({ ...owned, title: 'Renamed' });

    await request(app).put('/api/diagrams/d1').send({ title: 'Renamed' }).expect(200);

    expect(prismaMock.diagram.findMany).not.toHaveBeenCalled();
    expect(prismaMock.image.deleteMany).not.toHaveBeenCalled();
  });

  it('still returns 200 when cleanup fails, because the edit is already saved', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(existingWith('boom'));
    prismaMock.diagram.update.mockResolvedValue(owned);
    prismaMock.diagram.findMany.mockRejectedValue(new Error('database on fire'));

    await request(app).put('/api/diagrams/d1').send(bodyWith()).expect(200);
  });
});

describe('POST /api/diagrams/:id/duplicate', () => {
  const source = {
    title: 'Roadmap',
    data: { nodes: [{ id: 'n1' }], edges: [] },
    thumbnail: `${THUMBNAIL_DATA_URL_PREFIX}iVBORw0KGgo=`,
  };

  it('creates an unstarred copy of the diagram, thumbnail included', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(source);
    prismaMock.diagram.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 'd2', ...data }));

    const res = await request(app).post('/api/diagrams/d1/duplicate').expect(201);

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
    await request(app).post('/api/diagrams/someone-elses/duplicate').expect(404);
    expect(prismaMock.diagram.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'someone-elses', userId: 'u1' } }),
    );
    expect(prismaMock.diagram.create).not.toHaveBeenCalled();
  });

  it('keeps the copied title inside the length the API accepts', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ ...source, title: 'x'.repeat(MAX_TITLE_CHARS) });
    prismaMock.diagram.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 'd2', ...data }));

    const res = await request(app).post('/api/diagrams/d1/duplicate').expect(201);

    expect(res.body.title).toHaveLength(MAX_TITLE_CHARS);
    expect(res.body.title.endsWith(' (copy)')).toBe(true);
  });
});

describe('PATCH /api/diagrams/:id/star', () => {
  it('flips the starred flag and returns the new value', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', starred: false });
    prismaMock.diagram.update.mockResolvedValue({ ...owned, starred: true });
    const res = await request(app).patch('/api/diagrams/d1/star').expect(200);
    expect(res.body).toEqual({ starred: true });
    expect(prismaMock.diagram.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { starred: true } });
  });
});
