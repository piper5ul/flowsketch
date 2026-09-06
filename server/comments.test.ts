import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { AuthUser } from './types.js';
import { serveForFile } from './testServer.js';
import { MAX_COMMENT_CHARS } from '../shared/types.js';

const { prismaMock, authState } = vi.hoisted(() => ({
  prismaMock: {
    diagram: {
      findFirst: vi.fn(),
    },
    commentThread: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    comment: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
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

const { commentsRouter } = await import('./comments.js');

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
app.use('/api', commentsRouter);
// One port for the whole file — see `testServer.ts`.
const server = serveForFile(app);

/** The access-layer row for a diagram `u1` owns. */
const OWNED = { id: 'd1', userId: 'u1' };

/** The access-layer row for a member of `role` on someone else's diagram. */
function memberRow(role: 'editor' | 'viewer') {
  return { id: 'd1', userId: 'owner-user', members: [{ role }] };
}

const AUTHOR = { id: 'u1', name: 'User One' };

/** A comment row as `COMMENT_SELECT` reads it back. */
function commentRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'c1',
    body: 'Looks good',
    createdAt: new Date('2026-09-06T10:00:00.000Z'),
    editedAt: null,
    author: AUTHOR,
    ...over,
  };
}

/** A thread row as `THREAD_SELECT` reads it back. */
function threadRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 't1',
    nodeId: 'n1',
    x: null,
    y: null,
    resolved: false,
    createdAt: new Date('2026-09-06T10:00:00.000Z'),
    createdBy: AUTHOR,
    comments: [commentRow()],
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  authState.user = testUser;
});

describe('auth gate', () => {
  it('rejects every comment route without a session', async () => {
    authState.user = null;
    await request(server).get('/api/diagrams/d1/threads').expect(401);
    await request(server).post('/api/diagrams/d1/threads').send({ nodeId: 'n1', body: 'hi' }).expect(401);
    await request(server).post('/api/diagrams/d1/threads/t1/comments').send({ body: 'hi' }).expect(401);
    await request(server).patch('/api/diagrams/d1/threads/t1').send({ resolved: true }).expect(401);
    await request(server).patch('/api/diagrams/d1/threads/t1/comments/c1').send({ body: 'hi' }).expect(401);
    await request(server).delete('/api/diagrams/d1/threads/t1/comments/c1').expect(401);
    await request(server).delete('/api/diagrams/d1/threads/t1').expect(401);
    expect(prismaMock.diagram.findFirst).not.toHaveBeenCalled();
  });
});

