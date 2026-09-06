import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { AuthUser } from './types.js';
import { serveForFile } from './testServer.js';
import { MAX_FOLDER_NAME_CHARS } from '../shared/types.js';

const { prismaMock, authState } = vi.hoisted(() => ({
  prismaMock: {
    folder: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    diagram: {
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  authState: { user: null as AuthUser | null },
}));

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

const { foldersRouter } = await import('./folders.js');

const app = express();
app.use('/api', express.json());
app.use('/api', (req, res, next) => {
  if (!authState.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.user = authState.user;
  next();
});
app.use('/api', foldersRouter);
// One port for the whole file — see `testServer.ts`.
const server = serveForFile(app);

const CREATED_AT = new Date('2026-09-06T10:00:00.000Z');

/** A folder row as the listing's `select` reads it back. */
function folderRow(over: { id?: string; name?: string; diagrams?: number } = {}) {
  return {
    id: over.id ?? 'f1',
    name: over.name ?? 'Client work',
    createdAt: CREATED_AT,
    _count: { diagrams: over.diagrams ?? 0 },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  authState.user = testUser;
});

describe('GET /api/folders', () => {
  it('lists the caller\'s folders, oldest first, with their diagram counts', async () => {
    prismaMock.folder.findMany.mockResolvedValue([
      folderRow({ id: 'f1', name: 'Client work', diagrams: 2 }),
      folderRow({ id: 'f2', name: 'Personal', diagrams: 0 }),
    ]);

    const res = await request(server).get('/api/folders');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'f1', name: 'Client work', createdAt: CREATED_AT.toISOString(), diagramCount: 2 },
      { id: 'f2', name: 'Personal', createdAt: CREATED_AT.toISOString(), diagramCount: 0 },
    ]);
    // The scope *is* the authorization rule: only this user's rows, and the
    // order the sidebar renders them in.
    expect(prismaMock.folder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' }, orderBy: { createdAt: 'asc' } }),
    );
  });

  it('refuses an unauthenticated caller', async () => {
    authState.user = null;
    const res = await request(server).get('/api/folders');
    expect(res.status).toBe(401);
    expect(prismaMock.folder.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/folders', () => {
  it('creates a folder owned by the caller and reports it empty', async () => {
    prismaMock.folder.create.mockResolvedValue({
      id: 'f1',
      name: 'Client work',
      createdAt: CREATED_AT,
    });

    const res = await request(server).post('/api/folders').send({ name: 'Client work' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 'f1',
      name: 'Client work',
      createdAt: CREATED_AT.toISOString(),
      diagramCount: 0,
    });
    expect(prismaMock.folder.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: 'u1', name: 'Client work' } }),
    );
  });

  it('trims the name before storing it', async () => {
    prismaMock.folder.create.mockResolvedValue({ id: 'f1', name: 'Client work', createdAt: CREATED_AT });

    await request(server).post('/api/folders').send({ name: '  Client work  ' });

    expect(prismaMock.folder.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: 'u1', name: 'Client work' } }),
    );
  });

  it.each([
    ['empty', ''],
    ['only whitespace', '   '],
    ['past the length limit', 'x'.repeat(MAX_FOLDER_NAME_CHARS + 1)],
  ])('refuses a name that is %s', async (_label, name) => {
    const res = await request(server).post('/api/folders').send({ name });

    expect(res.status).toBe(400);
    expect(prismaMock.folder.create).not.toHaveBeenCalled();
  });

  it('refuses a body with no name at all', async () => {
    const res = await request(server).post('/api/folders').send({});
    expect(res.status).toBe(400);
    expect(prismaMock.folder.create).not.toHaveBeenCalled();
  });

  it('accepts a name exactly at the length limit', async () => {
    const name = 'x'.repeat(MAX_FOLDER_NAME_CHARS);
    prismaMock.folder.create.mockResolvedValue({ id: 'f1', name, createdAt: CREATED_AT });

    const res = await request(server).post('/api/folders').send({ name });

    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/folders/:id', () => {
  it('renames the caller\'s own folder', async () => {
    prismaMock.folder.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.folder.findFirst.mockResolvedValue(folderRow({ name: 'Clients', diagrams: 3 }));

    const res = await request(server).patch('/api/folders/f1').send({ name: 'Clients' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'f1', name: 'Clients', diagramCount: 3 });
    // Scoped to the owner in the write itself, so there is no window between
    // checking whose folder it is and renaming it.
    expect(prismaMock.folder.updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', userId: 'u1' },
      data: { name: 'Clients' },
    });
  });

  it('answers 404 for a folder somebody else owns', async () => {
    prismaMock.folder.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(server).patch('/api/folders/theirs').send({ name: 'Mine now' });

    expect(res.status).toBe(404);
    expect(prismaMock.folder.findFirst).not.toHaveBeenCalled();
  });

  it('refuses an invalid name without touching the row', async () => {
    const res = await request(server).patch('/api/folders/f1').send({ name: '  ' });

    expect(res.status).toBe(400);
    expect(prismaMock.folder.updateMany).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/folders/:id', () => {
  it('deletes the caller\'s own folder', async () => {
    prismaMock.folder.deleteMany.mockResolvedValue({ count: 1 });

    const res = await request(server).delete('/api/folders/f1');

    expect(res.status).toBe(204);
    expect(prismaMock.folder.deleteMany).toHaveBeenCalledWith({
      where: { id: 'f1', userId: 'u1' },
    });
  });

  it('leaves the diagrams alone — they come back to the root by SET NULL', async () => {
    prismaMock.folder.deleteMany.mockResolvedValue({ count: 1 });

    await request(server).delete('/api/folders/f1');

    // The whole point of the foreign key: no route here rewrites a diagram, so
    // there is no path by which deleting a label deletes the work.
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
    expect(prismaMock.diagram.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.diagram.deleteMany).not.toHaveBeenCalled();
  });

  it('answers 404 for a folder somebody else owns', async () => {
    prismaMock.folder.deleteMany.mockResolvedValue({ count: 0 });

    const res = await request(server).delete('/api/folders/theirs');

    expect(res.status).toBe(404);
  });
});
