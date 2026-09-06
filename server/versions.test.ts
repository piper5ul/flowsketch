import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuthUser } from './types.js';
import { serveForFile } from './testServer.js';

// Retention can now delete image files (a snapshot may have been the last thing
// drawing one), so point the storage layer somewhere disposable.
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowsketch-versions-uploads-'));
process.env.UPLOAD_DIR = uploadDir;

const { prismaMock, authState } = vi.hoisted(() => ({
  prismaMock: {
    diagram: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    diagramVersion: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    image: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    diagramMember: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
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

const { apiRouter } = await import('./router.js');
const { DEFAULT_MAX_VERSIONS, DEFAULT_VERSION_INTERVAL_MS, RESTORE_SNAPSHOT_LABEL, maxVersions, versionIntervalMs } =
  await import('./versions.js');
const { imagePath } = await import('./storage.js');

// The version routes live inside `apiRouter`, so the harness mounts exactly
// what `index.ts` does — which is also what lets the recording tests drive the
// real `PUT` handler rather than the helper it calls.
const app = express();
app.use('/api', express.json({ limit: '5mb' }));
app.use('/api', apiRouter);
// One port for the whole file — see `testServer.ts`.
const server = await serveForFile(app);

/** Diagram JSON with `n` placeholder nodes, distinguishable between saves. */
function board(nodeIds: string[]) {
  return {
    nodes: nodeIds.map((id) => ({ id, type: 'shape', position: { x: 0, y: 0 }, data: {} })),
    edges: [],
  };
}

const BEFORE = board(['a']);
const AFTER = board(['a', 'b']);

/** Diagram JSON whose single node draws `/api/images/<imageId>`. */
function boardWithImage(imageId: string) {
  return {
    nodes: [{ id: 'n1', type: 'shape', position: { x: 0, y: 0 }, data: { imageSrc: `/api/images/${imageId}` } }],
    edges: [],
  };
}

/** The access-layer row for a diagram `u1` owns, with `data`/`title` selected. */
function ownedRow(over: object = {}) {
  return { id: 'd1', userId: 'u1', title: 'Mine', data: BEFORE, updatedAt: new Date(0), ...over };
}

/** The access-layer row for a member of `role` on someone else's diagram. */
function memberRow(role: 'editor' | 'viewer', over: object = {}) {
  return { id: 'd1', title: 'Theirs', data: BEFORE, updatedAt: new Date(0), ...over, userId: 'owner-user', members: [{ role }] };
}

/** A version row as `META_SELECT` reads it back. */
function versionRow(over: object = {}) {
  return {
    id: 'v1',
    createdAt: new Date('2026-09-06T10:00:00.000Z'),
    title: 'Mine',
    label: null,
    createdBy: { name: 'User One' },
    ...over,
  };
}

/** Nothing to prune: the newest `MAX_VERSIONS` are all there is. */
function nothingToPrune() {
  prismaMock.diagramVersion.findMany.mockResolvedValue([]);
  prismaMock.diagramVersion.deleteMany.mockResolvedValue({ count: 0 });
}

beforeEach(() => {
  vi.resetAllMocks();
  authState.user = testUser;
  prismaMock.diagram.update.mockResolvedValue({ id: 'd1', updatedAt: new Date(1) });
  prismaMock.diagramVersion.create.mockResolvedValue(versionRow());
  nothingToPrune();
});

afterEach(() => {
  delete process.env.VERSION_INTERVAL_MS;
  delete process.env.MAX_VERSIONS;
});

afterAll(() => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

describe('settings', () => {
  it('fall back to the defaults, and to them again for a value that is not a positive integer', () => {
    expect(versionIntervalMs()).toBe(DEFAULT_VERSION_INTERVAL_MS);
    expect(maxVersions()).toBe(DEFAULT_MAX_VERSIONS);

    process.env.VERSION_INTERVAL_MS = '60000';
    process.env.MAX_VERSIONS = '5';
    expect(versionIntervalMs()).toBe(60_000);
    expect(maxVersions()).toBe(5);

    // A misconfigured value must not turn into "snapshot every PUT" or
    // "keep nothing"; both fall back rather than being obeyed.
    for (const bad of ['0', '-1', 'ten', '1.5', '']) {
      process.env.VERSION_INTERVAL_MS = bad;
      process.env.MAX_VERSIONS = bad;
      expect(versionIntervalMs()).toBe(DEFAULT_VERSION_INTERVAL_MS);
      expect(maxVersions()).toBe(DEFAULT_MAX_VERSIONS);
    }
  });
});

describe('recording on PUT /api/diagrams/:id', () => {
  it('records the previous data on the first save that changes it', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(ownedRow());
    // No history yet.
    prismaMock.diagramVersion.findFirst.mockResolvedValue(null);

    await request(server).put('/api/diagrams/d1').send({ data: AFTER }).expect(200);

    expect(prismaMock.diagramVersion.create).toHaveBeenCalledWith({
      data: {
        diagramId: 'd1',
        // The state *before* the edit, so the history's first entry is the
        // board as it stood when someone started drawing on it.
        data: BEFORE,
        title: 'Mine',
        createdById: 'u1',
        label: null,
      },
      select: expect.objectContaining({ id: true, createdAt: true, title: true, label: true }),
    });
  });

  it('does not record a second time within the interval', async () => {
    process.env.VERSION_INTERVAL_MS = String(10 * 60 * 1000);
    prismaMock.diagram.findFirst.mockResolvedValue(ownedRow());
    prismaMock.diagramVersion.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 60_000) });

    await request(server).put('/api/diagrams/d1').send({ data: AFTER }).expect(200);

    // One snapshot per burst of editing, not one per autosave.
    expect(prismaMock.diagramVersion.create).not.toHaveBeenCalled();
  });

  it('records again once the interval has passed', async () => {
    process.env.VERSION_INTERVAL_MS = String(10 * 60 * 1000);
    prismaMock.diagram.findFirst.mockResolvedValue(ownedRow());
    prismaMock.diagramVersion.findFirst.mockResolvedValue({
      createdAt: new Date(Date.now() - 11 * 60 * 1000),
    });

    await request(server).put('/api/diagrams/d1').send({ data: AFTER }).expect(200);

    expect(prismaMock.diagramVersion.create).toHaveBeenCalledTimes(1);
  });

  it('records nothing when only the title, star or thumbnail changed', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', updatedAt: new Date(0), starred: false });

    await request(server).put('/api/diagrams/d1').send({ title: 'Renamed' }).expect(200);
    await request(server).put('/api/diagrams/d1').send({ starred: true }).expect(200);

    // A rename is not a revision of anything — and the handler does not even
    // read the previous JSON back for one.
    expect(prismaMock.diagramVersion.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.diagramVersion.create).not.toHaveBeenCalled();
  });

  it('prunes everything past MAX_VERSIONS, by id', async () => {
    process.env.MAX_VERSIONS = '2';
    prismaMock.diagram.findFirst.mockResolvedValue(ownedRow());
    prismaMock.diagramVersion.findFirst.mockResolvedValue(null);
    prismaMock.diagramVersion.findMany.mockResolvedValue([{ id: 'old1' }, { id: 'old2' }]);
    prismaMock.diagramVersion.deleteMany.mockResolvedValue({ count: 2 });

    await request(server).put('/api/diagrams/d1').send({ data: AFTER }).expect(200);

    // Read newest-first and skipped past the keepers, so what comes back is
    // exactly the surplus…
    expect(prismaMock.diagramVersion.findMany).toHaveBeenCalledWith({
      where: { diagramId: 'd1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 2,
      // `data` too: once the row is deleted nothing can say which images it
      // drew, and retention is the moment those can become garbage.
      select: { id: true, data: true },
    });
    // …and it is deleted by id, never by a timestamp cutoff that would have to
    // guess about rows sharing the boundary millisecond.
    expect(prismaMock.diagramVersion.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['old1', 'old2'] } },
    });
  });

  it('frees the images only the pruned versions were still drawing', async () => {
    process.env.MAX_VERSIONS = '1';
    prismaMock.diagram.findFirst.mockResolvedValue(ownedRow());
    prismaMock.diagramVersion.findFirst.mockResolvedValue(null);
    prismaMock.diagramVersion.findMany
      // The prune's own read: one surplus snapshot, and it draws `forgotten`.
      .mockResolvedValueOnce([{ id: 'old1', data: boardWithImage('forgotten') }])
      // The orphan scan that follows, once that row is gone: no history left.
      .mockResolvedValue([]);
    prismaMock.diagramVersion.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.diagram.findMany.mockResolvedValue([{ data: BEFORE }]);
    prismaMock.image.findMany.mockResolvedValue([{ id: 'forgotten', mime: 'image/png' }]);
    prismaMock.image.deleteMany.mockResolvedValue({ count: 1 });

    fs.mkdirSync(path.join(uploadDir, 'u1'), { recursive: true });
    const forgottenFile = imagePath('u1', 'forgotten', 'png');
    fs.writeFileSync(forgottenFile, 'x');

    await request(server).put('/api/diagrams/d1').send({ data: AFTER }).expect(200);

    // Scoped to the diagram's owner, not to whoever's edit triggered the prune.
    expect(prismaMock.image.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['forgotten'] }, userId: 'u1' },
    });
    expect(fs.existsSync(forgottenFile)).toBe(false);
    // Only after the surplus rows are gone, or they would count as live refs.
    expect(prismaMock.diagramVersion.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.image.findMany.mock.invocationCallOrder[0],
    );
  });

  it('keeps an image a surviving version still draws when another is pruned', async () => {
    process.env.MAX_VERSIONS = '1';
    prismaMock.diagram.findFirst.mockResolvedValue(ownedRow());
    prismaMock.diagramVersion.findFirst.mockResolvedValue(null);
    prismaMock.diagramVersion.findMany
      .mockResolvedValueOnce([{ id: 'old1', data: boardWithImage('still-used') }])
      // The snapshot that was kept draws it too, so it is not garbage.
      .mockResolvedValue([{ data: boardWithImage('still-used') }]);
    prismaMock.diagramVersion.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.diagram.findMany.mockResolvedValue([{ data: BEFORE }]);

    await request(server).put('/api/diagrams/d1').send({ data: AFTER }).expect(200);

    expect(prismaMock.image.findMany).not.toHaveBeenCalled();
    expect(prismaMock.image.deleteMany).not.toHaveBeenCalled();
  });

  it('still saves the edit when cleaning up after the prune fails', async () => {
    process.env.MAX_VERSIONS = '1';
    prismaMock.diagram.findFirst.mockResolvedValue(ownedRow());
    prismaMock.diagramVersion.findFirst.mockResolvedValue(null);
    prismaMock.diagramVersion.findMany.mockResolvedValueOnce([
      { id: 'old1', data: boardWithImage('boom') },
    ]);
    prismaMock.diagramVersion.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.diagram.findMany.mockRejectedValue(new Error('database on fire'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await request(server).put('/api/diagrams/d1').send({ data: AFTER }).expect(200);

    expect(prismaMock.diagram.update).toHaveBeenCalled();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('does not look for images when the pruned versions drew none', async () => {
    process.env.MAX_VERSIONS = '1';
    prismaMock.diagram.findFirst.mockResolvedValue(ownedRow());
    prismaMock.diagramVersion.findFirst.mockResolvedValue(null);
    prismaMock.diagramVersion.findMany.mockResolvedValueOnce([{ id: 'old1', data: BEFORE }]);
    prismaMock.diagramVersion.deleteMany.mockResolvedValue({ count: 1 });

    await request(server).put('/api/diagrams/d1').send({ data: AFTER }).expect(200);

    expect(prismaMock.diagram.findMany).not.toHaveBeenCalled();
  });

  it('still saves the edit when the snapshot fails', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(ownedRow());
    prismaMock.diagramVersion.findFirst.mockRejectedValue(new Error('history table is on fire'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await request(server).put('/api/diagrams/d1').send({ data: AFTER }).expect(200);

    expect(prismaMock.diagram.update).toHaveBeenCalled();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('still saves the edit when only retention fails', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(ownedRow());
    prismaMock.diagramVersion.findFirst.mockResolvedValue(null);
    prismaMock.diagramVersion.findMany.mockRejectedValue(new Error('nope'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await request(server).put('/api/diagrams/d1').send({ data: AFTER }).expect(200);

    expect(prismaMock.diagramVersion.create).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe('GET /api/diagrams/:id/versions', () => {
  it('lists newest first, without any bodies', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1' });
    prismaMock.diagramVersion.findMany.mockResolvedValue([
      versionRow({ id: 'v2', createdAt: new Date('2026-09-06T12:00:00.000Z'), label: 'Milestone' }),
      versionRow({ id: 'v1', createdAt: new Date('2026-09-06T10:00:00.000Z') }),
    ]);

    const res = await request(server).get('/api/diagrams/d1/versions').expect(200);

    expect(prismaMock.diagramVersion.findMany).toHaveBeenCalledWith({
      where: { diagramId: 'd1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: DEFAULT_MAX_VERSIONS,
      select: expect.not.objectContaining({ data: true }),
    });
    expect(res.body).toEqual([
      {
        id: 'v2',
        createdAt: '2026-09-06T12:00:00.000Z',
        title: 'Mine',
        label: 'Milestone',
        createdBy: { name: 'User One' },
      },
      {
        id: 'v1',
        createdAt: '2026-09-06T10:00:00.000Z',
        title: 'Mine',
        label: null,
        createdBy: { name: 'User One' },
      },
    ]);
  });

  it('omits createdBy when the author account is gone', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1' });
    prismaMock.diagramVersion.findMany.mockResolvedValue([versionRow({ createdBy: null })]);

    const res = await request(server).get('/api/diagrams/d1/versions').expect(200);

    expect(res.body[0]).not.toHaveProperty('createdBy');
  });

  it('is readable by a viewer', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('viewer'));
    prismaMock.diagramVersion.findMany.mockResolvedValue([]);
    await request(server).get('/api/diagrams/d1/versions').expect(200);
  });

  it('404s a diagram the caller cannot see at all', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    await request(server).get('/api/diagrams/d1/versions').expect(404);
    expect(prismaMock.diagramVersion.findMany).not.toHaveBeenCalled();
  });

  it('needs a session', async () => {
    authState.user = null;
    await request(server).get('/api/diagrams/d1/versions').expect(401);
    expect(prismaMock.diagram.findFirst).not.toHaveBeenCalled();
  });
});

describe('GET /api/diagrams/:id/versions/:versionId', () => {
  it('returns the version with its data', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1' });
    prismaMock.diagramVersion.findFirst.mockResolvedValue({ ...versionRow(), data: BEFORE });

    const res = await request(server).get('/api/diagrams/d1/versions/v1').expect(200);

    expect(res.body).toEqual({
      id: 'v1',
      createdAt: '2026-09-06T10:00:00.000Z',
      title: 'Mine',
      label: null,
      createdBy: { name: 'User One' },
      data: BEFORE,
    });
  });

  it("404s another diagram's version, scoping the lookup by diagramId", async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1' });
    prismaMock.diagramVersion.findFirst.mockResolvedValue(null);

    await request(server).get('/api/diagrams/d1/versions/someone-elses').expect(404);

    // The access check was for d1, so the version has to belong to d1 as well.
    expect(prismaMock.diagramVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'someone-elses', diagramId: 'd1' } }),
    );
  });

  it('is readable by a viewer', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('viewer'));
    prismaMock.diagramVersion.findFirst.mockResolvedValue({ ...versionRow(), data: BEFORE });
    await request(server).get('/api/diagrams/d1/versions/v1').expect(200);
  });
});

