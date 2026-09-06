/**
 * How a stored version reads in the history panel.
 *
 * Formatting is done here rather than with `toLocaleString` because a version
 * list is scanned, not read: "Today 14:03" and "Yesterday 09:12" answer "which
 * one do I want?" in a way that a full date never does, and the same string has
 * to come out on every machine for the tests to say anything.
 */
import type { DiagramVersionMeta } from '../../shared/types';

/** Longest label the API accepts on a manual snapshot (`server/validation.ts`). */
export const MAX_VERSION_LABEL_CHARS = 100;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Same calendar day in the reader's own timezone, which is the one they think in. */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * When a snapshot was taken, relative to `now` where that helps: `Today 14:03`,
 * `Yesterday 09:12`, `5 Sep 14:03`, and the year as well once it is not this
 * one. An unparseable timestamp comes back as an empty string rather than
 * "Invalid Date" — one bad row must not be the loudest thing in the list.
 */
export function formatVersionTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';

  const clock = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  if (isSameDay(at, now)) return `Today ${clock}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(at, yesterday)) return `Yesterday ${clock}`;

  const day = `${at.getDate()} ${MONTHS[at.getMonth()]}`;
  return at.getFullYear() === now.getFullYear()
    ? `${day} ${clock}`
    : `${day} ${at.getFullYear()} ${clock}`;
}

/**
 * One line naming a version: when, by whom, and what it was called —
 * "Today 14:03 · Pushkar · Before restore".
 *
 * The author is missing when their account has gone (the snapshot outlives
 * them, `SetNull`), and the label is missing on every automatic snapshot, so
 * the parts are joined rather than laid out: an entry never carries a dangling
 * separator with nothing after it.
 */
export function describeVersion(version: DiagramVersionMeta, now?: Date): string {
  return [formatVersionTime(version.createdAt, now), version.createdBy?.name, version.label]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' · ');
}
