/**
 * The shape of a diagram inside its `Y.Doc` — the one place both ends agree on
 * how a board is laid out in the CRDT.
 *
 * See `docs/realtime.md`. From phase 2 the document is the source of truth for
 * an open diagram and `Diagram.data` is a snapshot rendered from it, so this
 * module is read by the browser (`src/lib/collab/binding.ts`, which pushes the
 * store into the document and back) and by the server
 * (`server/collab/render.ts`, which renders the JSON). It is deliberately free
 * of both: nothing here knows about Zustand, React Flow or Prisma.
 *
 * **One Y.Map entry per element**, keyed by the element's own id, because that
 * is what makes two people editing different shapes a merge rather than a
 * conflict: their updates touch different keys and Yjs never has to choose. Two
 * people editing the *same* shape do collide, and there the last writer wins —
 * per element, not per field. An element is small and its fields are read
 * together (a fill and a stroke that disagree would be worse than either), so
 * finer granularity would buy nothing but complexity.
 *
 * **Order is a field, not the map.** A Y.Map has no order, and a diagram's node
 * array *is* its z-order (later is drawn on top) as well as its parents-first
 * invariant. Keeping the index inside each entry means a z-order command
 * rewrites the entries it moved and nothing else — where a single shared array
 * of ids would be one key every edit fights over.
 */
import * as Y from 'yjs';
import type { DiagramData, DiagramDefaults, DiagramViewport, SerializedEdge, SerializedNode } from './types.js';

/** The `Y.Doc` top-level keys. Changing one is a format change. */
export const NODES_KEY = 'nodes';
export const EDGES_KEY = 'edges';
export const META_KEY = 'meta';

/**
 * The `meta` map's keys: where the canvas was left, the board's defaults, which
 * shapes stand for the board on its dashboard card, the round of dot voting it
 * is in, and its shared countdown. All but the first are read back out — see
 * each one.
 */
export const VIEWPORT_KEY = 'viewport';
/**
 * The style new elements are drawn in on this board (⌘⇧D).
 *
 * In `meta` alongside the viewport, and the one thing there that **is** read
 * back out: a default is a property of the board, so a collaborator drawing a
 * shape after somebody set one must get it. (The viewport is the opposite: a
 * peer scrolling their window must not move yours.)
 */
export const DEFAULTS_KEY = 'defaults';
/**
 * The shapes the dashboard card shows instead of the whole board.
 *
 * Read back out like the defaults and unlike the viewport: which picture stands
 * for the board is a property of the board, so a collaborator setting one has
 * to reach every window — the card is the same card for all of them.
 */
export const THUMBNAIL_KEY = 'thumbnailNodeIds';
/**
 * The round of dot voting the board is in.
 *
 * Read back out like the defaults and the thumbnail: everybody on the board is
 * in the same round, with the same budget, and the moment the totals are
 * revealed has to be the same moment in every window — otherwise one person is
 * still voting blind while another is reading the answers.
 */
export const VOTING_KEY = 'voting';
/**
 * The board's shared countdown, as the instant it runs out.
 *
 * Read back out for the same reason, and stored as an **end time** so that
 * nothing has to tick through the document: each window subtracts its own clock
 * from this. See `src/lib/timer.ts`.
 */
export const TIMER_KEY = 'timer';

/**
 * One element in the document: the JSON the app has always written, plus where
 * it sits in the array it was read from.
 */
export interface DocEntry<T> {
  /** Index in the diagram's array — z-order, and parents before children. */
  order: number;
  value: T;
}

export type NodeEntries = Y.Map<DocEntry<SerializedNode>>;
export type EdgeEntries = Y.Map<DocEntry<SerializedEdge>>;

/** The nodes of `doc`, keyed by node id. Created on first access, as Yjs does. */
export function nodeEntries(doc: Y.Doc): NodeEntries {
  return doc.getMap<DocEntry<SerializedNode>>(NODES_KEY);
}

/** The edges of `doc`, keyed by edge id. */
export function edgeEntries(doc: Y.Doc): EdgeEntries {
  return doc.getMap<DocEntry<SerializedEdge>>(EDGES_KEY);
}

/** Everything about the diagram that is not one of its elements. */
export function docMeta(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(META_KEY);
}

/** True for a value that is really one of our entries. */
function isDocEntry(value: unknown): value is DocEntry<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<DocEntry<unknown>>;
  return typeof entry.order === 'number' && typeof entry.value === 'object' && entry.value !== null;
}

/**
 * A map's values in diagram order.
 *
 * The document is written by other browsers — including, after a rollback, ones
 * running a different build — so an entry that is not one is dropped rather
 * than rendered. Ties on `order` are broken by id: two clients can pick the
 * same index for different elements while offline, and a board that draws in a
 * different order in each window would be worse than an arbitrary but *agreed*
 * one.
 */
function orderedValues<T>(map: Y.Map<DocEntry<T>>): T[] {
  const entries: { id: string; order: number; value: T }[] = [];
  for (const [id, entry] of map) {
    if (!isDocEntry(entry)) continue;
    entries.push({ id, order: entry.order, value: entry.value as T });
  }
  entries.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return entries.map((entry) => entry.value);
}

