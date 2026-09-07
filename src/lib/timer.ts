/**
 * The board timer: Whimsical's "using the timer in boards", where anyone starts
 * a countdown and everybody sharing the board sees the same one.
 *
 * **A timer is an end time, not a countdown.** `DiagramData.timer` stores the
 * instant it runs out and nothing else; every window subtracts its own clock
 * from that and draws the seconds left. That is the whole design decision here,
 * and it is what keeps a ticking number *out* of the shared document: a
 * countdown stored as "seconds remaining" would have to be written once a
 * second, by somebody — sixty updates a minute on the wire, a fight over one key
 * between every window, and an undo stack full of them. An end time is written
 * once when the timer starts and once when it is stopped.
 *
 * The cost is that a window whose clock is minutes out shows a countdown minutes
 * out. That is the right trade: the alternative is a document nobody can leave
 * alone, and a wall clock is the one thing every browser already agrees about to
 * within a few seconds.
 *
 * Pure, and dependency-free but for the type: `migrateDiagramData` (a stored
 * row), `server/collab/render.ts` (a rendered snapshot) and
 * `src/lib/collab/binding.ts` (a peer's write) all narrow through the same
 * `sanitizeTimer`. Relative imports spell out `.js` — the server compiles this
 * under `nodenext`, see the note on `diagramMigrations.ts` in CLAUDE.md.
 */
import type { BoardTimer } from '../../shared/types.js';

/** The buttons the timer panel offers, in minutes. */
export const TIMER_PRESET_MINUTES = [1, 3, 5, 10] as const;

/** The longest countdown that can be started. Three hours is a workshop, not a sprint. */
export const MAX_TIMER_SECONDS = 3 * 60 * 60;

/** What a timer is: running, finished but not yet stopped, or absent. */
export type TimerState = 'running' | 'done' | 'none';

/**
 * How long `endsAt` has left, in whole seconds, from `now`.
 *
 * Rounded **up**, so a timer with 200 ms left still reads "1" rather than "0":
 * the number reaching zero is what the UI treats as the end, and it must not
 * arrive before the timer has actually run out. Never negative, and `0` for a
 * value that is not a date at all — a free-form JSON column holds anything.
 */
export function remainingSeconds(endsAt: string, now: number): number {
  const end = Date.parse(endsAt);
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

/**
 * `seconds` as a clock reads it — `2:05`, `0:09`, `12:00`.
 *
 * Minutes are not wrapped into hours: a ninety-minute timer reads `90:00`, which
 * is unambiguous and needs no third field for the one case in a hundred that
 * runs past an hour. Formatted by hand rather than through `toLocaleString` for
 * the reason `versionHistory.ts` formats its entries by hand — the same string
 * has to come out on every machine.
 */
export function formatRemaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}

/**
 * What the board's timer is doing at `now`.
 *
 * `'done'` is a state of its own rather than "no timer": a countdown that has
 * run out is still on the board — that is what makes the flash and the "Time's
 * up" label possible — until somebody stops it. Only stopping it removes the
 * timer, and anybody may.
 */
export function timerState(timer: BoardTimer | null | undefined, now: number): TimerState {
  if (!timer) return 'none';
  if (Number.isNaN(Date.parse(timer.endsAt))) return 'none';
  return remainingSeconds(timer.endsAt, now) > 0 ? 'running' : 'done';
}

/**
 * The timer a stored value describes, if it describes one.
 *
 * `endsAt` has to parse — everything downstream subtracts a clock from it, and a
 * half-written value would leave a board showing a countdown that never moves.
 * `label` is optional and is dropped when it is not a string; it is drawn as
 * text and nothing else, so it needs no further narrowing.
 */
export function sanitizeTimer(value: unknown): BoardTimer | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Partial<BoardTimer>;
  if (typeof raw.endsAt !== 'string' || Number.isNaN(Date.parse(raw.endsAt))) return null;
  if (typeof raw.startedById !== 'string' || raw.startedById.length === 0) return null;
  return {
    endsAt: raw.endsAt,
    startedById: raw.startedById,
    ...(typeof raw.label === 'string' && raw.label.length > 0 ? { label: raw.label } : {}),
  };
}
