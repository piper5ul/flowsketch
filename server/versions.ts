/**
 * Version history: point-in-time snapshots of a diagram's `data` and `title`.
 *
 * Two things write a version. The first is `recordVersionIfDue`, called by
 * `PUT /api/diagrams/:id` whenever the edit changes `data`: it snapshots the
 * **previous** state, and only if the newest existing snapshot is older than
 * `VERSION_INTERVAL_MS`. Autosave fires every two seconds while someone draws,
 * so recording each PUT would store hundreds of near-identical copies of an
 * afternoon; recording the pre-edit state once per interval instead gives one
 * row per *burst of editing*, which is the granularity a history panel can
 * actually offer ("the board as it was before lunch"). The second is the two
 * explicit routes below — a manual snapshot, and the safety copy a restore
 * takes — which write unconditionally, because the user asked.
 *
 * Retention keeps the newest `MAX_VERSIONS` per diagram and drops the rest in
 * the same request. It is deliberately best-effort: a failed prune leaves extra
 * rows, which is never a reason to fail the write that triggered it.
 *
 * History also keeps images alive. `deleteOrphanImages` (`server/images.ts`)
 * counts a stored version as a reference, so an image edited off the live board
 * survives for as long as a snapshot still draws it — which makes *retention*
 * the moment such an image can become garbage, and the reason `pruneVersions`
 * reads each surplus row's `data` before deleting it.
 */
import { Router } from 'express';
import { prisma } from './db.js';
import { publicDiagram, requireDiagramRole } from './access.js';
import { deleteOrphanImages } from './images.js';
import { imageIdsInDiagram } from './imageRefs.js';
import { syncDiagramImages } from './diagramImages.js';
import { liveDiagramData } from './collab/live.js';
import { authedUser } from './types.js';
import {
  createVersionBody,
  restoreVersionBody,
  validateBody,
  type CreateVersionBody,
  type RestoreVersionBody,
} from './validation.js';
import type { DiagramVersion, DiagramVersionMeta } from '../shared/types.js';
import { migrateDiagramData } from '../src/lib/diagramMigrations.js';

/** Default gap between two automatic snapshots. Env: `VERSION_INTERVAL_MS`. */
export const DEFAULT_VERSION_INTERVAL_MS = 10 * 60 * 1000;

/** Default number of versions kept per diagram. Env: `MAX_VERSIONS`. */
export const DEFAULT_MAX_VERSIONS = 50;

/** The label on the snapshot a restore takes of what it is about to replace. */
export const RESTORE_SNAPSHOT_LABEL = 'Before restore';

/**
 * A positive-integer setting from the environment. Read at call time, not at
 * import, so a test can change it between cases; anything unparseable falls
 * back rather than turning a typo in a unit file into "snapshot every PUT".
 */
function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Minimum age of the newest snapshot before a `PUT` records another. */
export function versionIntervalMs(): number {
  return positiveIntEnv('VERSION_INTERVAL_MS', DEFAULT_VERSION_INTERVAL_MS);
}

/** How many versions a diagram keeps. Older ones are pruned as newer arrive. */
export function maxVersions(): number {
  return positiveIntEnv('MAX_VERSIONS', DEFAULT_MAX_VERSIONS);
}

/**
 * Newest first, with `id` as the tie-break. Two snapshots can land in the same
 * millisecond (a manual one taken as autosave fires), and both the listing and
 * the prune need a *total* order or they disagree about which row is oldest.
 */
const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

/** Everything a version is listed by — `data` deliberately not among it. */
const META_SELECT = {
  id: true,
  createdAt: true,
  title: true,
  label: true,
  createdBy: { select: { name: true } },
} as const;

/** A version row as `META_SELECT` reads it back. */
interface VersionRow {
  id: string;
  createdAt: Date;
  title: string;
  label: string | null;
  createdBy: { name: string } | null;
}

/** The wire shape. `createdBy` is dropped rather than sent as `null`. */
function toMeta(row: VersionRow): DiagramVersionMeta {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    title: row.title,
    label: row.label,
    ...(row.createdBy && { createdBy: { name: row.createdBy.name } }),
  };
}

/**
 * Free the images the pruned snapshots were the last thing referencing.
 *
 * Retention is the other half of the image GC's problem: the scan in
 * `deleteOrphanImages` now keeps an image alive for as long as *some* version
 * draws it, so dropping the version that drew it is the moment that image can
 * become garbage — and nothing else ever revisits it.
 *
 * Best-effort and logged, separately from retention itself: by the time this
 * runs the surplus rows are already gone, and a leftover file on disk is not a
 * reason to report the prune as failed.
 */