describe('POST /api/diagrams/:id/versions', () => {
  it('snapshots the current data with the label, whatever the interval says', async () => {
    process.env.VERSION_INTERVAL_MS = String(60 * 60 * 1000);
    prismaMock.diagram.findFirst.mockResolvedValue(ownedRow({ data: AFTER, title: 'Roadmap' }));
    prismaMock.diagramVersion.create.mockResolvedValue(versionRow({ label: 'Milestone', title: 'Roadmap' }));

    const res = await request(server)
      .post('/api/diagrams/d1/versions')
      .send({ label: 'Milestone' })
      .expect(201);

    expect(prismaMock.diagramVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { diagramId: 'd1', data: AFTER, title: 'Roadmap', createdById: 'u1', label: 'Milestone' },
      }),
    );
    // The user pressed the button, so the interval — which only exists to stop
    // autosave flooding the table — is never consulted.
    expect(prismaMock.diagramVersion.findFirst).not.toHaveBeenCalled();
    expect(res.body).toEqual({
      id: 'v1',
      createdAt: '2026-09-06T10:00:00.000Z',
      title: 'Roadmap',
      label: 'Milestone',
      createdBy: { name: 'User One' },
    });
  });

  it('accepts a request with no body at all as an unlabelled snapshot', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(ownedRow());

    await request(server).post('/api/diagrams/d1/versions').expect(201);

    expect(prismaMock.diagramVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ label: null }) }),
    );
  });

  it('rejects an over-long label and an unknown key before touching the row', async () => {
    await request(server).post('/api/diagrams/d1/versions').send({ label: 'x'.repeat(101) }).expect(400);
    await request(server).post('/api/diagrams/d1/versions').send({ labl: 'typo' }).expect(400);
    expect(prismaMock.diagram.findFirst).not.toHaveBeenCalled();
  });

  it('is allowed to an editor but not to a viewer', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor'));
    await request(server).post('/api/diagrams/d1/versions').send({}).expect(201);

    prismaMock.diagramVersion.create.mockClear();
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('viewer'));
    await request(server).post('/api/diagrams/d1/versions').send({}).expect(403);
    expect(prismaMock.diagramVersion.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/diagrams/:id/versions/:versionId/restore', () => {
  beforeEach(() => {
    prismaMock.diagram.findFirst.mockResolvedValue(ownedRow({ data: AFTER, title: 'Now' }));
    prismaMock.diagramVersion.findFirst.mockResolvedValue({ data: BEFORE, title: 'Then' });
    prismaMock.diagram.update.mockResolvedValue({
      id: 'd1',
      title: 'Then',
      data: BEFORE,
      updatedAt: new Date('2026-09-06T13:00:00.000Z'),
    });
  });

  it('snapshots what it replaces, then writes the version back', async () => {
    const res = await request(server).post('/api/diagrams/d1/versions/v1/restore').expect(200);

    expect(prismaMock.diagramVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { diagramId: 'd1', data: AFTER, title: 'Now', createdById: 'u1', label: RESTORE_SNAPSHOT_LABEL },
      }),
    );
    expect(prismaMock.diagram.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { data: BEFORE, title: 'Then' },
      select: { id: true, title: true, data: true, updatedAt: true },
    });
    // The safety copy is written *before* the row is overwritten, so a restore
    // is never the one edit that cannot be walked back.
    expect(prismaMock.diagramVersion.create.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.diagram.update.mock.invocationCallOrder[0],
    );
    // `updatedAt` is what lets the client's conflict guard advance rather than
    // 409 on its next autosave.
    expect(res.body).toEqual({
      id: 'd1',
      title: 'Then',
      data: BEFORE,
      updatedAt: '2026-09-06T13:00:00.000Z',
    });
    // The owner's share token is not part of a restore's answer.
    expect(res.body).not.toHaveProperty('shareToken');
  });

  it('is allowed to an editor', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor', { data: AFTER, title: 'Now' }));
    await request(server).post('/api/diagrams/d1/versions/v1/restore').expect(200);
  });

  it('refuses a viewer, who may look at the history but not rewrite the board', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('viewer'));

    await request(server).post('/api/diagrams/d1/versions/v1/restore').expect(403);

    expect(prismaMock.diagramVersion.create).not.toHaveBeenCalled();
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('404s a diagram the caller cannot see at all', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    await request(server).post('/api/diagrams/d1/versions/v1/restore').expect(404);
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it("404s a version id that belongs to another diagram, without writing anything", async () => {
    prismaMock.diagramVersion.findFirst.mockResolvedValue(null);

    await request(server).post('/api/diagrams/d1/versions/someone-elses/restore').expect(404);

    expect(prismaMock.diagramVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'someone-elses', diagramId: 'd1' } }),
    );
    expect(prismaMock.diagramVersion.create).not.toHaveBeenCalled();
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });
});
