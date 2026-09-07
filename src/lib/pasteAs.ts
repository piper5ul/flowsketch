/**
 * "Paste as" — the geometry half of turning pasted text into objects.
 *
 * Whimsical lets you copy a bulleted list, right-click the board and paste it
 * as sticky notes: one note per line, laid out in a tidy block. This module is
 * what "one note per line" and "a tidy block" mean, and nothing else — it is
 * pure and structural like `arrange.ts` and `autoLayout.ts`: text and sizes in,
 * plain boxes out, no store, no React and no idea what a sticky note is.
 *
 * `mermaid.ts` is the other half of the feature (a flowchart rather than a
 * list); the two share `stackAlong` below, which is where a freshly parsed set
 * of shapes is put before the layout engine is asked to arrange them.
 */

/** A box "paste as" wants drawn: a label and where it goes, in board coordinates. */
export interface PastedBox {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The gap left between two pasted boxes, across and down. */
export const PASTE_GAP = 24;

/**
 * The widest a pasted grid gets.
 *
 * Rows of `ceil(sqrt(n))` keep a short list square — three lines make a 2×2
 * block rather than a column three screens tall — but the square stops being
 * the readable shape somewhere around two dozen notes, so the row length is
 * capped and a long list grows downwards from there.
 */
export const MAX_PER_ROW = 5;

/** What a sticky note pasted from a list is, when the caller does not say. */
const DEFAULT_BOX = { width: 160, height: 160 };

/**
 * A leading list marker: a bullet (`-`, `*`, `•`, `+`, `·`) or a number
 * (`1.`, `2)`). Whatever the list was written in, what the user wants on the
 * note is the words.
 *
 * The trailing space is optional at the end of a line, which is what turns a
 * `---` rule between two lists into a blank the next step drops. It is *not*
 * optional otherwise, so `**bold**` and `-30 degrees` keep every character.
 */
const LIST_MARKER = /^(?:[-*•+·]+|\d+[.)])(?:\s+|$)/;

/** A markdown checkbox, which follows the bullet in `- [ ] ship it`. */
const CHECKBOX = /^\[[ xX]\]\s+/;

/**
 * The lines of `text` worth making something out of: trimmed, stripped of the
 * list markers the clipboard brought with them, and with the blanks dropped.
 *
 * Blank lines go because a list pasted out of a document is full of them and a
 * blank sticky note is not something anybody asked for. A line that was
 * *only* a marker ("---", say) becomes blank here and goes the same way.
 */
export function linesOf(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stripped = raw.trim().replace(LIST_MARKER, '').replace(CHECKBOX, '').trim();
    if (stripped) lines.push(stripped);
  }
  return lines;
}

/**
 * One box per line, laid out in rows with their top-left corner at `origin`.
 *
 * The row length is `ceil(sqrt(n))` capped at `MAX_PER_ROW`, which is what
 * makes four lines a square, nine lines a 3×3 and a shopping list a block five
 * wide. The last row is left short rather than centred: a ragged edge is what
 * every other grid on the board looks like.
 */
export function stickyGrid(
  lines: readonly string[],
  origin: Point,
  options: { width?: number; height?: number; gap?: number; maxPerRow?: number } = {},
): PastedBox[] {
  const width = options.width ?? DEFAULT_BOX.width;
  const height = options.height ?? DEFAULT_BOX.height;
  const gap = options.gap ?? PASTE_GAP;
  const maxPerRow = options.maxPerRow ?? MAX_PER_ROW;

  const perRow = Math.max(1, Math.min(maxPerRow, Math.ceil(Math.sqrt(lines.length))));
  return lines.map((label, i) => ({
    label,
    x: origin.x + (i % perRow) * (width + gap),
    y: origin.y + Math.floor(i / perRow) * (height + gap),
    width,
    height,
  }));
}

/**
 * `sizes` in a single line — a column going down, a row going across — with the
 * whole run's top-left corner at `origin`.
 *
 * This is where a parsed Mermaid flowchart lands *before* auto-layout is run
 * over it, and the corner is the point: `applyLayout` moves the laid-out result
 * onto the top-left of the selection's existing bounding box, so putting every
 * box against `origin`'s edges is what makes the finished flowchart arrive
 * exactly where the user right-clicked. It is also the answer that stands when
 * there is nothing for the layout engine to do — a one-shape chart, or shapes
 * with no connectors between them — which is why the boxes are spread out
 * rather than stacked on one spot.
 */
export function stackAlong(
  sizes: readonly { width: number; height: number }[],
  origin: Point,
  axis: 'vertical' | 'horizontal',
  gap: number = PASTE_GAP,
): Point[] {
  const out: Point[] = [];
  let offset = 0;
  for (const size of sizes) {
    out.push(
      axis === 'vertical'
        ? { x: origin.x, y: origin.y + offset }
        : { x: origin.x + offset, y: origin.y },
    );
    offset += (axis === 'vertical' ? size.height : size.width) + gap;
  }
  return out;
}