async function freeImagesOnlyPrunedVersionsDrew(
  diagramId: string,
  ownerId: string,
  pruned: { data: unknown }[],
): Promise<void> {
  const candidateIds = [...new Set(pruned.flatMap((v) => imageIdsInDiagram(v.data)))];
  if (candidateIds.length === 0) return;
  try {
    await deleteOrphanImages(ownerId, candidateIds);
  } catch (err) {
    console.error(`Orphan image cleanup after retention failed for diagram ${diagramId}:`, err);
  }
}

/**
 * Drop everything past the newest `MAX_VERSIONS` for one diagram.
 *
 * The ids are read first and deleted by id rather than deleting by a timestamp
 * cutoff: a cutoff has to decide what to do with rows sharing the boundary
 * millisecond, and would take the wrong side of it half the time. `data` is
 * read alongside them because once a row is deleted nothing can say which
 * images it drew.
 *
 * Swallows its own failures — see the retention note at the top of the file.
 */
async function pruneVersions(
  diagramId: string,
  ownerId: string,
  collectOrphanImages = true,
): Promise<void> {
  try {
    const surplus = await prisma.diagramVersion.findMany({
      where: { diagramId },
      orderBy: [...NEWEST_FIRST],
      skip: maxVersions(),
      select: { id: true, data: true },
    });
    if (surplus.length === 0) return;
    await prisma.diagramVersion.deleteMany({ where: { id: { in: surplus.map((v) => v.id) } } });
    if (collectOrphanImages) await freeImagesOnlyPrunedVersionsDrew(diagramId, ownerId, surplus);
  } catch (err) {
    console.error(`Version retention failed for diagram ${diagramId}:`, err);
  }
}

/** What a snapshot is made of, whoever asked for it. */
export interface VersionInput {
  diagramId: string;
  /** The diagram JSON to freeze. */
  data: unknown;
  /** The title as it stood alongside that JSON. */
  title: string;
  /** The signed-in user whose action produced the snapshot. */
  createdById: string;
  /**
   * Who owns the diagram, and therefore whose uploads retention may free.
   * Not the same person as `createdById` when an editor is the one saving —
   * an editor's edit frees the owner's files, never their own.
   */
  ownerId: string;
  /** Absent on an automatic snapshot. */
  label?: string;
}

/** Write one version and prune what falls off the end. */
async function writeVersion(
  input: VersionInput,
  { collectOrphanImages = true }: { collectOrphanImages?: boolean } = {},
): Promise<VersionRow> {
  const version = await prisma.diagramVersion.create({
    data: {
      diagramId: input.diagramId,
      // `?? {}` mirrors the duplicate route: a `Json` column cannot hold the
      // SQL null that a row written before this feature would read back as.
      data: input.data ?? {},
      title: input.title,
      createdById: input.createdById,
      label: input.label ?? null,
    },
    select: { ...META_SELECT },
  });
  await pruneVersions(input.diagramId, input.ownerId, collectOrphanImages);
  return version;
}

/**
 * Snapshot the pre-edit state, unless one was already taken this interval.
 *
 * Called by the `PUT` handler *after* the edit is written: the caller holds the
 * previous JSON in memory, so ordering does not change what is stored, and
 * doing it afterwards keeps a snapshot failure from ever costing the user their
 * edit. The very first data-changing `PUT` on a diagram always records, so a
 * diagram's history starts at the state it was in before anyone touched it.
 */
export async function recordVersionIfDue(input: VersionInput): Promise<void> {
  const newest = await prisma.diagramVersion.findFirst({
    where: { diagramId: input.diagramId },
    orderBy: [...NEWEST_FIRST],
    select: { createdAt: true },
  });
  if (newest && Date.now() - newest.createdAt.getTime() < versionIntervalMs()) return;
  await writeVersion(input);
}

export const versionsRouter = Router();

/** Remove `/api/images/<id>` refs that this diagram had no right to draw. */
function stripUnreachableImageSources(data: unknown, reachableIds: ReadonlySet<string>): unknown {
  if (typeof data !== 'object' || data === null || !Array.isArray((data as { nodes?: unknown }).nodes)) return data;

  const nodes = (data as { nodes: unknown[] }).nodes.map((node) => {
    const imageId = imageIdsInDiagram({ nodes: [node] })[0];
    if (!imageId || reachableIds.has(imageId) || typeof node !== 'object' || node === null) return node;

    const nodeData = (node as { data?: unknown }).data;
    if (typeof nodeData !== 'object' || nodeData === null || Array.isArray(nodeData)) return node;
    const sanitizedData = { ...(nodeData as Record<string, unknown>) };
    delete sanitizedData.imageSrc;
    return { ...node, data: sanitizedData };
  });
  return { ...data, nodes };
}