describe('GET /api/diagrams/:id/threads', () => {
  it('returns each thread with its conversation, newest thread first and comments oldest first', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    prismaMock.commentThread.findMany.mockResolvedValue([threadRow()]);

    const res = await request(server).get('/api/diagrams/d1/threads').expect(200);

    expect(res.body).toEqual([
      {
        id: 't1',
        nodeId: 'n1',
        x: null,
        y: null,
        resolved: false,
        createdAt: '2026-09-06T10:00:00.000Z',
        createdBy: AUTHOR,
        comments: [
          {
            id: 'c1',
            body: 'Looks good',
            createdAt: '2026-09-06T10:00:00.000Z',
            editedAt: null,
            author: AUTHOR,
          },
        ],
      },
    ]);
    const args = prismaMock.commentThread.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.select.comments.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('lists the open threads by default', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    prismaMock.commentThread.findMany.mockResolvedValue([]);

    await request(server).get('/api/diagrams/d1/threads').expect(200);

    expect(prismaMock.commentThread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { diagramId: 'd1', resolved: false } }),
    );
  });

  it('lists the resolved ones on ?resolved=resolved', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    prismaMock.commentThread.findMany.mockResolvedValue([]);

    await request(server).get('/api/diagrams/d1/threads?resolved=resolved').expect(200);

    expect(prismaMock.commentThread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { diagramId: 'd1', resolved: true } }),
    );
  });

  it('drops the filter entirely on ?resolved=all', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    prismaMock.commentThread.findMany.mockResolvedValue([]);

    await request(server).get('/api/diagrams/d1/threads?resolved=all').expect(200);

    expect(prismaMock.commentThread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { diagramId: 'd1' } }),
    );
  });

  it('reads an unrecognised filter as open rather than refusing it', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    prismaMock.commentThread.findMany.mockResolvedValue([]);

    await request(server).get('/api/diagrams/d1/threads?resolved=maybe').expect(200);

    expect(prismaMock.commentThread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { diagramId: 'd1', resolved: false } }),
    );
  });

  it('is readable by a viewer — reviewing is the point of being invited', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('viewer'));
    prismaMock.commentThread.findMany.mockResolvedValue([]);
    await request(server).get('/api/diagrams/d1/threads').expect(200);
  });

  it('404s a diagram the caller is not a member of', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    await request(server).get('/api/diagrams/d1/threads').expect(404);
    expect(prismaMock.commentThread.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/diagrams/:id/threads', () => {
  beforeEach(() => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
  });

  it('anchors a thread to a node, writing its first comment in the same create', async () => {
    prismaMock.commentThread.create.mockResolvedValue(threadRow());

    const res = await request(server)
      .post('/api/diagrams/d1/threads')
      .send({ nodeId: 'n1', body: 'Looks good' })
      .expect(201);

    expect(res.body.id).toBe('t1');
    expect(res.body.comments).toHaveLength(1);
    expect(prismaMock.commentThread.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          diagramId: 'd1',
          nodeId: 'n1',
          x: null,
          y: null,
          createdById: 'u1',
          comments: { create: { authorId: 'u1', body: 'Looks good' } },
        },
      }),
    );
  });

  it('anchors a thread to a canvas position instead', async () => {
    prismaMock.commentThread.create.mockResolvedValue(
      threadRow({ nodeId: null, x: 120, y: -40 }),
    );

    const res = await request(server)
      .post('/api/diagrams/d1/threads')
      .send({ x: 120, y: -40, body: 'Over here' })
      .expect(201);

    expect(res.body).toMatchObject({ nodeId: null, x: 120, y: -40 });
    expect(prismaMock.commentThread.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nodeId: null, x: 120, y: -40 }),
      }),
    );
  });

  it('400s a thread with no anchor at all', async () => {
    await request(server).post('/api/diagrams/d1/threads').send({ body: 'Where?' }).expect(400);
    expect(prismaMock.commentThread.create).not.toHaveBeenCalled();
  });

  it('400s a thread anchored to both a node and a position', async () => {
    await request(server)
      .post('/api/diagrams/d1/threads')
      .send({ nodeId: 'n1', x: 1, y: 2, body: 'Both?' })
      .expect(400);
    expect(prismaMock.commentThread.create).not.toHaveBeenCalled();
  });

  it('400s half a position — one coordinate is not a point', async () => {
    await request(server).post('/api/diagrams/d1/threads').send({ x: 1, body: 'Half' }).expect(400);
    expect(prismaMock.commentThread.create).not.toHaveBeenCalled();
  });

  it('400s a body past the character ceiling', async () => {
    await request(server)
      .post('/api/diagrams/d1/threads')
      .send({ nodeId: 'n1', body: 'x'.repeat(MAX_COMMENT_CHARS + 1) })
      .expect(400);
    expect(prismaMock.commentThread.create).not.toHaveBeenCalled();
  });

  it('400s a body that is only whitespace', async () => {
    await request(server).post('/api/diagrams/d1/threads').send({ nodeId: 'n1', body: '   ' }).expect(400);
    expect(prismaMock.commentThread.create).not.toHaveBeenCalled();
  });

  it('lets a viewer start a thread', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('viewer'));
    prismaMock.commentThread.create.mockResolvedValue(threadRow());
    await request(server).post('/api/diagrams/d1/threads').send({ nodeId: 'n1', body: 'A note' }).expect(201);
  });

  it('404s a diagram the caller is not a member of', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(null);
    await request(server).post('/api/diagrams/d1/threads').send({ nodeId: 'n1', body: 'A note' }).expect(404);
    expect(prismaMock.commentThread.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/diagrams/:id/threads/:threadId/comments', () => {
  it('lets a viewer reply to a thread', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('viewer'));
    prismaMock.commentThread.findFirst.mockResolvedValue({ id: 't1' });
    prismaMock.comment.create.mockResolvedValue(commentRow({ id: 'c2', body: 'Agreed' }));

    const res = await request(server)
      .post('/api/diagrams/d1/threads/t1/comments')
      .send({ body: 'Agreed' })
      .expect(201);

    expect(res.body).toMatchObject({ id: 'c2', body: 'Agreed', editedAt: null, author: AUTHOR });
    expect(prismaMock.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { threadId: 't1', authorId: 'u1', body: 'Agreed' } }),
    );
  });

  it('404s a thread id belonging to another diagram', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    prismaMock.commentThread.findFirst.mockResolvedValue(null);

    await request(server).post('/api/diagrams/d1/threads/foreign/comments').send({ body: 'Hi' }).expect(404);

    // The lookup is scoped by the diagram, which is what makes it a 404.
    expect(prismaMock.commentThread.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'foreign', diagramId: 'd1' } }),
    );
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it('400s a body past the character ceiling', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    await request(server)
      .post('/api/diagrams/d1/threads/t1/comments')
      .send({ body: 'x'.repeat(MAX_COMMENT_CHARS + 1) })
      .expect(400);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/diagrams/:id/threads/:threadId', () => {
  it('lets an editor resolve a thread somebody else opened', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor'));
    prismaMock.commentThread.findFirst.mockResolvedValue({ id: 't1', createdById: 'someone-else' });
    prismaMock.commentThread.update.mockResolvedValue(threadRow({ resolved: true }));

    const res = await request(server)
      .patch('/api/diagrams/d1/threads/t1')
      .send({ resolved: true })
      .expect(200);

    expect(res.body.resolved).toBe(true);
    expect(prismaMock.commentThread.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: { resolved: true } }),
    );
  });

  it('lets a viewer resolve the thread they opened themselves', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('viewer'));
    prismaMock.commentThread.findFirst.mockResolvedValue({ id: 't1', createdById: 'u1' });
    prismaMock.commentThread.update.mockResolvedValue(threadRow({ resolved: true }));

    await request(server).patch('/api/diagrams/d1/threads/t1').send({ resolved: true }).expect(200);
  });

  it('refuses a viewer resolving somebody else\'s thread', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('viewer'));
    prismaMock.commentThread.findFirst.mockResolvedValue({ id: 't1', createdById: 'someone-else' });

    await request(server).patch('/api/diagrams/d1/threads/t1').send({ resolved: true }).expect(403);

    expect(prismaMock.commentThread.update).not.toHaveBeenCalled();
  });

  it('reopens a thread through the same route', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    prismaMock.commentThread.findFirst.mockResolvedValue({ id: 't1', createdById: 'u1' });
    prismaMock.commentThread.update.mockResolvedValue(threadRow({ resolved: false }));

    await request(server).patch('/api/diagrams/d1/threads/t1').send({ resolved: false }).expect(200);

    expect(prismaMock.commentThread.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { resolved: false } }),
    );
  });

  it('400s a body that does not say which way', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    await request(server).patch('/api/diagrams/d1/threads/t1').send({}).expect(400);
    expect(prismaMock.commentThread.findFirst).not.toHaveBeenCalled();
  });

  it('404s a thread id belonging to another diagram', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    prismaMock.commentThread.findFirst.mockResolvedValue(null);
    await request(server).patch('/api/diagrams/d1/threads/foreign').send({ resolved: true }).expect(404);
  });
});

