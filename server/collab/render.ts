/**
 * The one place a `Y.Doc` becomes `Diagram.data`, and the one place
 * `Diagram.data` becomes a `Y.Doc`.
 *
 * From phase 2 of `docs/realtime.md` the document is the source of truth for an
 * open diagram and the JSON column is a **derived snapshot** — which is what
 * keeps the dashboard, thumbnails, exports, versions, the public `/s/:token`
 * page, comment anchors and the image index all reading exactly what they
 * always read. Everything that writes diagram content writes the document;
 * nothing but the store hook below turns one back into JSON.
 *
 * Both functions are pure and synchronous, so the rules they keep are covered
 * by plain unit tests rather than by a socket and a database.
 *
 * The import of `migrateDiagramData` reaches into `src/` — it is the client's
 * module by history, not by rights: it is *the* definition of what a stored
 * diagram means, and seeding a document from a row written years ago has to
 * apply it or the document would hold v0 content stamped as v3.
 */
import type * as Y from 'yjs';
import type { DiagramData } from '../../shared/types.js';
import { edgesOf, nodesOf, viewportOf, writeDiagramIntoDoc } from '../../shared/collabDoc.js';
import { CURRENT_DIAGRAM_VERSION, migrateDiagramData } from '../../src/lib/diagramMigrations.js';

/**
 * The diagram a document is currently holding, as the JSON snapshot.
 *
 * Always stamped with this build's format version: everything in the document
 * was put there by a client that had already migrated it, so what comes out is
 * current by construction — and a snapshot without a version is read as v0 by
 * the next thing that opens it.
 *
 * Node order comes out of the document as it went in (see `DocEntry.order`), so
 * the parents-before-children invariant a client maintains survives the round
 * trip and nothing here has to rebuild it.
 */
export function docToDiagramData(doc: Y.Doc): DiagramData {
  const viewport = viewportOf(doc);
  return {
    version: CURRENT_DIAGRAM_VERSION,
    nodes: nodesOf(doc),
    edges: edgesOf(doc),
    // Left out entirely rather than written as null, exactly as
    // `serializeDiagram` does: a diagram nobody has panned should open framed
    // on whatever screen it is opened on.
    ...(viewport ? { viewport } : {}),
  };
}

/**
 * Fill an empty document from a diagram's stored JSON — the **lazy upgrade**.
 *
 * Runs the row through `migrateDiagramData` first, so a diagram written before
 * the version field existed becomes a document this build understands rather
 * than one that merely claims to be. Nothing is bulk-migrated: a diagram gets
 * a document the first time somebody opens it, and never before.
 *
 * @throws when the row was written by a *newer* build than this one. The caller
 * is the collaboration socket, where refusing the connection is far better than
 * seeding a document from a payload nothing here can read.
 */
export function seedDocFromDiagramData(doc: Y.Doc, data: unknown, origin?: unknown): void {
  writeDiagramIntoDoc(doc, migrateDiagramData(data), origin);
}
