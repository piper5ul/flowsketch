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
import { authedUser } from './types.js';
import { createVersionBody, validateBody, type CreateVersionBody } from './validation.js';
import type { DiagramVersion, DiagramVersionMeta } from '../shared/types.js';

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
async function pruneVersions(diagramId: string, ownerId: string): Promise<void> {
  try {
    const surplus = await prisma.diagramVersion.findMany({
      where: { diagramId },
      orderBy: [...NEWEST_FIRST],
      skip: maxVersions(),
      select: { id: true, data: true },
    });
    if (surplus.length === 0) return;
    await prisma.diagramVersion.deleteMany({ where: { id: { in: surplus.map((v) => v.id) } } });
    await freeImagesOnlyPrunedVersionsDrew(diagramId, ownerId, surplus);
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
async function writeVersion(input: VersionInput): Promise<VersionRow> {
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
  await pruneVersions(input.diagramId, input.ownerId);
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
      data: access.diagram.data,
      title: access.diagram.title,
      createdById: authedUser(req).id,
      ownerId: access.diagram.userId,
      label: req.body.label,
    });
    res.status(201).json(toMeta(version));
  },
);

/**
 * Put a version back. Editor+, because it is a write to the diagram.
 *
 * The state being replaced is snapshotted first, labelled `Before restore`, so
 * a restore is itself undoable — and unlike the automatic recording that write
 * is *not* best-effort: losing the current board to a restore nobody can walk
 * back is the one failure this feature must not have, so it happens before the
 * update and its failure fails the request.
 *
 * The response is the updated diagram, `updatedAt` included: the client's
 * autosave is holding the row's old timestamp as its conflict guard, and would
 * 409 on its next save if it were not told where the row has moved to.
 */
versionsRouter.post('/diagrams/:id/versions/:versionId/restore', async (req, res) => {
  const access = await requireDiagramRole(req, res, 'editor', {
    id: true,
    userId: true,
    data: true,
    title: true,
  });
  if (!access) return;

  const version = await prisma.diagramVersion.findFirst({
    where: { id: req.params.versionId, diagramId: req.params.id },
    select: { data: true, title: true },
  });
  if (!version) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

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
    data: { data: version.data ?? {}, title: version.title },
    // Selected rather than returned whole: the row carries the owner's
    // `shareToken`, which an editor restoring a version has no business seeing.
    select: { id: true, title: true, data: true, updatedAt: true },
  });
  // Already narrow enough that this strips nothing — it is here so that every
  // route answering with a diagram row does so through the one serializer.
  res.json(publicDiagram(updated, access.role));
});
