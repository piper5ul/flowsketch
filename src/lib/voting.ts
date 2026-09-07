/**
 * Dot voting: what a round of it *is*, and how the dots on a board are counted.
 *
 * Whimsical's "voting on sticky notes" — somebody starts a round, everybody gets
 * N dots to spend, the totals stay hidden until the round is closed, and the
 * board can then be sorted by them. Two pieces of state carry that, and they sit
 * on opposite sides of the diagram:
 *
 * - **The dots are node data.** `ShapeData.votes` is a map of voter id → how
 *   many of their dots are on that shape. Absent is a shape nobody has voted
 *   for, which is every shape saved before this existed — so there is no
 *   migration step, exactly as for `fillStyle` and `mindMap`.
 * - **The round is board meta.** `DiagramData.voting` rides in the collaborative
 *   document's `meta` map beside `defaults` and `thumbnailNodeIds`, and is read
 *   back out for the same reason both of those are: a round of voting is a
 *   property of the *board*, so a collaborator has to be in the same round —
 *   with the same budget, and with the totals hidden or shown as everyone else
 *   sees them.
 *
 * The module is pure and knows nothing about the store, React or Yjs, which is
 * what lets `migrateDiagramData` (a stored row), `server/collab/render.ts` (a
 * document rendered to JSON) and `src/lib/collab/binding.ts` (a peer's write)
 * all narrow the same untrusted value through the same `sanitizeVotingSession`.
 *
 * Relative imports spell out `.js`: the server compiles this under `nodenext`,
 * see the note on `diagramMigrations.ts` in CLAUDE.md.
 */
import type { VotingSession } from '../../shared/types.js';

/** What a round starts with when nobody says otherwise — Whimsical's own. */
export const DEFAULT_DOTS_PER_PERSON = 3;

/**
 * The most dots one person can be given. A ceiling rather than a rule about
 * facilitation: the number arrives from another browser through the document,
 * and an unbounded one would let a peer hand everybody a budget no counter can
 * usefully draw.
 */
export const MAX_DOTS_PER_PERSON = 20;

/** The least a round can be run with. One dot each is a poll, which is fine. */
export const MIN_DOTS_PER_PERSON = 1;

/**
 * Anything with an id and a free-form data bag — a store node or a serialized
 * one. Structural on purpose: this module is read from both sides of the wire
 * and neither `ShapeNode` nor `SerializedNode` belongs to it.
 */
export interface VotableNode {
  id: string;
  data: Record<string, unknown>;
}

/**
 * The dots on one shape, if what is stored is dots at all.
 *
 * `Diagram.data` is a free-form JSON column and the document is written by other
 * browsers, so an entry can be anything. A count that is not a positive whole
 * number is dropped rather than rounded: a fractional or negative dot is not a
 * vote somebody cast, it is a value nothing here wrote, and a total built out of
 * one would be wrong in a way no reader could see.
 */
export function sanitizeVotes(value: unknown): Record<string, number> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const votes: Record<string, number> = {};
  for (const [userId, count] of Object.entries(value as Record<string, unknown>)) {
    if (userId.length === 0) continue;
    if (typeof count !== 'number' || !Number.isFinite(count)) continue;
    const whole = Math.floor(count);
    if (whole < 1) continue;
    votes[userId] = whole;
  }
  return Object.keys(votes).length > 0 ? votes : undefined;
}

/** The dots on `node`, narrowed. `{}` for a shape nobody has voted for. */
export function votesOf(node: VotableNode): Record<string, number> {
  return sanitizeVotes(node.data.votes) ?? {};
}

/** How many dots `userId` has put on `node`. */
export function votesBy(node: VotableNode, userId: string | null | undefined): number {
  if (!userId) return 0;
  return votesOf(node)[userId] ?? 0;
}

/** Every dot on `node`, whoever put it there. */
export function voteCount(node: VotableNode): number {
  let total = 0;
  for (const count of Object.values(votesOf(node))) total += count;
  return total;
}

/**
 * The total on each shape that has one, keyed by node id.
 *
 * Shapes with no votes are left out rather than mapped to `0`: the callers ask
 * "which shapes are in this round" as often as they ask "how many", and an
 * entry per shape on the board would answer the first question wrongly.
 */
export function voteCounts(nodes: readonly VotableNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const total = voteCount(node);
    if (total > 0) counts.set(node.id, total);
  }
  return counts;
}

