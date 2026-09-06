import type { ShapeKind } from '../types';

/**
 * The shape kinds drawn as a single filled SVG outline rather than as a styled
 * `<div>`. A CSS box can be a rectangle, a pill or an ellipse; anything with a
 * corner CSS cannot round to gets a path instead.
 */
export type ClipShapeKind =
  | 'diamond'
  | 'triangle'
  | 'hexagon'
  | 'parallelogram'
  | 'document'
  | 'cloud'
  | 'star'
  | 'callout'
  | 'arrow';

/**
 * Every outline is drawn in the same 0–100 square and stretched to the node's
 * box by `preserveAspectRatio="none"`, so a path here is a *proportional*
 * description of a shape and never a pixel one. Each has to be closed (`Z`):
 * they are filled, not stroked open.
 */
export const svgPaths: Record<ClipShapeKind, string> = {
  diamond: 'M 50 0 L 100 50 L 50 100 L 0 50 Z',
  triangle: 'M 50 0 L 100 100 L 0 100 Z',
  hexagon: 'M 25 0 L 75 0 L 100 50 L 75 100 L 25 100 L 0 50 Z',
  parallelogram: 'M 22 0 L 100 0 L 78 100 L 0 100 Z',
  // A flowchart document: a page whose bottom edge ripples.
  document: 'M 0 0 L 100 0 L 100 84 C 75 100 75 68 50 84 C 25 100 25 68 0 84 Z',
  cloud:
    'M 22 88 C 9 88 0 78 0 66 C 0 55 8 46 19 45 C 21 29 34 17 50 17 C 64 17 76 26 80 39 C 92 41 100 51 100 63 C 100 77 89 88 76 88 Z',
  star: 'M 50 2 L 62 34 L 97 35 L 69 56 L 79 90 L 50 70 L 21 90 L 31 56 L 3 35 L 38 34 Z',
  // A speech bubble. The tail is short on purpose: the label is centred in the
  // whole box, so a deep tail would push the text visibly off-centre.
  callout:
    'M 8 0 L 92 0 Q 100 0 100 8 L 100 77 Q 100 85 92 85 L 34 85 L 20 100 L 20 85 L 8 85 Q 0 85 0 77 L 0 8 Q 0 0 8 0 Z',
  // A right-pointing block arrow. Its shaft spans the vertical middle, so a
  // centred label sits on the shaft rather than in the head.
  arrow: 'M 0 25 L 62 25 L 62 2 L 100 50 L 62 98 L 62 75 L 0 75 Z',
};

/** True for the kinds `svgPaths` can draw — the rest are CSS boxes. */
export function isClipShape(kind: ShapeKind): kind is ClipShapeKind {
  return kind in svgPaths;
}

/**
 * How far a label has to sit in from each edge of the node's box, as a
 * percentage of that box — the same 0–100 scale the paths are drawn in, so an
 * inset stays right at every size the shape is stretched to.
 *
 * A rectangle's whole face holds text, but a silhouette's does not: a star is
 * mostly points, a callout's tail hangs below the bubble it belongs to, and an
 * arrow's head is no place for a word. Zero on every side is therefore the
 * answer for a box, and the table below is the exceptions.
 */
export interface TextInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_INSET: TextInset = { top: 0, right: 0, bottom: 0, left: 0 };

const TEXT_INSETS: Partial<Record<ShapeKind, TextInset>> = {
  // The pentagon between the points. At mid-height the star spans x 23–77, and
  // it narrows sharply above y≈34 and below y≈70.
  star: { top: 28, right: 23, bottom: 26, left: 23 },
  // The bubble stops at y=85; below that is only the tail.
  callout: { top: 4, right: 8, bottom: 20, left: 8 },
  // The bottom edge ripples around y=84, so the last sixth of the box is only
  // sometimes there.
  document: { top: 4, right: 8, bottom: 20, left: 8 },
  // Full width only below the top bump, which starts around y=45.
  cloud: { top: 30, right: 14, bottom: 16, left: 14 },
  // The one lopsided inset: the shaft runs to x=62 and the head fills the rest,
  // so the label sits on the shaft rather than in the point.
  arrow: { top: 28, right: 42, bottom: 28, left: 6 },
};

export function textInset(kind: ShapeKind): TextInset {
  return TEXT_INSETS[kind] ?? NO_INSET;
}
