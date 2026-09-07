/**
 * Keeping the public `/s/:token` page in step with the board's *live* state.
 *
 * That page opens no socket — the token is the whole credential and a document
 * connection needs a session — so it loads the diagram once over HTTP and
 * everything on it is frozen from that moment. For the drawing that is exactly
 * right: a shared link is a look at the board as it was handed over. For the
 * two pieces of state that are about **now** it is not: a timer started after
 * the page loaded never appears, and a round of voting opened after it never
 * reveals its totals.
 *
 * So the page re-reads `GET /api/shared/:token` on a slow interval and takes
 * only those two fields off it. The rest of the response is deliberately
 * ignored: re-loading the diagram would reset the viewport under a reader who
 * has scrolled somewhere, and a board that redrew itself every half minute is
 * not what a shared link is for.
 *
 * The interval is 30 s, which is 30 requests per fifteen minutes per viewer
 * against a route limited to 300 (`rateLimit.ts`) — ten readers on one link
 * before the limiter is the thing deciding, and a timer that appears within
 * half a minute is a timer somebody can still act on.
 *
 * Pure, like `arrange.ts` and `search.ts`: what changed is decided here, and
 * `SharedPage` owns the interval, the visibility listener and the store write.
 */
import type { BoardTimer, VotingSession } from '../../shared/types.js';
import { sanitizeTimer } from './timer.js';
import { sanitizeVotingSession } from './voting.js';

/** How often the page re-reads the shared diagram. See the note above. */
export const SHARED_POLL_MS = 30_000;

/**
 * The parts of a shared board that go on changing after the page has loaded.
 *
 * Only these two. The shapes, the title and the images are what the link was
 * shared for and are not re-read; the viewport is the reader's own.
 */
export interface LiveBoardState {
  voting: VotingSession | null;
  timer: BoardTimer | null;
}

/**
 * The live state a shared diagram's stored JSON describes.
 *
 * Narrowed through the same two gates every other reader uses, and read
 * straight off the payload rather than through `migrateDiagramData`: a poll
 * wants two fields, not a migrated board, and neither field has ever had a
 * version step behind it (absent means "no round" and "no countdown", which is
 * what every diagram written before they existed already means).
 */
export function liveBoardStateOf(data: unknown): LiveBoardState {
  const raw = (typeof data === 'object' && data !== null ? data : {}) as {
    voting?: unknown;
    timer?: unknown;
  };
  return { voting: sanitizeVotingSession(raw.voting), timer: sanitizeTimer(raw.timer) };
}

/**
 * What the poll found had changed, or `null` when nothing had.
 *
 * A patch rather than a boolean so the caller writes only the field that moved:
 * a store write is a render, and a page that re-rendered every thirty seconds
 * because a timer's end time is the same string it was would be worse than not
 * polling at all. Compared by value — the two objects come from different
 * parses of the same JSON and are never the same reference.
 */
export function liveBoardPatch(
  shown: LiveBoardState,
  fetched: LiveBoardState,
): Partial<LiveBoardState> | null {
  const patch: Partial<LiveBoardState> = {};
  if (!sameValue(shown.voting, fetched.voting)) patch.voting = fetched.voting;
  if (!sameValue(shown.timer, fetched.timer)) patch.timer = fetched.timer;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** True when two of these small plain objects say the same thing. */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
