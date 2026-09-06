import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuthUser } from './types.js';
import { serveForFile } from './testServer.js';

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowsketch-sharing-uploads-'));
process.env.UPLOAD_DIR = uploadDir;

const { prismaMock, authState } = vi.hoisted(() => ({
  prismaMock: {
    diagram: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    diagramMember: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    image: {
      findUnique: vi.fn(),
    },
    diagramImage: {
      findFirst: vi.fn(),
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

const { sharingRouter, sharedRouter, createShareToken } = await import('./sharing.js');
const { imagePath } = await import('./storage.js');

// Wired the way `index.ts` does it: the token routes ahead of, and outside,
// the authenticated ones.
const app = express();
app.use('/api', express.json());
app.use('/api/shared', sharedRouter);
app.use('/api', (req, res, next) => {
  if (!authState.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.user = authState.user;
  next();
});
app.use('/api', sharingRouter);
// One port for the whole file — see `testServer.ts`.
const server = await serveForFile(app);

/** A real, valid 1x1 transparent PNG. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** The access-layer row for a member of `role` on someone else's diagram. */
function memberRow(role: 'editor' | 'viewer', row: object = { id: 'd1' }) {
  return { ...row, userId: 'owner-user', members: [{ role }] };
}

afterAll(() => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.resetAllMocks();
  authState.user = testUser;
});

describe('createShareToken', () => {
  it('is at least 24 URL-safe characters, and never the same twice', () => {
    const a = createShareToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{24,}$/);
    expect(a).not.toBe(createShareToken());
  });
});

describe('auth gate', () => {
  it('rejects the owner-side sharing routes without a session', async () => {
    authState.user = null;
    await request(server).post('/api/diagrams/d1/share').expect(401);
    await request(server).delete('/api/diagrams/d1/share').expect(401);
    await request(server).get('/api/diagrams/d1/members').expect(401);
    await request(server).post('/api/diagrams/d1/members').send({ email: 'a@b.test', role: 'viewer' }).expect(401);
    await request(server).delete('/api/diagrams/d1/members/u2').expect(401);
    expect(prismaMock.diagram.findFirst).not.toHaveBeenCalled();
  });

  it('serves the token routes with no session at all', async () => {
    authState.user = null;
    prismaMock.diagram.findUnique.mockResolvedValue({
      id: 'd1',
      title: 'Public',
      data: { nodes: [], edges: [] },
      updatedAt: new Date(0),
    });
    const res = await request(server).get('/api/shared/tok123').expect(200);
    expect(res.body).toEqual({
      id: 'd1',
      title: 'Public',
      data: { nodes: [], edges: [] },
      updatedAt: new Date(0).toISOString(),
    });
  });
});

describe('POST /api/diagrams/:id/share', () => {
  it('mints a token, stores it, and answers with the path the client routes on', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', shareToken: null });
    prismaMock.diagram.update.mockResolvedValue({ id: 'd1' });

    const res = await request(server).post('/api/diagrams/d1/share').expect(200);

    expect(res.body.shareToken).toMatch(/^[A-Za-z0-9_-]{24,}$/);
    expect(res.body.url).toBe(`/s/${res.body.shareToken}`);
    expect(prismaMock.diagram.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { shareToken: res.body.shareToken },
    });
  });

  it('returns the token already there rather than replacing it', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', shareToken: 'already-shared-token' });

    const res = await request(server).post('/api/diagrams/d1/share').expect(200);

    expect(res.body).toEqual({ shareToken: 'already-shared-token', url: '/s/already-shared-token' });
    // A URL the user has already pasted somewhere must keep working.
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('is owner-only: an editor may not hand the diagram to the internet', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor', { id: 'd1', shareToken: null }));
    await request(server).post('/api/diagrams/d1/share').expect(403);
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('404s a diagram the caller has no access to', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    await request(server).post('/api/diagrams/d1/share').expect(404);
  });
});

describe('DELETE /api/diagrams/:id/share', () => {
  it('clears the token', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1' });
    prismaMock.diagram.update.mockResolvedValue({ id: 'd1' });

    await request(server).delete('/api/diagrams/d1/share').expect(204);

    expect(prismaMock.diagram.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { shareToken: null },
    });
  });

  it('is owner-only', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor'));
    await request(server).delete('/api/diagrams/d1/share').expect(403);
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });
});

