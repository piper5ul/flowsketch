import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { prismaMock, authState } = vi.hoisted(() => ({
  prismaMock: {
    diagram: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  authState: { user: null as { id: string } | null },
}));

vi.mock('./db.js', () => ({ prisma: prismaMock }));

vi.mock('./middleware.js', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!authState.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    (req as express.Request & { user: { id: string } }).user = authState.user;
    next();
  },
}));

const { apiRouter } = await import('./router.js');

const app = express();
app.use('/api', express.json());
app.use('/api', apiRouter);

const owned = { id: 'd1', userId: 'u1', title: 'Mine', starred: false, data: { nodes: [], edges: [] } };

beforeEach(() => {
  vi.resetAllMocks();
  authState.user = { id: 'u1' };
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

  it('refuses to update a diagram the caller does not own', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    await request(app).put('/api/diagrams/d1').send({ title: 'Hijack' }).expect(404);
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
