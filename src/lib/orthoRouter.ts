/**
 * The elbow connector's router: a deterministic orthogonal route between two
 * pinned ends, the way Whimsical draws one.
 *
 * The rules it keeps, each observed on Whimsical's board:
 *
 * - **An end leaves its shape straight out of the side it is pinned to**, and
 *   arrives straight into the side it is pinned to. The first and last runs
 *   are "stubs" at least `ROUTE_MARGIN` long — shortened to meet in the
 *   middle when two facing sides are closer than two stubs.
 * - **Fewest corners first, then shortest.** Every turn costs `BEND_PENALTY`
 *   px of length, so an L beats a Z and a Z beats a detour.
 * - **A Z splits in the middle of the gap**: the midline between the two
 *   shapes is a candidate line, and a run along it is a hair cheaper, so of
 *   two otherwise equal routes the centred one wins.
 * - **Other shapes are walked around**, `ROUTE_MARGIN` clear — but only those
 *   near the route (see `nearby`); a board of a hundred shapes does not make
 *   every connector search all of them.
 * - **The route always arrives.** If nothing can be found clear of the other
 *   shapes, they are dropped, and a route with no obstacles always exists.
 *
 * The search is Dijkstra over a sparse grid — the classic orthogonal-connector
 * construction: the candidate lines are the padded edges of every box that
 * matters, the stubs' own coordinates and the midlines, and the nodes are
 * their crossings outside every box. It is small (tens of lines each way) and
 * runs per render, like the router it replaced.
 *
 * User bends (`vertices`) are visited in order: the route is searched leg by
 * leg, each leg setting off in the direction the last one arrived in.
 */
import type { Direction } from '../types';

export interface RoutePoint { x: number; y: number }
export interface RouteRect { x: number; y: number; width: number; height: number }

/** How far a route keeps clear of a shape, and the length of an end's stub. */
export const ROUTE_MARGIN = 20;
/** What a corner costs, in px of length. */
export const BEND_PENALTY = 40;
/** The discount on a run along a midline, which is what centres a Z. */
const MIDLINE_DISCOUNT = 0.99;
const EPS = 0.5;

export interface OrthoRouteInput {
  /** Where the line starts (already stood off the shape) and the side it leaves by. */
  source: RoutePoint;
  sourceSide: Direction;
  sourceRect: RouteRect;
  /** Where the line ends and the side of the target it enters by. */
  target: RoutePoint;
  targetSide: Direction;
  targetRect: RouteRect;
  /** Every other shape on the board. */
  obstacles: readonly RouteRect[];
  /** User bends, visited in order. */
  vertices?: readonly RoutePoint[];
}

type Dir = 0 | 1 | 2 | 3; // right, down, left, up
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const OUTWARD: Record<Direction, Dir> = { right: 0, bottom: 1, left: 2, top: 3 };
const reverse = (d: Dir) => ((d + 2) % 4) as Dir;

interface Box { l: number; t: number; r: number; b: number }

function boxOf(rect: RouteRect, pad: number): Box {
  return { l: rect.x - pad, t: rect.y - pad, r: rect.x + rect.width + pad, b: rect.y + rect.height + pad };
}

function inside(p: RoutePoint, box: Box): boolean {
  return p.x > box.l + EPS && p.x < box.r - EPS && p.y > box.t + EPS && p.y < box.b - EPS;
}

/** Whether an axis-aligned segment passes through the open interior of `box`. */
function crosses(a: RoutePoint, b: RoutePoint, box: Box): boolean {
  if (Math.abs(a.y - b.y) < EPS) {
    if (a.y <= box.t + EPS || a.y >= box.b - EPS) return false;
    return Math.max(Math.min(a.x, b.x), box.l) < Math.min(Math.max(a.x, b.x), box.r) - EPS;
  }
  if (a.x <= box.l + EPS || a.x >= box.r - EPS) return false;
  return Math.max(Math.min(a.y, b.y), box.t) < Math.min(Math.max(a.y, b.y), box.b) - EPS;
}

