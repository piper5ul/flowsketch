import type { Direction, EdgeAnchor } from '../types';

export type { EdgeAnchor };
export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

/** The point on a rect's border for a given side + fraction-along-that-side anchor. */
export function anchorToPoint(anchor: EdgeAnchor, rect: Rect): Point {
  const { x, y, width: w, height: h } = rect;
  switch (anchor.side) {
    case 'top':
      return { x: x + anchor.t * w, y };
    case 'bottom':
      return { x: x + anchor.t * w, y: y + h };
    case 'left':
      return { x, y: y + anchor.t * h };
    case 'right':
      return { x: x + w, y: y + anchor.t * h };
  }
}

/**
 * `point` moved `gap` px straight out from the side it sits on — the direction
 * a connector leaves a shape in — so the line starts a little clear of the
 * edge without changing which way it sets off.
 */
export function standoff(point: Point, side: Direction, gap: number): Point {
  switch (side) {
    case 'top':
      return { x: point.x, y: point.y - gap };
    case 'bottom':
      return { x: point.x, y: point.y + gap };
    case 'left':
      return { x: point.x - gap, y: point.y };
    case 'right':
      return { x: point.x + gap, y: point.y };
  }
}

function closestPointOnSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: x1 + t * dx, y: y1 + t * dy, t };
}

/**
 * The nearest border anchor to a free point, snapping to each side's corners
 * and midpoint within `snapDistance` so endpoints click into place rather
 * than landing at an arbitrary fraction along the border.
 */
export function nearestAnchorOnRect(px: number, py: number, rect: Rect, snapDistance = 10): EdgeAnchor {
  const { x, y, width: w, height: h } = rect;
  const sides: { side: Direction; p: { x: number; y: number; t: number } }[] = [
    { side: 'top', p: closestPointOnSegment(px, py, x, y, x + w, y) },
    { side: 'right', p: closestPointOnSegment(px, py, x + w, y, x + w, y + h) },
    { side: 'bottom', p: closestPointOnSegment(px, py, x, y + h, x + w, y + h) },
    { side: 'left', p: closestPointOnSegment(px, py, x, y, x, y + h) },
  ];

  let best = sides[0];
  let bestDist = Infinity;
  for (const s of sides) {
    const d = Math.hypot(s.p.x - px, s.p.y - py);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }

  const sideLength = best.side === 'top' || best.side === 'bottom' ? w : h;
  let t = best.p.t;
  if (t * sideLength <= snapDistance) t = 0;
  else if ((1 - t) * sideLength <= snapDistance) t = 1;
  else if (Math.abs(t - 0.5) * sideLength <= snapDistance) t = 0.5;

  return { side: best.side, t };
}

/** Determine which side of each rect faces the other (for default anchor placement). */
export function floatingEdgeSides(a: Rect, b: Rect): { sourcePos: Direction; targetPos: Direction } {
  const aCx = a.x + a.width / 2, aCy = a.y + a.height / 2;
  const bCx = b.x + b.width / 2, bCy = b.y + b.height / 2;
  const dx = bCx - aCx, dy = bCy - aCy;
  let sourcePos: Direction, targetPos: Direction;
  if (Math.abs(dx) > Math.abs(dy)) {
    sourcePos = dx > 0 ? 'right' : 'left';
    targetPos = dx > 0 ? 'left' : 'right';
  } else {
    sourcePos = dy > 0 ? 'bottom' : 'top';
    targetPos = dy > 0 ? 'top' : 'bottom';
  }
  return { sourcePos, targetPos };
}

/** Straight-line distance from a point to the nearest edge of a rect (0 if inside). */
export function distanceToRect(px: number, py: number, rect: Rect): number {
  const dx = Math.max(rect.x - px, 0, px - (rect.x + rect.width));
  const dy = Math.max(rect.y - py, 0, py - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

