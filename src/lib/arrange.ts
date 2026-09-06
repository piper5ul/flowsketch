/**
 * Geometry for the arrange commands (align, distribute, match size).
 *
 * Everything here is pure and works on plain rects, so it can be unit-tested
 * without a store or a React Flow node. The store maps its selection onto
 * `ArrangeRect`s, calls one of these, and applies the result — which is also
 * where locked nodes are filtered out, since a lock is not a geometric idea.
 */

export interface ArrangeRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
export type DistributeAxis = 'x' | 'y';
export type MatchDimension = 'width' | 'height' | 'both';

export interface ArrangePosition {
  x: number;
  y: number;
}

export interface ArrangeSize {
  w: number;
  h: number;
}

/**
 * Aligns every rect to the selection's own bounding box: `left` puts each left
 * edge on the leftmost edge in the selection, `centerX` centres each rect on
 * the box's vertical centre line, and so on. The axis the mode does not name is
 * never touched.
 *
 * Returns the new position of every rect (unchanged ones included), keyed by id;
 * empty when there is nothing to align to — a single rect is its own bounding
 * box and would never move.
 */
export function alignNodes(rects: ArrangeRect[], mode: AlignMode): Record<string, ArrangePosition> {
  const moved: Record<string, ArrangePosition> = {};
  if (rects.length < 2) return moved;

  const left = Math.min(...rects.map((r) => r.x));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const top = Math.min(...rects.map((r) => r.y));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;

  for (const rect of rects) {
    let { x, y } = rect;
    switch (mode) {
      case 'left':
        x = left;
        break;
      case 'centerX':
        x = centerX - rect.w / 2;
        break;
      case 'right':
        x = right - rect.w;
        break;
      case 'top':
        y = top;
        break;
      case 'centerY':
        y = centerY - rect.h / 2;
        break;
      case 'bottom':
        y = bottom - rect.h;
        break;
    }
    moved[rect.id] = { x, y };
  }
  return moved;
}

/**
 * Spreads the rects so the *gaps between their edges* are equal — not their
 * centres, which is the distinction that matters the moment two shapes are
 * different sizes. The outermost two never move: the span they define is what
 * the rest are spread inside, so distributing twice changes nothing.
 *
 * Rects are ordered by position along the axis, whatever order they arrive in.
 * Returns the new position of every rect, keyed by id; empty below three rects,
 * where there is no middle to move.
 */
export function distributeNodes(rects: ArrangeRect[], axis: DistributeAxis): Record<string, ArrangePosition> {
  const moved: Record<string, ArrangePosition> = {};
  if (rects.length < 3) return moved;

  const horizontal = axis === 'x';
  const start = (r: ArrangeRect) => (horizontal ? r.x : r.y);
  const extent = (r: ArrangeRect) => (horizontal ? r.w : r.h);

  const ordered = [...rects].sort((a, b) => start(a) - start(b) || a.id.localeCompare(b.id));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const span = start(last) + extent(last) - start(first);
  const occupied = ordered.reduce((total, r) => total + extent(r), 0);
  const gap = (span - occupied) / (ordered.length - 1);

  let cursor = start(first);
  for (const rect of ordered) {
    moved[rect.id] = horizontal ? { x: cursor, y: rect.y } : { x: rect.x, y: cursor };
    cursor += extent(rect) + gap;
  }
  // Accumulating the gap can leave the last rect a float's-width off the
  // position it is supposed to have kept, so it is pinned rather than computed.
  moved[last.id] = { x: last.x, y: last.y };
  return moved;
}

/**
 * Gives every rect the size of the largest one in the set (by area). Selection
 * order is not tracked anywhere in the app — the store only knows *which* nodes
 * are selected — so "the largest" is the reference a user can predict without
 * remembering which shape they clicked first.
 *
 * Rects keep their position, so they grow (or shrink) from their top-left
 * corner. Returns the new size of every rect, keyed by id; empty below two.
 */
export function matchSize(rects: ArrangeRect[], dim: MatchDimension): Record<string, ArrangeSize> {
  const sized: Record<string, ArrangeSize> = {};
  if (rects.length < 2) return sized;

  const reference = rects.reduce((biggest, r) => (r.w * r.h > biggest.w * biggest.h ? r : biggest), rects[0]);
  for (const rect of rects) {
    sized[rect.id] = {
      w: dim === 'height' ? rect.w : reference.w,
      h: dim === 'width' ? rect.h : reference.h,
    };
  }
  return sized;
}
