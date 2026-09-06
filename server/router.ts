import { Router } from 'express';
import { prisma } from './db.js';
import { requireAuth } from './middleware.js';
import { publicDiagram, requireDiagramRole } from './access.js';
import { deleteOrphanImages } from './images.js';
import { imageIdsInDiagram } from './imageRefs.js';
import { syncDiagramImages } from './diagramImages.js';
import { foldersRouter, ownsFolder } from './folders.js';
import { sharingRouter } from './sharing.js';
import { commentsRouter } from './comments.js';
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

/**
 * Point the `DiagramImage` index at what this diagram now draws, reporting
 * whether it worked.
 *
 * Best-effort like the version snapshot and the orphan cleanup: the write the
 * caller asked for is already committed, and failing their save over an index
 * they cannot see would be the wrong trade. The boolean is what the callers
 * use to hold *back* the garbage collector — an index that may be stale is a
 * reason not to delete anything, never a reason to delete more.
 */
async function indexImages(diagramId: string, data: unknown): Promise<boolean> {
  try {
    await syncDiagramImages(diagramId, data);
    return true;
  } catch (err) {
    console.error(`Image index sync failed for diagram ${diagramId}:`, err);
    return false;
  }
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
  folderId: string | null;
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
    // Folders are personal filing, and the folder on this row belongs to the
    // *owner*. Telling a member which of somebody else's drawers it sits in
    // would leak a name they can neither see in the sidebar nor change, so a
    // shared diagram is unfiled as far as its recipient is concerned.
    folderId: role === 'owner' ? row.folderId : null,
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
      folderId: true,
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
    // A create carrying `data` is the import path, and an imported board can
    // already point at images. Indexing it here is what keeps the image routes
    // and the GC from having to read its JSON later.
    await indexImages(diagram.id, diagram.data);
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
    const { title, data, starred, thumbnail, folderId, ifUnmodifiedSince } = req.body;
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

    // Filing is the owner's, for the same reason the star is: `folderId` is one
    // column on the row, and the folder it points at is one the owner alone can
    // see. An editor moving it would rearrange somebody else's dashboard.
    if (folderId !== undefined && access.role !== 'owner') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // …and it must be one of *their* folders. A `404` rather than a `403`,
    // matching how a folder route answers for an id its caller does not own:
    // "there is no such folder" is all anyone is told about someone else's.
    if (typeof folderId === 'string' && !(await ownsFolder(authedUser(req).id, folderId))) {
      res.status(404).json({ error: 'Folder not found' });
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
        ...(folderId !== undefined && { folderId }),
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
    // a live reference to the images the edit just removed — and the index has
    // to be current before the collector reads it, for the same reason. A
    // cleanup failure leaves orphaned files, not a failed PUT: the edit is
    // already saved.
    const indexed = data === undefined || (await indexImages(req.params.id, data));
    if (indexed && droppedImageIds.length > 0) {
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
    folderId: true,
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
      // …but it does land in the same drawer. The route is owner-only, so the
      // folder is already the caller's own and needs no second check.
      folderId: source.folderId,
    },
  });
  // The copy draws the same images the original did, so it gets the same index
  // rows — without them the copy would be the only thing referencing an image
  // and the collector would still call it garbage.
  await indexImages(copy.id, copy.data);
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

// Personal folders. Behind the same `requireAuth`, and with no unauthenticated
// half at all: a folder is one person's filing, so there is nothing about it a
// share token could reasonably grant.
apiRouter.use(foldersRouter);

// Share links and members. Mounted here so they sit behind the same
// `requireAuth`; the token route that needs no session is in `sharing.ts` too,
// but is mounted separately by `index.ts`.
apiRouter.use(sharingRouter);

// Version history, likewise behind `requireAuth`. There is no unauthenticated
// half: a share token grants a look at the diagram as it is now, not at every
// state it has ever been in.
apiRouter.use(versionsRouter);

// Comment threads, also behind `requireAuth` and also with no unauthenticated
// half: a discussion needs names against it, and a public link has none.
apiRouter.use(commentsRouter);
