/**
 * One-off backfill for the `DiagramImage` index.
 *
 *     npx tsx scripts/reindex-images.ts [--dry-run]
 *
 * The index is written by every save from the build that introduced it, but a
 * database that predates it holds diagrams nobody has saved since. Until they
 * are indexed the server believes those boards reference no images at all —
 * a member or a share link would 404 on a picture that is plainly on the
 * canvas, and the garbage collector would count the image as unreferenced.
 * **Run this once, right after `prisma migrate deploy` applies
 * `20260906154210_image_refs_index` and before the app takes traffic** (see
 * DEPLOYMENT.md § Database migrations).
 *
 * It is idempotent — `syncDiagramImages` makes the index match the JSON rather
 * than adding to it — so a second run is a no-op and an interrupted run can
 * simply be repeated.
 *
 * Diagrams are read a page at a time: `data` is a whole board per row, and the
 * point of this table is to stop loading all of them at once.
 */
// Load .env before anything opens a database connection.
import 'dotenv/config';
import { prisma } from '../server/db.js';
import { syncDiagramImages } from '../server/diagramImages.js';
import { imageIdsInDiagram } from '../server/imageRefs.js';

/** Diagrams read per query. Each row carries a whole board's JSON. */
const PAGE_SIZE = 100;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  let cursor: string | undefined;
  let scanned = 0;
  let indexed = 0;
  let references = 0;

  for (;;) {
    const page = await prisma.diagram.findMany({
      take: PAGE_SIZE,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      orderBy: { id: 'asc' },
      select: { id: true, data: true },
    });
    if (page.length === 0) break;

    for (const diagram of page) {
      scanned++;
      const ids = imageIdsInDiagram(diagram.data);
      if (ids.length === 0) continue;
      indexed++;
      references += ids.length;
      if (!dryRun) await syncDiagramImages(diagram.id, diagram.data);
    }

    cursor = page[page.length - 1].id;
  }

  const verb = dryRun ? 'would index' : 'indexed';
  console.log(`Scanned ${scanned} diagram(s); ${verb} ${references} image reference(s) across ${indexed}.`);
}

main()
  .catch((err: unknown) => {
    console.error('Reindex failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
