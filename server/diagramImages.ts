/**
 * The `DiagramImage` index: which uploaded images each live diagram draws.
 *
 * A diagram points at an image from inside its `data` JSON, where Postgres
 * cannot index it, so every question of the form *"does anything still point at
 * this image?"* used to be answered by reading the JSON of every diagram in
 * scope — once per member image fetch, once per shared-link image fetch, and
 * once per garbage-collection pass. This module keeps a row per (diagram,
 * image) pair so those become indexed lookups, and is the only place that
 * writes the table.
 *
 * The rules it keeps:
 *
 * - **The index describes the diagram's *current* JSON.** Every write that
 *   changes `data` — create, PUT, duplicate, import, restore — calls
 *   `syncDiagramImages` in the same request, so a stale row cannot outlive the
 *   edit that dropped it.
 * - **Only live diagrams are indexed.** A `DiagramVersion` also keeps an image
 *   alive, and those are still found by scanning (`deleteOrphanImages`): that
 *   scan runs only for an image already up for collection, where the read paths
 *   run on every request.
 * - **A row is only ever written for an image this server stores.** The ids
 *   come from `imageIdsInDiagram`, which matches our own `/api/images/<id>`
 *   URLs alone, and the insert skips ids with no `Image` row — a diagram can
 *   name an id that was never uploaded (a copied node, a hand-edited payload),
 *   and the foreign key would turn that into a failed save.
 */
import { prisma } from './db.js';
import { imageIdsInDiagram } from './imageRefs.js';

/**
 * Make the index match `data` for one diagram: insert the rows it gained,
 * delete the rows it lost, leave the rest alone.
 *
 * Idempotent, so re-running it (the backfill script does) is free. The delete
 * and the insert are one transaction: a half-applied sync would either hide a
 * live image from the people it is shared with or leave one looking referenced
 * for ever.
 */
export async function syncDiagramImages(diagramId: string, data: unknown): Promise<void> {
  const referenced = imageIdsInDiagram(data);

  // Only ids we actually hold an `Image` row for; the rest cannot be inserted
  // (foreign key) and are not ours to garbage-collect either.
  const known =
    referenced.length === 0
      ? []
      : (
          await prisma.image.findMany({
            where: { id: { in: referenced } },
            select: { id: true },
          })
        ).map((i) => i.id);

  await prisma.$transaction([
    prisma.diagramImage.deleteMany({
      where: { diagramId, ...(known.length > 0 && { imageId: { notIn: known } }) },
    }),
    ...(known.length > 0
      ? [
          prisma.diagramImage.createMany({
            data: known.map((imageId) => ({ diagramId, imageId })),
            // Concurrent saves of the same board race here; the row they both
            // want is the row that ends up there either way.
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
}

/**
 * Whether any diagram `viewerId` was invited to draws `imageId`.
 *
 * One indexed lookup, where this used to read the `data` of every diagram
 * shared with the caller.
 */
export async function isImageInMemberDiagram(viewerId: string, imageId: string): Promise<boolean> {
  const row = await prisma.diagramImage.findFirst({
    where: { imageId, diagram: { members: { some: { userId: viewerId } } } },
    select: { diagramId: true },
  });
  return row !== null;
}

/**
 * Whether the diagram behind `shareToken` draws `imageId` — the allow-list the
 * public image route checks, now without reading the diagram's JSON.
 */
export async function isImageInSharedDiagram(shareToken: string, imageId: string): Promise<boolean> {
  const row = await prisma.diagramImage.findFirst({
    where: { imageId, diagram: { shareToken } },
    select: { diagramId: true },
  });
  return row !== null;
}

/** Which of `imageIds` some live diagram of `ownerId`'s still draws. */
export async function imagesReferencedByLiveDiagrams(
  ownerId: string,
  imageIds: string[],
): Promise<Set<string>> {
  if (imageIds.length === 0) return new Set();
  const rows = await prisma.diagramImage.findMany({
    where: { imageId: { in: imageIds }, diagram: { userId: ownerId } },
    select: { imageId: true },
  });
  return new Set(rows.map((r) => r.imageId));
}