describe('GET /api/shared/:token', () => {
  it('looks the diagram up by token alone and returns only the readable fields', async () => {
    prismaMock.diagram.findUnique.mockResolvedValue({
      id: 'd1',
      title: 'Public',
      data: { nodes: [{ id: 'n1' }], edges: [] },
      updatedAt: new Date('2026-09-05T10:00:00.000Z'),
    });

    const res = await request(server).get('/api/shared/tok123').expect(200);

    expect(prismaMock.diagram.findUnique).toHaveBeenCalledWith({
      where: { shareToken: 'tok123' },
      select: { id: true, title: true, data: true, updatedAt: true },
    });
    // No owner, no members, and above all no shareToken echoed back.
    expect(Object.keys(res.body).sort()).toEqual(['data', 'id', 'title', 'updatedAt']);
  });

  it('404s a token that has been revoked, indistinguishably from one that never existed', async () => {
    prismaMock.diagram.findUnique.mockResolvedValue(null);
    await request(server).get('/api/shared/stale-token').expect(404);
  });
});

describe('GET /api/shared/:token/images/:imageId', () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(uploadDir, 'owner-user'), { recursive: true });
    fs.writeFileSync(imagePath('owner-user', 'drawn', 'png'), PNG_1X1);
    fs.writeFileSync(imagePath('owner-user', 'other', 'png'), PNG_1X1);
  });

  it('serves an image the shared diagram draws, unauthenticated', async () => {
    authState.user = null;
    prismaMock.diagramImage.findFirst.mockResolvedValue({ diagramId: 'd1' });
    prismaMock.image.findUnique.mockResolvedValue({
      id: 'drawn',
      userId: 'owner-user',
      mime: 'image/png',
      size: PNG_1X1.length,
    });

    const res = await request(server).get('/api/shared/tok123/images/drawn').expect(200);

    expect(res.headers['content-type']).toBe('image/png');
    expect(Buffer.from(res.body).equals(PNG_1X1)).toBe(true);
    // The allow-list is the index, not the diagram's JSON: the board is never
    // loaded to serve one picture out of it.
    expect(prismaMock.diagramImage.findFirst).toHaveBeenCalledWith({
      where: { imageId: 'drawn', diagram: { shareToken: 'tok123' } },
      select: { diagramId: true },
    });
    expect(prismaMock.diagram.findUnique).not.toHaveBeenCalled();
  });

  it('404s an image the diagram does not reference, so a token cannot walk the owner\'s uploads', async () => {
    prismaMock.diagramImage.findFirst.mockResolvedValue(null);

    await request(server).get('/api/shared/tok123/images/other').expect(404);

    // Never even looked the row up: what the diagram references is the allow-list.
    expect(prismaMock.image.findUnique).not.toHaveBeenCalled();
  });

  it('404s every image once the token is revoked', async () => {
    // No diagram answers to the token, so no index row joins to one either.
    prismaMock.diagramImage.findFirst.mockResolvedValue(null);
    await request(server).get('/api/shared/stale-token/images/drawn').expect(404);
    expect(prismaMock.image.findUnique).not.toHaveBeenCalled();
  });

  it('404s when the row is referenced but its file is gone', async () => {
    prismaMock.diagramImage.findFirst.mockResolvedValue({ diagramId: 'd1' });
    prismaMock.image.findUnique.mockResolvedValue({
      id: 'ghost',
      userId: 'owner-user',
      mime: 'image/png',
      size: 10,
    });
    await request(server).get('/api/shared/tok123/images/ghost').expect(404);
  });
});

describe('GET /api/diagrams/:id/members', () => {
  const listed = {
    user: { id: 'u1', name: 'User One', email: 'u1@example.test' },
    members: [
      { role: 'editor', user: { id: 'u2', name: 'User Two', email: 'u2@example.test' } },
      { role: 'viewer', user: { id: 'u3', name: 'User Three', email: 'u3@example.test' } },
    ],
  };

  it('lists everyone with access, the owner first', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1' });
    prismaMock.diagram.findUnique.mockResolvedValue(listed);

    const res = await request(server).get('/api/diagrams/d1/members').expect(200);

    expect(res.body).toEqual([
      { userId: 'u1', name: 'User One', email: 'u1@example.test', role: 'owner' },
      { userId: 'u2', name: 'User Two', email: 'u2@example.test', role: 'editor' },
      { userId: 'u3', name: 'User Three', email: 'u3@example.test', role: 'viewer' },
    ]);
  });

  it('is readable by an editor', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor'));
    prismaMock.diagram.findUnique.mockResolvedValue(listed);
    await request(server).get('/api/diagrams/d1/members').expect(200);
  });

  it('is not readable by a viewer', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('viewer'));
    await request(server).get('/api/diagrams/d1/members').expect(403);
    expect(prismaMock.diagram.findUnique).not.toHaveBeenCalled();
  });
});

