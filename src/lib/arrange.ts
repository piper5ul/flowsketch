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

export interface ArrangePosition {
  x: number;
  y: number;
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