/**
 * The history, newest first and without any `data`. Readable by anyone who can
 * read the diagram: a viewer being shown what it looked like last week is the
 * same permission as being shown what it looks like now.
 */
versionsRouter.get('/diagrams/:id/versions', async (req, res) => {
  const access = await requireDiagramRole(req, res, 'viewer', { id: true });
  if (!access) return;

  const versions = await prisma.diagramVersion.findMany({
    where: { diagramId: req.params.id },
    orderBy: [...NEWEST_FIRST],
    // Retention already holds the table to this; the cap is here so that
    // *lowering* `MAX_VERSIONS` takes effect on the next read rather than
    // waiting for the next write to prune.
    take: maxVersions(),
    select: { ...META_SELECT },
  });
  res.json(versions.map(toMeta));
});

/** One version with its body, for the preview pane. Viewer+, as the listing is. */
versionsRouter.get('/diagrams/:id/versions/:versionId', async (req, res) => {
  const access = await requireDiagramRole(req, res, 'viewer', { id: true });
  if (!access) return;

  const version = await prisma.diagramVersion.findFirst({
    // Scoped by `diagramId` as well as by id. The access check above was for
    // *this* diagram, so a version id belonging to another one is a 404 here
    // even for a caller who could read it through the diagram it belongs to.
    where: { id: req.params.versionId, diagramId: req.params.id },
    select: { ...META_SELECT, data: true },
  });
  if (!version) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const body: DiagramVersion = { ...toMeta(version), data: version.data };
  res.json(body);
});

/**
 * A snapshot of the diagram as it stands, taken now and regardless of the
 * interval — the user pressed the button, so the interval (which exists to stop
 * autosave from flooding the table) has nothing to say about it.
 */
versionsRouter.post<{ id: string }, unknown, CreateVersionBody>(
  '/diagrams/:id/versions',
  validateBody(createVersionBody),
  async (req, res) => {
    const access = await requireDiagramRole(req, res, 'editor', {
      id: true,
      userId: true,
      data: true,
      title: true,
    });
    if (!access) return;

    const version = await writeVersion({
      diagramId: req.params.id,
      // The board as it is *now*. For a diagram somebody has open that is the
      // live document, not the JSON column, which the collaboration server
      // rewrites on a debounce and so is up to ten seconds behind — and a
      // snapshot the user asked for by name must be of what they are looking
      // at, not of where it was a moment ago.
      data: liveDiagramData(req.params.id) ?? access.diagram.data,
      title: access.diagram.title,
      createdById: authedUser(req).id,
      ownerId: access.diagram.userId,
      label: req.body.label,
    });
    res.status(201).json(toMeta(version));
  },
);

/**
 * Restore a version's content. Editor+, because it is a write to the diagram.
 *
 * Row-based restores save the current row as `Before restore` before writing
 * the replacement. For a collaborative diagram, the bound client captures the
 * copy before applying the returned version as an ordinary edit, then posts it
 * here; a failed copy leaves the already-applied restore undoable but without
 * that history entry. A diagram without a document keeps the row-based path.
 *
 * A bound client captures its own safety copy and applies the version in one
 * synchronous turn, then posts that copy here. This closes the gap where a
 * peer edit could arrive after a server snapshot but before the client apply.
 * Restore leaves the current title alone. The empty-body path on a collaborative
 * diagram only returns the version's content and never snapshots it.
 */
