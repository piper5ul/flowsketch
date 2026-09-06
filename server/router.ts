import { Router } from 'express';
import { prisma } from './db.js';
import { requireAuth } from './middleware.js';
import { publicDiagram, requireDiagramRole } from './access.js';
import { deleteOrphanImages } from './images.js';
import { imageIdsInDiagram } from './imageRefs.js';
import { sharingRouter } from './sharing.js';
import { recordVersionIfDue, versionsRouter } from './versions.js';
import { authedUser } from './types.js';
import type { DiagramMeta, DiagramRole } from '../shared/types.js';
import {
  copyTitle,
  createDiagramBody,
  updateDiagramBody,
  validateBody,
  type CreateDiagramBody,
  type UpdateDiagramBody,
} from './validation.js';

/** Image ids `before` referenced that `after` no longer does. */
function droppedImages(before: unknown, after: unknown): string[] {
  const kept = new Set(imageIdsInDiagram(after));
  return imageIdsInDiagram(before).filter((id) => !kept.has(id));
}

export const apiRouter = Router();

apiRouter.use(requireAuth);

/** A listed row, as Prisma hands it back before it is narrowed to `DiagramMeta`. */
interface ListedDiagram {
  id: string;
  title: string;
  starred: boolean;
  createdAt: Date;
  updatedAt: Date;
  thumbnail: string | null;
  userId: string;
  user: { name: string } | null;
  members: { role: string }[];
}

/**
 * A listed row plus what the listing user may do with it. `ownerName` is only
 * carried for someone else's diagram: on your own it is you.
 */
function toMeta(row: ListedDiagram, userId: string): DiagramMeta {
  const role: DiagramRole =
    row.userId === userId ? 'owner' : row.members[0]?.role === 'editor' ? 'editor' : 'viewer';
  return {
    id: row.id,
    title: row.title,
    starred: row.starred,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    thumbnail: row.thumbnail,
    role,
    ...(role !== 'owner' && { ownerName: row.user?.name ?? '' }),
  };
}