/** The document's nodes, in array order. */
export function nodesOf(doc: Y.Doc): SerializedNode[] {
  return orderedValues(nodeEntries(doc));
}

/** The document's edges, in array order. */
export function edgesOf(doc: Y.Doc): SerializedEdge[] {
  return orderedValues(edgeEntries(doc));
}

/**
 * Where the canvas was left, if the document says.
 *
 * Validated rather than trusted for the reason `migrateDiagramData` validates
 * the stored one: it is handed to React Flow as a viewport, and a half-written
 * value would leave the board framed on nothing.
 */
export function viewportOf(doc: Y.Doc): DiagramViewport | undefined {
  const raw = docMeta(doc).get(VIEWPORT_KEY);
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { x, y, zoom } = raw as Partial<DiagramViewport>;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof zoom !== 'number') return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return undefined;
  return { x, y, zoom };
}

/**
 * The board's defaults as the document holds them, if it holds any.
 *
 * Only the *shape* of the value is checked here — that it is an object at all.
 * What is in it is another browser's writing, and narrowing it to the style
 * keys this build will act on is `sanitizeDefaults`' job (`src/lib/defaultStyle.ts`),
 * which every reader runs it through: this module describes the format and
 * holds no opinion about what a style is.
 */
export function defaultsOf(doc: Y.Doc): DiagramDefaults | undefined {
  const raw = docMeta(doc).get(DEFAULTS_KEY);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  return raw as DiagramDefaults;
}

/**
 * The board's custom thumbnail as the document holds it, if it holds one.
 *
 * Only that it is a list at all is checked here, for the reason `defaultsOf`
 * only checks that its value is an object: what is *in* it was written by
 * another browser, and narrowing it to ids is `sanitizeThumbnailIds`' job
 * (`src/lib/boardThumbnail.ts`), which every reader runs it through.
 */
export function thumbnailNodeIdsOf(doc: Y.Doc): unknown {
  return docMeta(doc).get(THUMBNAIL_KEY);
}

/**
 * The voting round the document holds, unnarrowed — `sanitizeVotingSession`
 * (`src/lib/voting.ts`) is what every reader runs it through, for the reason
 * `thumbnailNodeIdsOf` is left raw: this module describes the format and holds
 * no opinion about what a round of voting is.
 */
export function votingOf(doc: Y.Doc): unknown {
  return docMeta(doc).get(VOTING_KEY);
}

/** The board's countdown, unnarrowed. `sanitizeTimer` (`src/lib/timer.ts`) is the gate. */
export function timerOf(doc: Y.Doc): unknown {
  return docMeta(doc).get(TIMER_KEY);
}

/**
 * Whether anything has ever been written to `doc` — the question `fetch` asks
 * to decide whether a diagram still needs seeding from its JSON.
 *
 * A diagram really can be empty (a new one is), so this is about the document
 * having been *populated*, not about the board having shapes on it: the meta
 * map carries a marker for exactly that.
 */
export const SEEDED_KEY = 'seeded';

export function isSeeded(doc: Y.Doc): boolean {
  return docMeta(doc).get(SEEDED_KEY) === true;
}

/**
 * Replace the document's contents with `data`, in one transaction.
 *
 * Used for the lazy upgrade (seeding from `Diagram.data` the first time a
 * diagram is opened collaboratively) and for a version restore, which is the
 * same act: the board becomes something else entirely. One transaction so that
 * every peer sees the new diagram arrive whole rather than watching the old one
 * be dismantled element by element.
 *
 * Elements the new data does not have are deleted rather than left behind —
 * this is a replacement, not a merge. `data` must already have been through
 * `migrateDiagramData`; this module holds no opinion about formats.
 */
export function writeDiagramIntoDoc(doc: Y.Doc, data: DiagramData, origin?: unknown): void {
  doc.transact(() => {
    writeElements(nodeEntries(doc), data.nodes);
    writeElements(edgeEntries(doc), data.edges);
    const meta = docMeta(doc);
    if (data.viewport) meta.set(VIEWPORT_KEY, data.viewport);
    else meta.delete(VIEWPORT_KEY);
    if (data.defaults) meta.set(DEFAULTS_KEY, data.defaults);
    else meta.delete(DEFAULTS_KEY);
    if (data.thumbnailNodeIds) meta.set(THUMBNAIL_KEY, data.thumbnailNodeIds);
    else meta.delete(THUMBNAIL_KEY);
    if (data.voting) meta.set(VOTING_KEY, data.voting);
    else meta.delete(VOTING_KEY);
    if (data.timer) meta.set(TIMER_KEY, data.timer);
    else meta.delete(TIMER_KEY);
    meta.set(SEEDED_KEY, true);
  }, origin);
}

/** The replace half of `writeDiagramIntoDoc`, for one of the two maps. */
function writeElements<T extends { id: string }>(map: Y.Map<DocEntry<T>>, elements: T[]): void {
  const kept = new Set(elements.map((element) => element.id));
  for (const id of [...map.keys()]) {
    if (!kept.has(id)) map.delete(id);
  }
  elements.forEach((value, order) => {
    map.set(value.id, { order, value });
  });
}
