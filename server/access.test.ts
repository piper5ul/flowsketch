import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { DiagramRole } from '../shared/types.js';
import { serveForTest } from './testServer.js';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { diagram: { findFirst: vi.fn() } },
}));

vi.mock('./db.js', () => ({ prisma: prismaMock }));

const { getDiagramAccess, requireDiagramRole, roleAtLeast } = await import('./access.js');

beforeEach(() => {
  vi.resetAllMocks();
});

describe('roleAtLeast', () => {
  it('orders owner above editor above viewer', () => {
    expect(roleAtLeast('owner', 'viewer')).toBe(true);
    expect(roleAtLeast('owner', 'editor')).toBe(true);
    expect(roleAtLeast('editor', 'viewer')).toBe(true);
    expect(roleAtLeast('editor', 'owner')).toBe(false);
    expect(roleAtLeast('viewer', 'editor')).toBe(false);
  });

  it('counts every role as at least itself', () => {
    for (const role of ['owner', 'editor', 'viewer'] as DiagramRole[]) {
      expect(roleAtLeast(role, role)).toBe(true);
    }
  });
});

describe('getDiagramAccess', () => {
  it('asks for the diagram under either claim, and reads the caller\'s member row alongside', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', members: [] });

    await getDiagramAccess('u1', 'd1', { id: true, title: true });

    expect(prismaMock.diagram.findFirst).toHaveBeenCalledWith({
      where: { id: 'd1', OR: [{ userId: 'u1' }, { members: { some: { userId: 'u1' } } }] },
      select: {
        id: true,
        title: true,
        userId: true,
        members: { where: { userId: 'u1' }, select: { role: true } },
      },
    });
  });

  it('calls the owner an owner, even with a member row of their own', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', members: [{ role: 'viewer' }] });
    const access = await getDiagramAccess('u1', 'd1', { id: true });
    expect(access?.role).toBe('owner');
  });

  it('reads an editor and a viewer from their member row', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'owner', members: [{ role: 'editor' }] });
    expect((await getDiagramAccess('u1', 'd1', { id: true }))?.role).toBe('editor');

    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'owner', members: [{ role: 'viewer' }] });
    expect((await getDiagramAccess('u1', 'd1', { id: true }))?.role).toBe('viewer');
  });

  it('is null for a diagram the query matched nothing for', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    expect(await getDiagramAccess('u1', 'd1', { id: true })).toBeNull();
  });

  it('is null for a role it does not recognise, rather than guessing a weaker one', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'owner', members: [{ role: 'admin' }] });
    expect(await getDiagramAccess('u1', 'd1', { id: true })).toBeNull();
  });

  it('is null when nothing says why the row matched', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'owner', members: [] });
    expect(await getDiagramAccess('u1', 'd1', { id: true })).toBeNull();
  });

  it('hands back the columns that were asked for', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', title: 'Plan', userId: 'u1', members: [] });
    const access = await getDiagramAccess('u1', 'd1', { id: true, title: true });
    expect(access?.diagram).toMatchObject({ id: 'd1', title: 'Plan' });
  });
});

describe('requireDiagramRole', () => {
  /**
   * A listening server for a one-route app that reports what the helper
   * decided. Built per case because `minimum` differs; one port per test
   * rather than one per request. See `testServer.ts`.
   */
  function serverRequiring(minimum: DiagramRole) {
    const app = express();
    app.get('/d/:id', (req, _res, next) => {
      req.user = { id: 'u1' } as NonNullable<typeof req.user>;
      next();
    });
    app.get('/d/:id', async (req, res) => {
      const access = await requireDiagramRole(req as express.Request<{ id: string }>, res, minimum, {
        id: true,
      });
      if (!access) return;
      res.json({ role: access.role });
    });
    return serveForTest(app);
  }

  it('lets a caller through whose role is strong enough', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'owner', members: [{ role: 'editor' }] });
    const res = await request(serverRequiring('viewer')).get('/d/d1').expect(200);
    expect(res.body).toEqual({ role: 'editor' });
  });

  it('404s a caller with no access at all, so the diagram stays unobservable', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    const res = await request(serverRequiring('viewer')).get('/d/d1').expect(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('403s a caller who can see it but may not do this to it', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'owner', members: [{ role: 'viewer' }] });
    const res = await request(serverRequiring('editor')).get('/d/d1').expect(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('403s an editor where ownership is required', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'owner', members: [{ role: 'editor' }] });
    await request(serverRequiring('owner')).get('/d/d1').expect(403);
  });
});