/** How many of their dots `userId` has spent, across the whole board. */
export function dotsUsed(nodes: readonly VotableNode[], userId: string | null | undefined): number {
  if (!userId) return 0;
  let used = 0;
  for (const node of nodes) used += votesBy(node, userId);
  return used;
}

/**
 * How many dots `userId` has left to place.
 *
 * Never negative: a budget that was lowered mid-round — or a peer's write that
 * spent more than this build would have allowed — leaves somebody over their
 * allowance, and "−2 dots left" is not something to show anybody. They simply
 * cannot place another.
 */
export function dotsLeft(
  nodes: readonly VotableNode[],
  userId: string | null | undefined,
  dotsPerPerson: number,
): number {
  return Math.max(0, dotsPerPerson - dotsUsed(nodes, userId));
}

/**
 * Whether `userId` may place another dot right now.
 *
 * Three things have to hold: a round is open, there is somebody to attribute the
 * dot to, and they have one left. A closed round is not a board to vote on, and
 * an anonymous reader of the public `/s/:token` page has no name to put against
 * a vote — which is the same rule commenting keeps.
 */
export function canVote(
  session: VotingSession | null | undefined,
  nodes: readonly VotableNode[],
  userId: string | null | undefined,
): boolean {
  if (!session?.active || !userId) return false;
  return dotsLeft(nodes, userId, session.dotsPerPerson) > 0;
}

/**
 * `nodes` most-voted first, and shapes with no votes at all dropped.
 *
 * Ties are broken by id rather than by where the shapes happen to sit: the order
 * has to be the same in every window, and nothing in this app tracks the order a
 * selection was made in.
 */
export function sortedByVotes<T extends VotableNode>(nodes: readonly T[]): T[] {
  return nodes
    .map((node) => ({ node, count: voteCount(node) }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0))
    .map((entry) => entry.node);
}

/** A node's box in **board** coordinates — what "sort by votes" is laid out in. */
export interface VoteRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The gap left between two shapes when a board is sorted into a row. */
export const VOTE_ROW_GAP = 40;

/**
 * `ordered` laid out left to right in one row, in the order it was given.
 *
 * The row starts at the group's own bounding-box corner and every shape keeps
 * the size it had — the same rule `applyLayout` keeps, and for the same reason:
 * the drawing must not jump somewhere else on the board because the user asked
 * for it to be tidied. Vertically the shapes are centred on the row's tallest,
 * so a short sticky beside a tall one reads as one line rather than as two.
 *
 * Positions come back in board coordinates; turning them into offsets from each
 * node's parent is the store's job (`commitArrangedPositions`).
 */
export function voteRowPositions(
  ordered: readonly VoteRect[],
  gap: number = VOTE_ROW_GAP,
): Record<string, { x: number; y: number }> {
  if (ordered.length === 0) return {};
  const left = Math.min(...ordered.map((rect) => rect.x));
  const top = Math.min(...ordered.map((rect) => rect.y));
  const tallest = Math.max(...ordered.map((rect) => rect.h));

  const positions: Record<string, { x: number; y: number }> = {};
  let x = left;
  for (const rect of ordered) {
    positions[rect.id] = { x, y: top + Math.round((tallest - rect.h) / 2) };
    x += rect.w + gap;
  }
  return positions;
}

/**
 * The round a stored value describes, if it describes one.
 *
 * Every field is required and is checked, because each one decides something a
 * reader acts on: `active` whether a dot can be placed, `revealed` whether the
 * totals are shown, `dotsPerPerson` how many everybody gets, `startedById` who
 * to attribute the round to. A value missing any of them is no round at all —
 * which is the same thing as an absent field, and is exactly what every diagram
 * written before voting existed holds.
 *
 * The budget is clamped rather than rejected: a peer running another build could
 * reasonably choose a number this one would not, and a round everybody can see
 * beats a round that silently vanished because of one field.
 */
export function sanitizeVotingSession(value: unknown): VotingSession | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Partial<VotingSession>;
  if (typeof raw.active !== 'boolean') return null;
  if (typeof raw.revealed !== 'boolean') return null;
  if (typeof raw.startedById !== 'string' || raw.startedById.length === 0) return null;
  if (typeof raw.dotsPerPerson !== 'number' || !Number.isFinite(raw.dotsPerPerson)) return null;
  const dotsPerPerson = Math.min(
    MAX_DOTS_PER_PERSON,
    Math.max(MIN_DOTS_PER_PERSON, Math.floor(raw.dotsPerPerson)),
  );
  return {
    active: raw.active,
    revealed: raw.revealed,
    dotsPerPerson,
    startedById: raw.startedById,
  };
}