/**
 * How long each end's stub is. Two sides facing each other across a gap
 * narrower than two stubs share it: each stub reaches the midline, so the
 * route is a Z split exactly in the middle rather than a loop.
 */
function stubLengths(input: OrthoRouteInput): [number, number] {
  const s = boxOf(input.sourceRect, 0);
  const t = boxOf(input.targetRect, 0);
  let gap: number | null = null;
  const pair = `${input.sourceSide}-${input.targetSide}`;
  if (pair === 'bottom-top') gap = t.t - s.b;
  else if (pair === 'top-bottom') gap = s.t - t.b;
  else if (pair === 'right-left') gap = t.l - s.r;
  else if (pair === 'left-right') gap = s.l - t.r;
  if (gap !== null && gap >= 0 && gap < 2 * ROUTE_MARGIN) return [gap / 2, gap / 2];
  return [ROUTE_MARGIN, ROUTE_MARGIN];
}

/** The end of a stub: `len` px straight out of `side` of `rect`, in line with `p`. */
function stubEnd(p: RoutePoint, side: Direction, rect: RouteRect, len: number): RoutePoint {
  switch (side) {
    case 'top': return { x: p.x, y: Math.min(p.y, rect.y - len) };
    case 'bottom': return { x: p.x, y: Math.max(p.y, rect.y + rect.height + len) };
    case 'left': return { x: Math.min(p.x, rect.x - len), y: p.y };
    case 'right': return { x: Math.max(p.x, rect.x + rect.width + len), y: p.y };
  }
}

/** How far `p` is out from `side` of `rect`, along that side's normal (negative: behind it). */
function clearance(p: RoutePoint, side: Direction, rect: RouteRect): number {
  switch (side) {
    case 'top': return rect.y - p.y;
    case 'bottom': return p.y - (rect.y + rect.height);
    case 'left': return rect.x - p.x;
    case 'right': return p.x - (rect.x + rect.width);
  }
}

