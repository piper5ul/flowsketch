/**
 * "What does the live document say?", for the API routes that need the answer.
 *
 * `Diagram.data` is rendered from the `Y.Doc` on a debounce (2 s, 10 s at the
 * outside), so for a diagram somebody has open the JSON column is *behind* by
 * up to that much. That is fine for everything that reads a board to draw it —
 * the dashboard card, the public page, the image index all catch up within
 * seconds — and wrong for the one thing that freezes a board on purpose:
 * **version history**. A snapshot of a stale row is a snapshot of a state the
 * user never asked to keep, and it is the state a restore would put back.
 *
 * A registry rather than an import, because `server/collab.ts` already imports
 * `server/versions.ts` (the store hook records versions) and the arrow cannot
 * point both ways. `attachCollab` registers; the routes ask; a process with no
 * collaboration server attached — a test that mounts only the API — gets `null`
 * and reads the row, which is exactly what it should do.
 */
import type { DiagramData } from '../../shared/types.js';
import type * as Y from 'yjs';

type Reader = (diagramId: string) => DiagramData | null;
type DocumentReader = (diagramId: string) => Y.Doc | null;

let read: Reader | null = null;
let readDocument: DocumentReader | null = null;

/** Called once, by `attachCollab`. */
export function setLiveDiagramReader(reader: Reader | null): void {
  read = reader;
}

/** Called by the collaboration server so a route can snapshot the live Y.Doc. */
export function setLiveDiagramDocumentReader(reader: DocumentReader | null): void {
  readDocument = reader;
}

/**
 * The diagram as the open document holds it, or `null` when nobody has it open
 * — in which case `Diagram.data` is already current and is the answer.
 */
export function liveDiagramData(diagramId: string): DiagramData | null {
  return read?.(diagramId) ?? null;
}

/** The open Y.Doc, or `null` when this process has no bound document. */
export function liveDiagramDocument(diagramId: string): Y.Doc | null {
  return readDocument?.(diagramId) ?? null;
}
