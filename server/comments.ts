/**
 * Comments: threads pinned to a diagram, and the messages inside them.
 *
 * Mounted inside `apiRouter`, so every route here is behind `requireAuth`.
 * There is deliberately **no unauthenticated half** in this pass: a share token
 * buys a look at the board, and a discussion needs names against it — an
 * anonymous commenter is a moderation problem, not a feature, and the public
 * page has nowhere to show one.
 *
 * **Who may do what.** Reading and *writing* are both viewer+, which is the
 * one rule here that looks wrong and is not: a viewer is somebody invited to
 * review the diagram, and a review they cannot write down is not a review. What
 * a viewer still may not do is change the board — including calling a thread
 * settled, which is an editorial decision — so `resolved` is editor+, with the
 * thread's own author allowed to close what they opened.
 *
 * **Editing is narrower than deleting.** Only the author may rewrite a comment,
 * because putting words in somebody's mouth is a different act from removing
 * them; the owner of the diagram and the person who started the thread may
 * *delete* one, which is the moderation the board's host actually needs.
 *
 * Every lookup is scoped by `diagramId` as well as by id, so a thread or
 * comment id belonging to another diagram is a `404` here even for a caller who
 * could read it through the diagram it really belongs to.
 */
import { Router } from 'express';
import { prisma } from './db.js';
import { requireDiagramRole, roleAtLeast } from './access.js';
import { createCommentLimiter } from './rateLimit.js';
import { authedUser } from './types.js';
import {
  commentBodyOnly,
  createThreadBody,
  setThreadResolvedBody,
  threadFilter,
  validateBody,
  type CommentBodyOnly,
  type CreateThreadBody,
  type SetThreadResolvedBody,
} from './validation.js';
import type {
  CommentInfo,
  CommentThreadFilter,
  CommentThreadInfo,
  DiagramRole,
} from '../shared/types.js';

/**
 * A conversation reads oldest first, with `id` as the tie-break: two comments
 * can land in the same millisecond, and a listing that only orders by timestamp
 * is free to shuffle them between requests.
 */
const OLDEST_FIRST = [{ createdAt: 'asc' }, { id: 'asc' }] as const;

/** Threads newest first, tie-broken the same way. */
const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

/** A person, as a comment attributes one. No email: see `CommentAuthor`. */
const AUTHOR_SELECT = { select: { id: true, name: true } } as const;

const COMMENT_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  editedAt: true,
  author: AUTHOR_SELECT,
} as const;

/**
 * The conversation, read as a nested relation. Not folded into `THREAD_SELECT`
 * as a literal because `as const` would freeze its `orderBy` into a readonly
 * tuple, which Prisma's argument type does not accept.
 */
const THREAD_COMMENTS = {
  orderBy: [...OLDEST_FIRST],
  select: { ...COMMENT_SELECT },
};

const THREAD_SELECT = {
  id: true,
  nodeId: true,
  x: true,
  y: true,
  resolved: true,
  createdAt: true,
  createdBy: AUTHOR_SELECT,
  comments: THREAD_COMMENTS,
} as const;

/** A comment row as `COMMENT_SELECT` reads it back. */
interface CommentRow {
  id: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  author: { id: string; name: string };
}

/** A thread row as `THREAD_SELECT` reads it back. */
interface ThreadRow {
  id: string;
  nodeId: string | null;
  x: number | null;
  y: number | null;
  resolved: boolean;
  createdAt: Date;
  createdBy: { id: string; name: string };
  comments: CommentRow[];
}

function toCommentInfo(row: CommentRow): CommentInfo {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    author: row.author,
  };
}

function toThreadInfo(row: ThreadRow): CommentThreadInfo {
  return {
    id: row.id,
    nodeId: row.nodeId,
    x: row.x,
    y: row.y,
    resolved: row.resolved,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    comments: row.comments.map(toCommentInfo),
  };
}

/**
 * The `where` clause a `?resolved=` filter asks for. `all` adds nothing, so the
 * index on `(diagramId, resolved)` still serves the two that do.
 */