apiRouter.get('/diagrams', async (req, res) => {
  const userId = authedUser(req).id;
  const diagrams = await prisma.diagram.findMany({
    // Everything the caller can open: their own, plus what they were invited to.
    where: { OR: [{ userId }, { members: { some: { userId } } }] },
    select: {
      id: true,
      title: true,
      starred: true,
      createdAt: true,
      updatedAt: true,
      thumbnail: true,
      // Not returned as such — `userId` and the caller's own member row are
      // what `role` is derived from, and `user.name` names someone else's.
      userId: true,
      user: { select: { name: true } },
      members: { where: { userId }, select: { role: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(diagrams.map((row) => toMeta(row, userId)));
});

// The explicit generics are what make `req.body` the parsed shape rather than
// `any`; Express only infers them for a route with a single handler.
apiRouter.post<Record<string, string>, unknown, CreateDiagramBody>(
  '/diagrams',
  validateBody(createDiagramBody),
  async (req, res) => {
    const userId = authedUser(req).id;
    const { title, data } = req.body;
    const diagram = await prisma.diagram.create({
      data: {
        userId,
        title: title || 'Untitled',
        data: data || { nodes: [], edges: [] },
      },
    });
    // The caller owns what they just created, so nothing is stripped — it goes
    // through the serializer so that no diagram-returning route is an exception.
    res.status(201).json(publicDiagram(diagram, 'owner'));
  },
);

apiRouter.get('/diagrams/:id', async (req, res) => {
  const access = await requireDiagramRole(req, res, 'viewer', {
    id: true,
    userId: true,
    title: true,
    data: true,
    thumbnail: true,
    starred: true,
    shareToken: true,
    createdAt: true,
    updatedAt: true,
  });
  if (!access) return;
  res.json({ ...publicDiagram(access.diagram, access.role), role: access.role });
});

apiRouter.put<{ id: string }, unknown, UpdateDiagramBody>(
  '/diagrams/:id',
  validateBody(updateDiagramBody),
  async (req, res) => {
    const { title, data, starred, thumbnail, ifUnmodifiedSince } = req.body;
    // The previous JSON and title are only needed when `data` changes — to spot
    // images the edit drops, and to snapshot the state it replaces — so a
    // metadata-only PUT (rename, star, thumbnail) does not read them back.
    const access = await requireDiagramRole(req, res, 'editor', {
      id: true,
      userId: true,
      updatedAt: true,
      ...(data !== undefined && { data: true as const, title: true as const }),
    });
    if (!access) return;
    const existing = access.diagram;
    // Orphan cleanup is scoped to the images the *owner* holds; an editor's
    // edit still frees the owner's files, never their own.
    const ownerId = existing.userId;

    // `starred` is the owner's own flag on the row (see PATCH /star), so an
    // editor's PUT may not carry it even though their edits are welcome.
    if (starred !== undefined && access.role !== 'owner') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Optimistic concurrency. The client sends back the `updatedAt` it loaded
    // (or last saved); anything else means another tab wrote in between, and
    // this body is built on a version that no longer exists. Compared as
    // timestamps rather than strings: the client round-trips an ISO string,
    // which carries the column's millisecond precision but not its formatting.
    // A save with no guard at all is a deliberate overwrite and still writes.
    if (
      ifUnmodifiedSince !== undefined &&
      existing.updatedAt.getTime() !== new Date(ifUnmodifiedSince).getTime()
    ) {
      res.status(409).json({ error: 'Conflict', updatedAt: existing.updatedAt });
      return;
    }

    const droppedImageIds = data === undefined ? [] : droppedImages(existing.data, data);

    const updated = await prisma.diagram.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined && { title }),
        ...(data !== undefined && { data }),
        ...(starred !== undefined && { starred }),
        ...(thumbnail !== undefined && { thumbnail }),
      },
    });

    // Version history, for edits that actually change the board — a rename,
    // a star or a thumbnail is not a revision of anything. What is recorded is
    // the state *before* this PUT, and only when the last snapshot has aged out
    // of `VERSION_INTERVAL_MS`, so an afternoon of autosaves leaves one row per
    // burst rather than one per keystroke. Best-effort, like the cleanup below:
    // a diagram whose history is missing an entry is a far smaller problem than
    // a save that failed.
    if (data !== undefined) {
      try {
        await recordVersionIfDue({
          diagramId: req.params.id,
          data: existing.data,
          title: existing.title,
          createdById: authedUser(req).id,
          ownerId,
        });
      } catch (err) {
        console.error(`Version snapshot failed for diagram ${req.params.id}:`, err);
      }
    }

    // Only after the row is written, or the pre-edit JSON would still count as
    // a live reference to the images the edit just removed. A cleanup failure
    // leaves orphaned files, not a failed PUT: the edit is already saved.
    if (droppedImageIds.length > 0) {
      try {
        await deleteOrphanImages(ownerId, droppedImageIds);
      } catch (err) {
        console.error(`Orphan image cleanup failed for diagram ${req.params.id}:`, err);
      }
    }
    // `update` reads the whole row back, share token and all, and an editor is
    // as much "not the owner" here as they are on the `GET`.
    res.json(publicDiagram(updated, access.role));
  },
);

apiRouter.delete('/diagrams/:id', async (req, res) => {
  const access = await requireDiagramRole(req, res, 'owner', { id: true, userId: true, data: true });
  if (!access) return;
  const userId = access.diagram.userId;
  const referencedImageIds = imageIdsInDiagram(access.diagram.data);
  await prisma.diagram.delete({ where: { id: req.params.id } });

  // Only after the row is gone, or the diagram would count as a live reference
  // to its own images. A cleanup failure leaves orphaned files, not a failed
  // delete: the diagram the caller asked to remove is already gone.
  try {
    await deleteOrphanImages(userId, referencedImageIds);
  } catch (err) {
    console.error(`Orphan image cleanup failed for diagram ${req.params.id}:`, err);
  }
  res.status(204).end();
});

// Owner-only for now, as it was before sharing: a copy would carry the
// original's images across accounts, which the image GC does not model yet.
apiRouter.post('/diagrams/:id/duplicate', async (req, res) => {
  const userId = authedUser(req).id;
  const access = await requireDiagramRole(req, res, 'owner', {
    title: true,
    data: true,
    thumbnail: true,
  });
  if (!access) return;
  const source = access.diagram;
  const copy = await prisma.diagram.create({
    data: {
      userId,
      title: copyTitle(source.title),
      data: source.data ?? {},
      // The thumbnail is already rendered and the copy looks identical, so
      // carrying it over saves the new card a trip through the icon.
      thumbnail: source.thumbnail,
      // A copy is not what the user starred.
      starred: false,
    },
  });
  // The copy belongs to the caller, so again nothing is stripped; the call is
  // here so that adding a route beside this one inherits the rule.
  res.status(201).json(publicDiagram(copy, 'owner'));
});

/**
 * Owner-only, deliberately. `starred` is a single column on the diagram row,
 * so a member starring it would star it for the owner too — making it per-user
 * needs its own table and is left for the follow-up that adds one.
 */
apiRouter.patch('/diagrams/:id/star', async (req, res) => {
  const access = await requireDiagramRole(req, res, 'owner', { id: true, starred: true });
  if (!access) return;
  const updated = await prisma.diagram.update({
    where: { id: req.params.id },
    data: { starred: !access.diagram.starred },
  });
  res.json({ starred: updated.starred });
});

// Share links and members. Mounted here so they sit behind the same
// `requireAuth`; the token route that needs no session is in `sharing.ts` too,
// but is mounted separately by `index.ts`.
apiRouter.use(sharingRouter);

// Version history, likewise behind `requireAuth`. There is no unauthenticated
// half: a share token grants a look at the diagram as it is now, not at every
// state it has ever been in.
apiRouter.use(versionsRouter);
