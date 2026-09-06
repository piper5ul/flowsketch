import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuthUser } from './types.js';
import { serveForFile } from './testServer.js';

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowsketch-uploads-'));
process.env.UPLOAD_DIR = uploadDir;

const { prismaMock, authState } = vi.hoisted(() => ({
  prismaMock: {
    image: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    diagram: {
      findMany: vi.fn(),
    },
    diagramImage: {
      findFirst: vi.fn(),
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

const { imagesRouter } = await import('./images.js');
const { imagePath } = await import('./storage.js');

const app = express();
app.use('/api/images', imagesRouter);
// One port for the whole file — see `testServer.ts`.
const server = await serveForFile(app);

/** A real, valid 1x1 transparent PNG. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

afterAll(() => {
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.resetAllMocks();
  authState.user = testUser;
});

describe('auth gate', () => {
  it('rejects every image route without a session', async () => {
    authState.user = null;
    await request(server).post('/api/images').set('Content-Type', 'image/png').send(PNG_1X1).expect(401);
    await request(server).get('/api/images/i1').expect(401);
    await request(server).delete('/api/images/i1').expect(401);
    expect(prismaMock.image.create).not.toHaveBeenCalled();
    expect(prismaMock.image.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.image.findUnique).not.toHaveBeenCalled();
  });
});

describe('POST /api/images', () => {
  it('stores a PNG on disk and returns its metadata', async () => {
    prismaMock.image.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 'i1', ...data }));

    const res = await request(server)
      .post('/api/images')
      .set('Content-Type', 'image/png')
      .send(PNG_1X1)
      .expect(201);

    expect(res.body).toEqual({
      id: 'i1',
      url: '/api/images/i1',
      mime: 'image/png',
      size: PNG_1X1.length,
      width: 1,
      height: 1,
    });
    expect(prismaMock.image.create).toHaveBeenCalledWith({
      data: { userId: 'u1', mime: 'image/png', size: PNG_1X1.length, width: 1, height: 1 },
    });

    const stored = imagePath('u1', 'i1', 'png');
    expect(fs.existsSync(stored)).toBe(true);
    expect(fs.readFileSync(stored).equals(PNG_1X1)).toBe(true);
  });

  it('415s a body whose bytes are not a supported image, whatever the Content-Type claims', async () => {
    await request(server)
      .post('/api/images')
      .set('Content-Type', 'image/png')
      .send(Buffer.from('this is plain text pretending to be a png', 'utf8'))
      .expect(415);
    expect(prismaMock.image.create).not.toHaveBeenCalled();
  });

  it('415s a non-image Content-Type, which the raw parser never reads', async () => {
    await request(server).post('/api/images').set('Content-Type', 'text/plain').send('hello').expect(415);
    expect(prismaMock.image.create).not.toHaveBeenCalled();
  });

  it('415s an empty body', async () => {
    await request(server).post('/api/images').set('Content-Type', 'image/png').send(Buffer.alloc(0)).expect(415);
    expect(prismaMock.image.create).not.toHaveBeenCalled();
  });

  it('413s an oversized body as JSON, not an HTML error page', async () => {
    const res = await request(server)
      .post('/api/images')
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(11 * 1024 * 1024))
      .expect(413);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toHaveProperty('error');
    expect(prismaMock.image.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/images/:id', () => {
  it('streams the bytes to the owner with an immutable private cache header', async () => {
    fs.mkdirSync(path.join(uploadDir, 'u1'), { recursive: true });
    fs.writeFileSync(imagePath('u1', 'get1', 'png'), PNG_1X1);
    prismaMock.image.findUnique.mockResolvedValue({
      id: 'get1',
      userId: 'u1',
      mime: 'image/png',
      size: PNG_1X1.length,
    });

    const res = await request(server).get('/api/images/get1').expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(Buffer.from(res.body).equals(PNG_1X1)).toBe(true);
    expect(prismaMock.image.findUnique).toHaveBeenCalledWith({ where: { id: 'get1' } });
    // The owner is answered from the row alone; the index is not even consulted.
    expect(prismaMock.diagramImage.findFirst).not.toHaveBeenCalled();
  });

  it('404s an image that does not exist', async () => {
    prismaMock.image.findUnique.mockResolvedValue(null);
    await request(server).get('/api/images/nope').expect(404);
  });

  it('404s another user\'s image when no diagram shared with the caller draws it', async () => {
    fs.mkdirSync(path.join(uploadDir, 'u2'), { recursive: true });
    fs.writeFileSync(imagePath('u2', 'theirs', 'png'), PNG_1X1);
    prismaMock.image.findUnique.mockResolvedValue({
      id: 'theirs',
      userId: 'u2',
      mime: 'image/png',
      size: PNG_1X1.length,
    });
    // No diagram shared with the caller has an index row for this image.
    prismaMock.diagramImage.findFirst.mockResolvedValue(null);

    await request(server).get('/api/images/theirs').expect(404);

    expect(prismaMock.diagramImage.findFirst).toHaveBeenCalledWith({
      where: { imageId: 'theirs', diagram: { members: { some: { userId: 'u1' } } } },
      select: { diagramId: true },
    });
    // Answered from the index: no diagram's JSON is read to find out.
    expect(prismaMock.diagram.findMany).not.toHaveBeenCalled();
  });

  it('serves another user\'s image when a diagram shared with the caller draws it', async () => {
    fs.mkdirSync(path.join(uploadDir, 'u2'), { recursive: true });
    fs.writeFileSync(imagePath('u2', 'shared-pic', 'png'), PNG_1X1);
    prismaMock.image.findUnique.mockResolvedValue({
      id: 'shared-pic',
      userId: 'u2',
      mime: 'image/png',
      size: PNG_1X1.length,
    });
    prismaMock.diagramImage.findFirst.mockResolvedValue({ diagramId: 'd9' });

    const res = await request(server).get('/api/images/shared-pic').expect(200);
    // Read from the owner's directory, not the viewer's.
    expect(Buffer.from(res.body).equals(PNG_1X1)).toBe(true);
    expect(prismaMock.diagram.findMany).not.toHaveBeenCalled();
  });

  it('404s when the row exists but the file is gone', async () => {
    prismaMock.image.findUnique.mockResolvedValue({
      id: 'ghost',
      userId: 'u1',
      mime: 'image/png',
      size: 10,
    });
    await request(server).get('/api/images/ghost').expect(404);
  });
});

describe('DELETE /api/images/:id', () => {
  it('removes the row and the file, and returns 204', async () => {
    fs.mkdirSync(path.join(uploadDir, 'u1'), { recursive: true });
    const stored = imagePath('u1', 'del1', 'png');
    fs.writeFileSync(stored, PNG_1X1);
    prismaMock.image.findFirst.mockResolvedValue({ id: 'del1', userId: 'u1', mime: 'image/png' });
    prismaMock.image.delete.mockResolvedValue({ id: 'del1' });

    await request(server).delete('/api/images/del1').expect(204);
    expect(prismaMock.image.delete).toHaveBeenCalledWith({ where: { id: 'del1' } });
    expect(fs.existsSync(stored)).toBe(false);
  });

  it('refuses to delete an image the caller does not own', async () => {
    prismaMock.image.findFirst.mockResolvedValue(null);
    await request(server).delete('/api/images/someone-elses').expect(404);
    expect(prismaMock.image.delete).not.toHaveBeenCalled();
  });
});