/** A minimal binary heap of [cost, state]. */
class Heap {
  private items: [number, number][] = [];
  get size() { return this.items.length; }
  push(cost: number, state: number) {
    const a = this.items;
    a.push([cost, state]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function uniqueSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (out.length === 0 || Math.abs(v - out[out.length - 1]) > EPS) out.push(v);
  return out;
}

/** A partial route: what it cost to get here and the points it turned at. */
interface Arrival { cost: number; points: RoutePoint[] }

interface Leg {
  from: RoutePoint;
  /**
   * The ways the route can already be travelling when it leaves `from`, each
   * with the cost of the route so far. Several, at a user's bend: which way it
   * should arrive there depends on the leg after it, so every heading is kept
   * and the next leg chooses (one Dijkstra with many starts does exactly that).
   */
  starts: Map<Dir, Arrival>;
  to: RoutePoint;
  /** The direction the route must be travelling in when it reaches `to`, if any. */
  arrive: Dir | null;
  blocking: Box[];
  midX: number[];
  midY: number[];
}

/**
 * The cheapest route through one leg for each direction it can arrive in —
 * the whole route so far included — or an empty map when every way is
 * blocked. With `arrive` set, arriving any other way costs a corner, and
 * arriving the opposite way is not allowed.
 */
function searchLeg(leg: Leg): Map<Dir, Arrival> {
  const { from, to, blocking } = leg;
  const xs = uniqueSorted([from.x, to.x, ...leg.midX, ...blocking.flatMap((b) => [b.l, b.r])]);
  const ys = uniqueSorted([from.y, to.y, ...leg.midY, ...blocking.flatMap((b) => [b.t, b.b])]);
  const midX = new Set(leg.midX.map((v) => xs.findIndex((x) => Math.abs(x - v) <= EPS)));
  const midY = new Set(leg.midY.map((v) => ys.findIndex((y) => Math.abs(y - v) <= EPS)));
  const W = xs.length;
  const H = ys.length;
  const at = (i: number, j: number) => ({ x: xs[i], y: ys[j] });
  const open = (i: number, j: number) => !blocking.some((b) => inside(at(i, j), b));
  const index = (p: RoutePoint) => [xs.findIndex((x) => Math.abs(x - p.x) <= EPS), ys.findIndex((y) => Math.abs(y - p.y) <= EPS)];

  const [si, sj] = index(from);
  const [ti, tj] = index(to);
  const stateOf = (i: number, j: number, d: Dir) => ((j * W + i) << 2) | d;
  const cost = new Map<number, number>();
  const parent = new Map<number, number>();
  const heap = new Heap();
  for (const [d, arrival] of leg.starts) {
    const start = stateOf(si, sj, d);
    cost.set(start, arrival.cost);
    heap.push(arrival.cost, start);
  }

  const best = new Map<Dir, { cost: number; state: number }>();
  while (heap.size > 0) {
    const [c, state] = heap.pop();
    if (c > (cost.get(state) ?? Infinity)) continue;
    const d = (state & 3) as Dir;
    const cell = state >> 2;
    const i = cell % W;
    const j = Math.floor(cell / W);
    if (i === ti && j === tj) {
      if (leg.arrive !== null && d === reverse(leg.arrive)) continue;
      const total = c + (leg.arrive !== null && d !== leg.arrive ? BEND_PENALTY : 0);
      if (total < (best.get(d)?.cost ?? Infinity)) best.set(d, { cost: total, state });
      continue;
    }
    for (let nd = 0 as Dir; nd < 4; nd = (nd + 1) as Dir) {
      if (nd === reverse(d)) continue;
      const ni = i + DX[nd];
      const nj = j + DY[nd];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H || !open(ni, nj)) continue;
      const a = at(i, j);
      const b = at(ni, nj);
      if (blocking.some((box) => crosses(a, b, box))) continue;
      const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const onMid = nd % 2 === 0 ? midY.has(j) : midX.has(i);
      const step = length * (onMid ? MIDLINE_DISCOUNT : 1) + (nd !== d ? BEND_PENALTY : 0);
      const next = stateOf(ni, nj, nd);
      const nc = c + step;
      if (nc < (cost.get(next) ?? Infinity)) {
        cost.set(next, nc);
        parent.set(next, state);
        heap.push(nc, next);
      }
    }
  }

  const out = new Map<Dir, Arrival>();
  for (const [d, { cost: total, state: goal }] of best) {
    const cells: RoutePoint[] = [];
    let s: number = goal;
    for (;;) {
      const cell = s >> 2;
      cells.push(at(cell % W, Math.floor(cell / W)));
      const p = parent.get(s);
      if (p === undefined) break;
      s = p;
    }
    cells.reverse();
    // `s` is now the start state this route set out from: its heading says
    // which of the routes so far it continues.
    const before = leg.starts.get((s & 3) as Dir)!;
    out.set(d, { cost: total, points: [...before.points, ...cells.slice(1)] });
  }
  return out;
}

/** Drops repeated points and the middle one of any three in a line. */
function simplify(points: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) <= EPS && Math.abs(last.y - p.y) <= EPS) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = last!;
      const collinear = (Math.abs(a.x - b.x) <= EPS && Math.abs(b.x - p.x) <= EPS) ||
        (Math.abs(a.y - b.y) <= EPS && Math.abs(b.y - p.y) <= EPS);
      if (collinear) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** The obstacles worth considering: those overlapping the region the route can reasonably use. */
function nearby(obstacles: readonly RouteRect[], region: Box): RouteRect[] {
  return obstacles.filter((o) =>
    o.x < region.r && o.x + o.width > region.l && o.y < region.b && o.y + o.height > region.t,
  );
}

