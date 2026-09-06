import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { $queryRaw: vi.fn() },
}));

vi.mock('./db.js', () => ({ prisma: prismaMock }));

const { healthRouter } = await import('./health.js');

const app = express();
app.use('/api', healthRouter);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('GET /api/health', () => {
  it('answers without touching the database', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body).toEqual({ ok: true });
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('stays shallow for anything but an explicit deep flag', async () => {
    await request(app).get('/api/health?deep=0').expect(200);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('GET /api/health?deep=1', () => {
  it('reports the database as reachable when the query succeeds', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const res = await request(app).get('/api/health?deep=1').expect(200);
    expect(res.body).toEqual({ ok: true, db: true });
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('answers 503 when the database query rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    prismaMock.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const res = await request(app).get('/api/health?deep=1').expect(503);
    expect(res.body).toEqual({ ok: false, db: false });
  });
});
