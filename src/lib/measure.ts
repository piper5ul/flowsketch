/**
 * The pure half of ⌥-hover measuring: the gaps between two boxes on the board,
 * as segments to draw and the distance each one spans. A gap exists on an
 * axis only where the boxes do not overlap on it; a box beside another has a
 * horizontal gap, one above it a vertical one, one diagonal to it both.
 */
import type { Rect } from './edgeGeometry';

export interface GapSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The distance in board px, rounded. */
  label: number;
}

export function measureGaps(a: Rect, b: Rect): GapSegment[] {
  const out: GapSegment[] = [];
  // Horizontal gap: between the facing vertical edges, drawn at the middle of
  // the rows they share (or of `a` when they share none).
  if (b.x >= a.x + a.width || a.x >= b.x + b.width) {
    const left = a.x < b.x ? a : b;
    const right = left === a ? b : a;
    const x1 = left.x + left.width;
    const x2 = right.x;
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    const y = bottom > top ? (top + bottom) / 2 : a.y + a.height / 2;
    out.push({ x1, y1: y, x2, y2: y, label: Math.round(x2 - x1) });
  }
  if (b.y >= a.y + a.height || a.y >= b.y + b.height) {
    const upper = a.y < b.y ? a : b;
    const lower = upper === a ? b : a;
    const y1 = upper.y + upper.height;
    const y2 = lower.y;
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const x = right > left ? (left + right) / 2 : a.x + a.width / 2;
    out.push({ x1: x, y1, x2: x, y2, label: Math.round(y2 - y1) });
  }
  return out;
}