/**
 * The corners of an orthogonal route from `source` to `target`, in order,
 * **not** including those two points — `buildConnectorPath` puts them on.
 */
export function orthoRoute(input: OrthoRouteInput): RoutePoint[] {
  const vertices = input.vertices ?? [];
  let [lenS, lenT] = stubLengths(input);
  // A bend the user dragged to inside a stub's length would have the route
  // overshoot it and double back along itself; the stub stops level with it.
  if (vertices.length > 0) {
    lenS = Math.min(lenS, Math.max(0, clearance(vertices[0], input.sourceSide, input.sourceRect)));
    lenT = Math.min(lenT, Math.max(0, clearance(vertices[vertices.length - 1], input.targetSide, input.targetRect)));
  }
  const s1 = stubEnd(input.source, input.sourceSide, input.sourceRect, lenS);
  const t1 = stubEnd(input.target, input.targetSide, input.targetRect, lenT);

  const sourceBox = boxOf(input.sourceRect, lenS);
  const targetBox = boxOf(input.targetRect, lenT);
  const all = [s1, t1, ...vertices];
  const region: Box = {
    l: Math.min(sourceBox.l, targetBox.l, ...all.map((p) => p.x)) - ROUTE_MARGIN * 4,
    t: Math.min(sourceBox.t, targetBox.t, ...all.map((p) => p.y)) - ROUTE_MARGIN * 4,
    r: Math.max(sourceBox.r, targetBox.r, ...all.map((p) => p.x)) + ROUTE_MARGIN * 4,
    b: Math.max(sourceBox.b, targetBox.b, ...all.map((p) => p.y)) + ROUTE_MARGIN * 4,
  };
  const obstacleBoxes = nearby(input.obstacles, region).map((o) => boxOf(o, ROUTE_MARGIN));

  // The midlines: halfway across the gap between the two shapes, and halfway
  // between the two stubs, on each axis. A Z lands on one of these.
  const midX: number[] = [(s1.x + t1.x) / 2];
  const midY: number[] = [(s1.y + t1.y) / 2];
  const s0 = boxOf(input.sourceRect, 0);
  const t0 = boxOf(input.targetRect, 0);
  if (s0.r <= t0.l) midX.push((s0.r + t0.l) / 2);
  if (t0.r <= s0.l) midX.push((t0.r + s0.l) / 2);
  if (s0.b <= t0.t) midY.push((s0.b + t0.t) / 2);
  if (t0.b <= s0.t) midY.push((t0.b + s0.t) / 2);

  const stops = [s1, ...vertices, t1];
  const route = (withObstacles: boolean): RoutePoint[] | null => {
    let heads = new Map<Dir, Arrival>([[OUTWARD[input.sourceSide], { cost: 0, points: [s1] }]]);
    for (let k = 1; k < stops.length; k++) {
      const from = stops[k - 1];
      const to = stops[k];
      const isLast = k === stops.length - 1;
      // A box that holds either end of this leg cannot be avoided, so it is
      // not in the way: that is what lets two overlapping shapes, or a bend
      // dragged inside one, still route.
      const candidates = [sourceBox, targetBox, ...(withObstacles ? obstacleBoxes : [])];
      const blocking = candidates.filter((b) => !inside(from, b) && !inside(to, b));
      heads = searchLeg({
        from,
        starts: heads,
        to,
        arrive: isLast ? reverse(OUTWARD[input.targetSide]) : null,
        blocking,
        midX,
        midY,
      });
      if (heads.size === 0) return null;
    }
    let cheapest: Arrival | null = null;
    for (const arrival of heads.values()) if (!cheapest || arrival.cost < cheapest.cost) cheapest = arrival;
    return cheapest?.points ?? null;
  };

  const points = route(true) ?? route(false) ?? [s1, { x: s1.x, y: t1.y }, t1];
  return simplify([input.source, ...points, input.target]).slice(1, -1);
}
