/**
 * Freehand strokes — the geometry, pure and free of React Flow and the store.
 *
 * A stroke is captured as a polyline in board coordinates, thinned by
 * `simplify`, boxed by `inkBounds` and drawn by `inkPath`. `strokeHits` is the
 * other direction: it is what the eraser asks of every stroke under the
 * pointer. Everything here is a function of its arguments, like `arrange.ts`
 * and `search.ts`, so the drawing gesture can be reasoned about without a
 * canvas — see `ink.test.ts`.
 *
 * The line is drawn as a **Catmull-Rom spline through the samples**, reusing
 * `catmullRomToBezier` from the connector's own path builder: it interpolates,
 * so the curve passes through every point the pointer actually reported rather
 * than being pulled towards them, and one smoothing rule for the whole app is
 * one fewer thing to be right about twice. Width is constant per stroke — a
 * variable-width outline (perfect-freehand and the like) would mean a *filled
 * polygon* rather than a stroked path, and with it a second answer to what a
 * stroke's colour, opacity and export look like; the pressure is captured
 * anyway (`InkPoint`) so that is a change of renderer, not of format.
 */
import { catmullRomToBezier, type Point } from './connectorPath';
import type { InkKind, InkPoint, Tool } from '../types';

/** How wide each pen draws, in board pixels. */
export const INK_WIDTH: Record<InkKind, number> = {
  marker: 4,
  highlighter: 18,
};

/**
 * How solid a highlighter is. A marker is fully opaque; a highlighter is a wash
 * you can still read the diagram through, which is the whole point of one.
 */
export const HIGHLIGHTER_OPACITY = 0.4;

/**
 * The pen's colour when the board has nothing to say about it.
 *
 * Not the default *swatch's* stroke: that is a hairline grey chosen to outline
 * a white box, and a pen drawing in it would be all but invisible. A picked
 * swatch still carries — `addInk` reads the same session/board default every
 * other creation path does — so this is only the very first stroke on a board
 * nobody has chosen a colour on.
 */
export const DEFAULT_INK_STROKE = '#334155';

/**
 * How far a sample may sit from the line between its neighbours before it is
 * kept. Half a pixel is below what any display can show at 100%, so the thinned
 * stroke is the same drawing — with a fraction of the points going into the
 * document.
 */
export const INK_SIMPLIFY_TOLERANCE = 0.5;

/** Fewer samples than this is a click, not a stroke, and draws nothing. */
export const MIN_INK_POINTS = 3;

/** How much further than the pen's own edge the eraser reaches, in px. */
export const ERASER_SLOP_PX = 4;

/** True for the three tools that draw or rub out freehand strokes. */
export function isInkTool(tool: Tool): boolean {
  return tool === 'pen' || tool === 'highlighter' || tool === 'eraser';
}

/** The pen a drawing tool holds — `null` for anything that is not one. */
export function inkKindOfTool(tool: Tool): InkKind | null {
  if (tool === 'pen') return 'marker';
  if (tool === 'highlighter') return 'highlighter';
  return null;
}

/** The box a stroke occupies, and the same points expressed inside it. */
export interface InkBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  /** `points`, moved so that the box's top-left is the origin. */
  points: InkPoint[];
}

/**
 * The node box `points` need, and those points relative to it.
 *
 * Grown by half the pen width on every side: the polyline is the *centre* of
 * the drawn line, so a box drawn tight around it would clip half the ink along
 * every edge — and, more visibly, would be a zero-height box for a perfectly
 * horizontal stroke, which React Flow cannot select or resize.
 */
export function inkBounds(points: InkPoint[], width: number): InkBounds {
  const pad = width / 2;
  if (points.length === 0) return { x: 0, y: 0, width, height: width, points: [] };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const x = minX - pad;
  const y = minY - pad;
  return {
    x,
    y,
    width: maxX - minX + width,
    height: maxY - minY + width,
    points: points.map((p) =>
      p.length > 2 ? ([p[0] - x, p[1] - y, p[2]] as InkPoint) : ([p[0] - x, p[1] - y] as InkPoint),
    ),
  };
}

/** The `d` of the stroke through `points`, smoothed. */
export function inkPath(points: InkPoint[]): string {
  if (points.length === 0) return '';
  const [first] = points;
  // A single sample is a dot: a zero-length run, which a round cap paints as
  // one. Two are a straight line — a spline through two points is one anyway.
  if (points.length === 1) return `M ${first[0]} ${first[1]} L ${first[0]} ${first[1]}`;
  if (points.length === 2) {
    return `M ${first[0]} ${first[1]} L ${points[1][0]} ${points[1][1]}`;
  }

  const through: Point[] = points.map(([x, y]) => ({ x, y }));
  const segments = catmullRomToBezier(through);
  const parts = [`M ${round(first[0])} ${round(first[1])}`];
  for (const s of segments) {
    parts.push(
      `C ${round(s.c1.x)} ${round(s.c1.y)}, ${round(s.c2.x)} ${round(s.c2.y)}, ${round(s.to.x)} ${round(s.to.y)}`,
    );
  }
  return parts.join(' ');
}

/** Two decimals is a hundredth of a pixel — past that it is only bytes. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The distance from `p` to the segment `a`–`b`. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  // A segment of no length is a point, and the projection below would divide by
  // zero — which is not hypothetical, since a paused pointer reports the same
  // place twice.
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * True when `point` is within `radius` of the polyline `points`.
 *
 * The test is against the *polyline*, not the smoothed curve the renderer
 * draws: the spline never leaves its samples by more than the smoothing pulls
 * it, which is well inside the slop the eraser is given anyway, and hit-testing
 * a Bézier means either sampling it or solving it.
 */
export function strokeHits(points: InkPoint[], point: Point, radius: number): boolean {
  if (points.length === 0) return false;
  if (points.length === 1) {
    return Math.hypot(point.x - points[0][0], point.y - points[0][1]) <= radius;
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = { x: points[i][0], y: points[i][1] };
    const b = { x: points[i + 1][0], y: points[i + 1][1] };
    if (distanceToSegment(point, a, b) <= radius) return true;
  }
  return false;
}

/**
 * `points` thinned by Ramer–Douglas–Peucker: every sample further than
 * `tolerance` from the line its neighbours make is kept, and the rest — the
 * ones a straight run through them would have passed through anyway — go.
 *
 * A pointer reports every frame it can, so a stroke drawn slowly across the
 * board arrives with thousands of samples. Each of those is written into the
 * Yjs document, sent to every peer and stored in `Diagram.data`, and none of
 * them is visible: this is what keeps a scribble the size of a shape.
 *
 * The ends are always kept, so a thinned stroke starts and finishes exactly
 * where it was drawn.
 */
export function simplify(points: InkPoint[], tolerance: number): InkPoint[] {
  if (points.length <= 2) return [...points];

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  // Iterative rather than recursive: a stroke can be thousands of points long,
  // and the worst case for this split is one point per level.
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    if (to - from < 2) continue;
    const a = { x: points[from][0], y: points[from][1] };
    const b = { x: points[to][0], y: points[to][1] };

    let worst = -1;
    let worstDistance = tolerance;
    for (let i = from + 1; i < to; i++) {
      const distance = distanceToSegment({ x: points[i][0], y: points[i][1] }, a, b);
      if (distance > worstDistance) {
        worst = i;
        worstDistance = distance;
      }
    }
    if (worst < 0) continue;
    keep[worst] = true;
    stack.push([from, worst], [worst, to]);
  }

  return points.filter((_, i) => keep[i]);
}