function resolvedWhere(filter: CommentThreadFilter): { resolved?: boolean } {
  if (filter === 'all') return {};
  return { resolved: filter === 'resolved' };
}

/** May the caller call this thread settled — or reopen it? */
function mayResolve(role: DiagramRole, callerId: string, createdById: string): boolean {
  return roleAtLeast(role, 'editor') || createdById === callerId;
}

/**
 * May the caller remove somebody's comment? The author, the person whose thread
 * it is in, and the owner of the diagram — the two hosts of the conversation
 * plus the person who said it.
 */
function mayDeleteComment(
  role: DiagramRole,
  callerId: string,
  authorId: string,
  threadCreatedById: string,
): boolean {
  return authorId === callerId || threadCreatedById === callerId || role === 'owner';
}

export const commentsRouter = Router();

/**
 * Every thread on the diagram, newest first, each with its whole conversation.
 *
 * The comments come back nested rather than as a second call: a board carries
 * tens of threads of a handful of comments each, and a panel that has to fetch
 * every thread it draws is a request per pin. `?resolved=` narrows it —
 * `open` by default, which is what the canvas draws.
 */
commentsRouter.get('/diagrams/:id/threads', async (req, res) => {
  const access = await requireDiagramRole(req, res, 'viewer', { id: true });
  if (!access) return;

  const threads = await prisma.commentThread.findMany({
    where: { diagramId: req.params.id, ...resolvedWhere(threadFilter(req.query.resolved)) },
    orderBy: [...NEWEST_FIRST],
    select: { ...THREAD_SELECT },
  });
  const body: CommentThreadInfo[] = threads.map(toThreadInfo);
  res.json(body);
});

/**
 * Starts a thread, with the comment that starts it. Viewer+ — see the header.
 *
 * The thread and its first comment are written by one nested `create`, because
 * a thread with no comments is a pin with nothing behind it and must never be
 * a state the database can be caught in.
 *
 * `nodeId` is stored as the client sends it and is **not** checked against the
 * diagram's JSON: nodes live inside a `Json` column, so validating one would
 * mean parsing the whole board on every comment, and a shape deleted a second
 * later would make the check a lie anyway. A pin whose node has gone is a
 * question for the canvas, not a reason to refuse the comment.
 */
commentsRouter.post<{ id: string }, unknown, CreateThreadBody>(
  '/diagrams/:id/threads',
  createCommentLimiter(),
  validateBody(createThreadBody),
  async (req, res) => {
    const access = await requireDiagramRole(req, res, 'viewer', { id: true });
    if (!access) return;

    const { nodeId, x, y, body } = req.body;
    const thread = await prisma.commentThread.create({
      data: {
        diagramId: req.params.id,
        nodeId: nodeId ?? null,
        x: x ?? null,
        y: y ?? null,
        createdById: authedUser(req).id,
        comments: { create: { authorId: authedUser(req).id, body } },
      },
      select: { ...THREAD_SELECT },
    });
    res.status(201).json(toThreadInfo(thread));
  },
);

/** Replies to a thread. Viewer+, like starting one. */
commentsRouter.post<{ id: string; threadId: string }, unknown, CommentBodyOnly>(
  '/diagrams/:id/threads/:threadId/comments',
  createCommentLimiter(),
  validateBody(commentBodyOnly),
  async (req, res) => {
    const access = await requireDiagramRole(req, res, 'viewer', { id: true });
    if (!access) return;

    const thread = await prisma.commentThread.findFirst({
      where: { id: req.params.threadId, diagramId: req.params.id },
      select: { id: true },
    });
    if (!thread) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const comment = await prisma.comment.create({
      data: { threadId: thread.id, authorId: authedUser(req).id, body: req.body.body },
      select: { ...COMMENT_SELECT },
    });
    res.status(201).json(toCommentInfo(comment));
  },
);

/**
 * Resolves a thread, or reopens one. Editor+, or the person who opened it:
 * calling a discussion finished is an editorial call on somebody else's board,
 * but nobody needs permission to close their own question.
 */