describe('PATCH /api/diagrams/:id/threads/:threadId/comments/:commentId', () => {
  it('lets the author rewrite their own comment and stamps editedAt', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('viewer'));
    prismaMock.comment.findFirst.mockResolvedValue({ id: 'c1', authorId: 'u1' });
    prismaMock.comment.update.mockResolvedValue(
      commentRow({ body: 'Rewritten', editedAt: new Date('2026-09-06T11:00:00.000Z') }),
    );

    const res = await request(server)
      .patch('/api/diagrams/d1/threads/t1/comments/c1')
      .send({ body: 'Rewritten' })
      .expect(200);

    expect(res.body).toMatchObject({ body: 'Rewritten', editedAt: '2026-09-06T11:00:00.000Z' });
    const args = prismaMock.comment.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'c1' });
    expect(args.data.body).toBe('Rewritten');
    expect(args.data.editedAt).toBeInstanceOf(Date);
  });

  it('refuses to let anyone rewrite somebody else\'s words — the owner included', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    prismaMock.comment.findFirst.mockResolvedValue({ id: 'c1', authorId: 'someone-else' });

    await request(server)
      .patch('/api/diagrams/d1/threads/t1/comments/c1')
      .send({ body: 'Not what they said' })
      .expect(403);

    expect(prismaMock.comment.update).not.toHaveBeenCalled();
  });

  it('404s a comment reached through the wrong thread or diagram', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    prismaMock.comment.findFirst.mockResolvedValue(null);

    await request(server).patch('/api/diagrams/d1/threads/t1/comments/foreign').send({ body: 'Hi' }).expect(404);

    expect(prismaMock.comment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'foreign', threadId: 't1', thread: { diagramId: 'd1' } },
      }),
    );
  });

  it('400s a body past the character ceiling', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    await request(server)
      .patch('/api/diagrams/d1/threads/t1/comments/c1')
      .send({ body: 'x'.repeat(MAX_COMMENT_CHARS + 1) })
      .expect(400);
    expect(prismaMock.comment.findFirst).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/diagrams/:id/threads/:threadId/comments/:commentId', () => {
  it('lets the diagram owner remove a comment they did not write', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    prismaMock.comment.findFirst.mockResolvedValue({
      id: 'c1',
      authorId: 'someone-else',
      thread: { id: 't1', createdById: 'someone-else' },
    });
    prismaMock.comment.count.mockResolvedValue(2);

    await request(server).delete('/api/diagrams/d1/threads/t1/comments/c1').expect(204);

    expect(prismaMock.comment.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(prismaMock.commentThread.delete).not.toHaveBeenCalled();
  });

  it('lets the author remove their own comment', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('viewer'));
    prismaMock.comment.findFirst.mockResolvedValue({
      id: 'c1',
      authorId: 'u1',
      thread: { id: 't1', createdById: 'someone-else' },
    });
    prismaMock.comment.count.mockResolvedValue(1);

    await request(server).delete('/api/diagrams/d1/threads/t1/comments/c1').expect(204);
  });

  it('deletes the thread when its last comment goes, leaving no empty pin', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    prismaMock.comment.findFirst.mockResolvedValue({
      id: 'c1',
      authorId: 'u1',
      thread: { id: 't1', createdById: 'u1' },
    });
    prismaMock.comment.count.mockResolvedValue(0);

    await request(server).delete('/api/diagrams/d1/threads/t1/comments/c1').expect(204);

    expect(prismaMock.comment.count).toHaveBeenCalledWith({ where: { threadId: 't1' } });
    expect(prismaMock.commentThread.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
  });

  it('refuses a member who neither wrote the comment nor opened the thread', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor'));
    prismaMock.comment.findFirst.mockResolvedValue({
      id: 'c1',
      authorId: 'someone-else',
      thread: { id: 't1', createdById: 'someone-else' },
    });

    await request(server).delete('/api/diagrams/d1/threads/t1/comments/c1').expect(403);

    expect(prismaMock.comment.delete).not.toHaveBeenCalled();
  });

  it('404s a comment id belonging to another diagram', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    prismaMock.comment.findFirst.mockResolvedValue(null);
    await request(server).delete('/api/diagrams/d1/threads/t1/comments/foreign').expect(404);
    expect(prismaMock.comment.delete).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/diagrams/:id/threads/:threadId', () => {
  it('lets the diagram owner remove a thread somebody else opened', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    prismaMock.commentThread.findFirst.mockResolvedValue({ id: 't1', createdById: 'someone-else' });

    await request(server).delete('/api/diagrams/d1/threads/t1').expect(204);

    expect(prismaMock.commentThread.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
  });

  it('lets the person who opened it remove it, whatever their role', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('viewer'));
    prismaMock.commentThread.findFirst.mockResolvedValue({ id: 't1', createdById: 'u1' });
    await request(server).delete('/api/diagrams/d1/threads/t1').expect(204);
  });

  it('refuses an editor who did not open it', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(memberRow('editor'));
    prismaMock.commentThread.findFirst.mockResolvedValue({ id: 't1', createdById: 'someone-else' });

    await request(server).delete('/api/diagrams/d1/threads/t1').expect(403);

    expect(prismaMock.commentThread.delete).not.toHaveBeenCalled();
  });

  it('404s a thread id belonging to another diagram', async () => {
    prismaMock.diagram.findFirst.mockResolvedValue(OWNED);
    prismaMock.commentThread.findFirst.mockResolvedValue(null);
    await request(server).delete('/api/diagrams/d1/threads/foreign').expect(404);
    expect(prismaMock.commentThread.delete).not.toHaveBeenCalled();
  });
});