versionsRouter.post<{ id: string; versionId: string }, unknown, RestoreVersionBody>(
  '/diagrams/:id/versions/:versionId/restore',
  validateBody(restoreVersionBody),
  async (req, res) => {
    const access = await requireDiagramRole(req, res, 'editor', {
      id: true,
      userId: true,
      data: true,
      title: true,
      updatedAt: true,
    });
    if (!access) return;

    const version = await prisma.diagramVersion.findFirst({
      where: { id: req.params.versionId, diagramId: req.params.id },
      select: { data: true },
    });
    if (!version) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    // For a live document the caller captured this state immediately before
    // applying the version through its binding. Narrow it through the same
    // migration used at every other diagram-data boundary, then use the normal
    // version writer for retention and orphan-image handling. This request
    // deliberately does not write `Diagram.data` or `DiagramDoc`.
    const before = req.body.before;
    if (before) {
      const data = migrateDiagramData(before.data);
      const referencedIds = imageIdsInDiagram(data);
      const reachableIds = new Set<string>();
      if (referencedIds.length > 0) {
        const [indexed, versions, owned] = await Promise.all([
          prisma.diagramImage.findMany({
            where: { diagramId: req.params.id, imageId: { in: referencedIds } },
            select: { imageId: true },
          }),
          prisma.diagramVersion.findMany({
            where: { diagramId: req.params.id },
            select: { data: true },
          }),
          prisma.image.findMany({
            where: { id: { in: referencedIds }, userId: access.diagram.userId },
            select: { id: true },
          }),
        ]);
        for (const row of indexed) reachableIds.add(row.imageId);
        for (const version of versions) {
          for (const imageId of imageIdsInDiagram(version.data)) reachableIds.add(imageId);
        }
        for (const image of owned) reachableIds.add(image.id);
      }

      // Retention may prune the version the client is about to restore. Keep
      // its images until the restored board has synced its live image index.
      await writeVersion({
        diagramId: req.params.id,
        data: stripUnreachableImageSources(data, reachableIds),
        title: before.title,
        createdById: authedUser(req).id,
        ownerId: access.diagram.userId,
        label: RESTORE_SNAPSHOT_LABEL,
      }, { collectOrphanImages: false });
      res.status(201).json({ saved: true });
      return;
    }

    const liveData = liveDiagramData(req.params.id);
    const storedDoc = await prisma.diagramDoc.findUnique({
      where: { diagramId: req.params.id },
      select: { state: true },
    });

    if (liveData || storedDoc) {
      res.json({
        data: migrateDiagramData(version.data ?? {}),
        applyAsEdit: true,
      });
      return;
    }

    // This branch has no live or stored document, so the row is the current
    // board. Preserve it before writing the replacement so the restore can be
    // walked back.
    await writeVersion({
      diagramId: req.params.id,
      data: access.diagram.data,
      title: access.diagram.title,
      createdById: authedUser(req).id,
      ownerId: access.diagram.userId,
      label: RESTORE_SNAPSHOT_LABEL,
    });

    const updated = await prisma.diagram.update({
      where: { id: req.params.id },
      data: { data: version.data ?? {} },
      // Selected rather than returned whole: the row carries the owner's
      // `shareToken`, which an editor restoring a version has no business seeing.
      select: { id: true, title: true, data: true, updatedAt: true },
    });

    // A restore is a write to `data` like any other, so the image index follows
    // it — the restored board may draw images the one it replaced did not.
    // Best-effort: the restore itself has already happened, and a stale index is
    // a reason for the collector to keep an image, never to delete one.
    try {
      await syncDiagramImages(req.params.id, updated.data);
    } catch (err) {
      console.error(`Image index sync after restore failed for diagram ${req.params.id}:`, err);
    }

    // Already narrow enough that this strips nothing — it is here so that every
    // route answering with a diagram row does so through the one serializer.
    res.json(publicDiagram(updated, access.role));
  },
);

/** What a fork is called: the version's own title, marked as a branch off it. */
export function forkTitle(title: string): string {
  return `${title} (fork)`;
}

/**
 * A new diagram of the caller's own, holding exactly what this version held —
 * Whimsical's "fork the file". Viewer+: reading the version is a viewer's
 * right, and the copy is theirs, so nothing about the original changes; a fork
 * carries no history and no comments. It draws the images the version drew,
 * so the index follows it — though an image the original's owner uploaded is
 * theirs, and a forker who is not a member of a diagram still drawing it will
 * see that image as missing (`GET /api/images/:id`'s rule, unchanged here).
 */
versionsRouter.post('/diagrams/:id/versions/:versionId/fork', async (req, res) => {
  const access = await requireDiagramRole(req, res, 'viewer', { id: true });
  if (!access) return;

  const version = await prisma.diagramVersion.findFirst({
    where: { id: req.params.versionId, diagramId: req.params.id },
    select: { data: true, title: true },
  });
  if (!version) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const fork = await prisma.diagram.create({
    data: {
      userId: authedUser(req).id,
      title: forkTitle(version.title),
      data: version.data ?? {},
      starred: false,
    },
  });
  try {
    await syncDiagramImages(fork.id, fork.data);
  } catch (err) {
    console.error(`Image index sync after fork failed for diagram ${fork.id}:`, err);
  }
  res.status(201).json(publicDiagram(fork, 'owner'));
});