commentsRouter.patch<{ id: string; threadId: string }, unknown, SetThreadResolvedBody>(
  '/diagrams/:id/threads/:threadId',
  validateBody(setThreadResolvedBody),
  async (req, res) => {
    const access = await requireDiagramRole(req, res, 'viewer', { id: true });
    if (!access) return;

    const thread = await prisma.commentThread.findFirst({
      where: { id: req.params.threadId, diagramId: req.params.id },
      select: { id: true, createdById: true },
    });
    if (!thread) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (!mayResolve(access.role, authedUser(req).id, thread.createdById)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const updated = await prisma.commentThread.update({
      where: { id: thread.id },
      data: { resolved: req.body.resolved },
      select: { ...THREAD_SELECT },
    });
    res.json(toThreadInfo(updated));
  },
);

/**
 * Rewrites a comment. The author alone — see the header on why this is
 * narrower than deleting one. `editedAt` is stamped so the UI can say so; the
 * previous wording is not kept, a comment being a remark rather than a document.
 */
commentsRouter.patch<{ id: string; threadId: string; commentId: string }, unknown, CommentBodyOnly>(
  '/diagrams/:id/threads/:threadId/comments/:commentId',
  validateBody(commentBodyOnly),
  async (req, res) => {
    const access = await requireDiagramRole(req, res, 'viewer', { id: true });
    if (!access) return;

    const comment = await prisma.comment.findFirst({
      where: {
        id: req.params.commentId,
        threadId: req.params.threadId,
        thread: { diagramId: req.params.id },
      },
      select: { id: true, authorId: true },
    });
    if (!comment) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (comment.authorId !== authedUser(req).id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const updated = await prisma.comment.update({
      where: { id: comment.id },
      data: { body: req.body.body, editedAt: new Date() },
      select: { ...COMMENT_SELECT },
    });
    res.json(toCommentInfo(updated));
  },
);

/**
 * Removes a comment. The author, the thread's opener, or the diagram's owner.
 *
 * Deleting the last one deletes the thread with it: an empty thread is a pin
 * on the canvas with nothing to show, and leaving it there would make "delete
 * my comment" quietly mean "leave a marker where I used to be".
 */
commentsRouter.delete('/diagrams/:id/threads/:threadId/comments/:commentId', async (req, res) => {
  const access = await requireDiagramRole(req, res, 'viewer', { id: true });
  if (!access) return;

  const comment = await prisma.comment.findFirst({
    where: {
      id: req.params.commentId,
      threadId: req.params.threadId,
      thread: { diagramId: req.params.id },
    },
    select: { id: true, authorId: true, thread: { select: { id: true, createdById: true } } },
  });
  if (!comment) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (!mayDeleteComment(access.role, authedUser(req).id, comment.authorId, comment.thread.createdById)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  await prisma.comment.delete({ where: { id: comment.id } });
  // Counted after the delete rather than reasoned about before it: the answer
  // has to be about the thread as it stands now, not as it stood when the row
  // was read.
  const remaining = await prisma.comment.count({ where: { threadId: comment.thread.id } });
  if (remaining === 0) {
    await prisma.commentThread.delete({ where: { id: comment.thread.id } });
  }
  res.status(204).end();
});

/**
 * Removes a whole thread, comments and all (they cascade). The owner of the
 * diagram or the person who started it — the same two who may clear a single
 * comment, minus the author of one reply inside it.
 */
commentsRouter.delete('/diagrams/:id/threads/:threadId', async (req, res) => {
  const access = await requireDiagramRole(req, res, 'viewer', { id: true });
  if (!access) return;

  const thread = await prisma.commentThread.findFirst({
    where: { id: req.params.threadId, diagramId: req.params.id },
    select: { id: true, createdById: true },
  });
  if (!thread) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (access.role !== 'owner' && thread.createdById !== authedUser(req).id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  await prisma.commentThread.delete({ where: { id: thread.id } });
  res.status(204).end();
});