describe('POST /api/diagrams/:id/members', () => {
  beforeEach(() => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1' });
  });

  it('invites an existing account and returns the new member', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2', name: 'User Two', email: 'u2@example.test' });
    prismaMock.diagramMember.upsert.mockResolvedValue({ id: 'm1' });

    const res = await request(server)
      .post('/api/diagrams/d1/members')
      .send({ email: 'u2@example.test', role: 'editor' })
      .expect(201);

    expect(res.body).toEqual({ userId: 'u2', name: 'User Two', email: 'u2@example.test', role: 'editor' });
    expect(prismaMock.diagramMember.upsert).toHaveBeenCalledWith({
      where: { diagramId_userId: { diagramId: 'd1', userId: 'u2' } },
      create: { diagramId: 'd1', userId: 'u2', role: 'editor' },
      update: { role: 'editor' },
    });
  });

  it('upserts, so re-inviting someone changes their role instead of failing', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2', name: 'User Two', email: 'u2@example.test' });
    prismaMock.diagramMember.upsert.mockResolvedValue({ id: 'm1' });

    await request(server).post('/api/diagrams/d1/members').send({ email: 'u2@example.test', role: 'viewer' }).expect(201);

    expect(prismaMock.diagramMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { role: 'viewer' } }),
    );
  });

  it('looks the address up lower-cased and trimmed, as accounts store it', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2', name: 'User Two', email: 'u2@example.test' });
    prismaMock.diagramMember.upsert.mockResolvedValue({ id: 'm1' });

    await request(server)
      .post('/api/diagrams/d1/members')
      .send({ email: '  U2@Example.Test ', role: 'viewer' })
      .expect(201);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'u2@example.test' } }),
    );
  });

  it('404s an address with no account behind it, with a message the dialog can show', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(server)
      .post('/api/diagrams/d1/members')
      .send({ email: 'nobody@example.test', role: 'viewer' })
      .expect(404);

    expect(res.body).toEqual({ error: 'No account with that email' });
    expect(prismaMock.diagramMember.upsert).not.toHaveBeenCalled();
  });

  it('refuses to invite the owner to their own diagram', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', name: 'User One', email: 'u1@example.test' });
    await request(server).post('/api/diagrams/d1/members').send({ email: 'u1@example.test', role: 'editor' }).expect(400);
    expect(prismaMock.diagramMember.upsert).not.toHaveBeenCalled();
  });

  it('rejects a malformed address and an unknown role before any lookup', async () => {
    await request(server).post('/api/diagrams/d1/members').send({ email: 'not-an-email', role: 'viewer' }).expect(400);
    await request(server).post('/api/diagrams/d1/members').send({ email: 'u2@example.test', role: 'owner' }).expect(400);
    await request(server).post('/api/diagrams/d1/members').send({ email: 'u2@example.test' }).expect(400);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('is owner-only: an editor cannot invite anyone', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor'));
    await request(server).post('/api/diagrams/d1/members').send({ email: 'u3@example.test', role: 'editor' }).expect(403);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/diagrams/:id/members/:userId', () => {
  it('lets the owner remove a member', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1' });
    prismaMock.diagramMember.deleteMany.mockResolvedValue({ count: 1 });

    await request(server).delete('/api/diagrams/d1/members/u2').expect(204);

    expect(prismaMock.diagramMember.deleteMany).toHaveBeenCalledWith({
      where: { diagramId: 'd1', userId: 'u2' },
    });
  });

  it('is a 204 even when there was no such member, so removing twice is safe', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1' });
    prismaMock.diagramMember.deleteMany.mockResolvedValue({ count: 0 });
    await request(server).delete('/api/diagrams/d1/members/nobody').expect(204);
  });

  it('lets a viewer remove themselves', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('viewer'));
    prismaMock.diagramMember.deleteMany.mockResolvedValue({ count: 1 });

    await request(server).delete('/api/diagrams/d1/members/u1').expect(204);

    expect(prismaMock.diagramMember.deleteMany).toHaveBeenCalledWith({
      where: { diagramId: 'd1', userId: 'u1' },
    });
  });

  it('refuses one member removing another', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor'));
    await request(server).delete('/api/diagrams/d1/members/u3').expect(403);
    expect(prismaMock.diagramMember.deleteMany).not.toHaveBeenCalled();
  });

  it('404s for a diagram the caller cannot see at all', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    await request(server).delete('/api/diagrams/d1/members/u1').expect(404);
    expect(prismaMock.diagramMember.deleteMany).not.toHaveBeenCalled();
  });
});
