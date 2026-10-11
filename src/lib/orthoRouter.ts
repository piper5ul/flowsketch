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
 * - **The route always arrives.** The shapes near the route are tried first,
 *   then every shape on the board; only a connector walled in on every side
 *   is drawn as if they were not there.
 *
 * The search is Dijkstra over a sparse grid — the classic orthogonal-connector
 * construction: the candidate lines are the padded edges of every box that
 * matters, the stubs' own coordinates and the midlines, and the nodes are
 * their crossings outside every box. It is small (tens of lines each way) and
 * runs per render, like the router it replaced.
 *
 * User bends (`vertices`) are visited in order: the route is searched leg by
 * leg, each leg setting off in the direction the last one arrived in.
 *
 * **Big boards.** Everything that reads the whole board goes through an
 * `ObstacleIndex` — every shape's grown box plus a coarse grid of which boxes
 * touch which cell — so asking "which shapes are near this connector?" or
 * "does this route clear every shape?" costs the shapes in the cells it
 * covers, not every shape on the board. A caller routing many connectors over
 * one board builds the index once (`obstacleIndex`) and passes it with each
 * connector's `ignore` list. Inside a search, which grid points lie inside a
 * box and which grid runs cross one are worked out once per search
 * (`rasterize`) instead of once per step. None of it changes an answer: each
 * shortcut only narrows the boxes a predicate is asked about to a set that
 * provably contains every box it could say yes to, and the predicates are the
 * same functions as before (`orthoRouter.test.ts` checks the router against
 * the implementation this replaced, kept in `orthoRouterReference.ts`).
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
  /**
   * Rects in `obstacles` to leave out, by identity — so a caller routing many
   * connectors over one board can pass the same array (and index) to all of
   * them and name each connector's own two shapes here, instead of copying
   * the board without them per connector.
   */
  ignore?: readonly RouteRect[];
  /**
   * `obstacleIndex(obstacles)`, built once by a caller that routes many
   * connectors over the same board. Must have been built from this very
   * `obstacles` array, unchanged since; without it the router builds its own.
   */
  index?: ObstacleIndex;
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

/**
 * A minimal binary heap of (cost, state), kept in two parallel arrays. The
 * sift rules are exactly those of the tuple heap it replaced — equal costs
 * leave the heap in the same order — so the search pops states in the same
 * order and breaks ties the same way.
 */
class Heap {
  private costs: number[] = [];
  private states: number[] = [];
  /** The cost of the entry the last `pop` returned. */
  topCost = 0;
  get size() { return this.costs.length; }
  push(cost: number, state: number) {
    const c = this.costs;
    const s = this.states;
    c.push(cost);
    s.push(state);
    let i = c.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= c[i]) break;
      const tc = c[p]; c[p] = c[i]; c[i] = tc;
      const ts = s[p]; s[p] = s[i]; s[i] = ts;
      i = p;
    }
  }
  /** Pops the cheapest entry and returns its state; its cost is left in `topCost`. */
  pop(): number {
    const c = this.costs;
    const s = this.states;
    const topCost = c[0];
    const top = s[0];
    const lastCost = c.pop()!;
    const last = s.pop()!;
    if (c.length > 0) {
      c[0] = lastCost;
      s[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < c.length && c[l] < c[m]) m = l;
        if (r < c.length && c[r] < c[m]) m = r;
        if (m === i) break;
        const tc = c[m]; c[m] = c[i]; c[i] = tc;
        const ts = s[m]; s[m] = s[i]; s[i] = ts;
        i = m;
      }
    }
    this.topCost = topCost;
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

/** The first index in ascending `values` that is `>= v` (`values.length` if none). */
function lowerBound(values: readonly number[], v: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The last index in ascending `values` that is `<= v` (-1 if none). */
function upperIndex(values: readonly number[], v: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * Which grid points are inside a blocking box (`node`), and which runs between
 * neighbouring grid points cross one — `right[j * W + i]` for the run from
 * column `i` to `i + 1` on row `j`, `down[j * W + i]` for row `j` to `j + 1` in
 * column `i`. The search used to ask every box at every step; this asks each
 * box only about the grid points within a pixel of it (binary-searched), and
 * asks with the very same `inside` / `crosses`. A point or run further out
 * than that cannot be inside the box or cross it — both need the box's open
 * interior, `EPS` in from its edges — so the answers are the same answers.
 */
function rasterize(xs: readonly number[], ys: readonly number[], blocking: readonly Box[]) {
  const W = xs.length;
  const H = ys.length;
  const node = new Uint8Array(W * H);
  const right = new Uint8Array(W * H);
  const down = new Uint8Array(W * H);
  const a: RoutePoint = { x: 0, y: 0 };
  const b: RoutePoint = { x: 0, y: 0 };
  for (const box of blocking) {
    const i0 = lowerBound(xs, box.l - 1);
    const i1 = upperIndex(xs, box.r + 1);
    const j0 = lowerBound(ys, box.t - 1);
    const j1 = upperIndex(ys, box.b + 1);
    if (i0 > i1 || j0 > j1) continue;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        a.x = xs[i]; a.y = ys[j];
        if (inside(a, box)) node[j * W + i] = 1;
      }
    }
    // A run from column i to i + 1 can only meet the box if it ends past the
    // box's left edge and starts before its right one: i from i0 - 1 to i1.
    for (let j = j0; j <= j1; j++) {
      for (let i = Math.max(0, i0 - 1); i <= Math.min(W - 2, i1); i++) {
        const k = j * W + i;
        if (right[k]) continue;
        a.x = xs[i]; a.y = ys[j];
        b.x = xs[i + 1]; b.y = ys[j];
        if (crosses(a, b, box)) right[k] = 1;
      }
    }
    for (let j = Math.max(0, j0 - 1); j <= Math.min(H - 2, j1); j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * W + i;
        if (down[k]) continue;
        a.x = xs[i]; a.y = ys[j];
        b.x = xs[i]; b.y = ys[j + 1];
        if (crosses(a, b, box)) down[k] = 1;
      }
    }
  }
  return { node, right, down };
}

/**
 * The most search states (grid points × 4 headings) a search keeps in dense
 * typed arrays. Up to it, per-state cost and parent live in arrays reused from
 * search to search (a state's entries are live only while its `seen` stamp is
 * the current search's, so nothing is cleared between searches), and blocked
 * points and runs are rasterized up front — at most 16 MB for the pool and
 * 3 MB for the raster. Past it — only a whole-board fallback over thousands of
 * scattered shapes gets there; a 600-shape grid board's whole-board grid is
 * about 12,000 states — the search runs sparse, exactly as the reference
 * router did: `Map`s for the states it reaches and every box asked at every
 * step, so memory follows what the search visits rather than the grid's area.
 * Both paths give identical answers.
 */
const DENSE_STATES = 1 << 20;
const pool = { cost: new Float64Array(0), parent: new Int32Array(0), seen: new Uint32Array(0), generation: 0 };

function searchArrays(states: number) {
  if (pool.cost.length < states) {
    const size = Math.min(DENSE_STATES, Math.max(states, pool.cost.length * 2, 4096));
    pool.cost = new Float64Array(size);
    pool.parent = new Int32Array(size);
    pool.seen = new Uint32Array(size);
    pool.generation = 0;
  }
  pool.generation++;
  if (pool.generation === 0xffffffff) {
    pool.seen.fill(0);
    pool.generation = 1;
  }
  return pool;
}

/**
 * Where `rasterize` files the run leaving grid point (i, j) heading `nd`: a
 * run is filed under its left or upper end, so heading left or up it is the
 * run starting one column or one row back.
 */
const RUN_IS_DOWN = [false, true, false, true] as const; // right, down, left, up
const RUN_DI = [0, 0, -1, 0] as const;
const RUN_DJ = [0, 0, 0, -1] as const;

/**
 * The cheapest route through one leg for each direction it can arrive in —
 * the whole route so far included — or an empty map when every way is
 * blocked. With `arrive` set, arriving any other way costs a corner, and
 * arriving the opposite way is not allowed.
 */
function searchLeg(leg: Leg): Map<Dir, Arrival> {
  const { from, to, blocking } = leg;
  const xsIn = [from.x, to.x, ...leg.midX];
  const ysIn = [from.y, to.y, ...leg.midY];
  for (const b of blocking) {
    xsIn.push(b.l, b.r);
    ysIn.push(b.t, b.b);
  }
  const xs = uniqueSorted(xsIn);
  const ys = uniqueSorted(ysIn);
  const W = xs.length;
  const H = ys.length;
  const midX = new Uint8Array(W);
  const midY = new Uint8Array(H);
  for (const v of leg.midX) {
    const i = xs.findIndex((x) => Math.abs(x - v) <= EPS);
    if (i >= 0) midX[i] = 1;
  }
  for (const v of leg.midY) {
    const j = ys.findIndex((y) => Math.abs(y - v) <= EPS);
    if (j >= 0) midY[j] = 1;
  }
  const at = (i: number, j: number) => ({ x: xs[i], y: ys[j] });
  const index = (p: RoutePoint) => [xs.findIndex((x) => Math.abs(x - p.x) <= EPS), ys.findIndex((y) => Math.abs(y - p.y) <= EPS)];
  const stateOf = (i: number, j: number, d: Dir) => ((j * W + i) << 2) | d;

  // Blocked points and runs, and per-state cost and parent: dense within the
  // budget, sparse past it (see `DENSE_STATES`). The dense path is
  // written out inline in the loop below — it is the one every frame of a
  // drag runs — and the sparse one goes through these closures.
  const dense = W * H * 4 <= DENSE_STATES;
  const blocked = dense ? rasterize(xs, ys, blocking) : null;
  const arrays = dense ? searchArrays(W * H * 4) : null;
  const sparseCost = new Map<number, number>();
  const sparseParent = new Map<number, number>();
  const generation = arrays?.generation ?? 0;
  /** A state's best cost so far (`Infinity` until it is reached). */
  const costOf = (state: number) =>
    arrays ? (arrays.seen[state] === generation ? arrays.cost[state] : Infinity) : (sparseCost.get(state) ?? Infinity);
  /** Records a cheaper way to `state`; `fromState` is null for a start, which has no parent. */
  const reach = (state: number, c: number, fromState: number | null) => {
    if (arrays) {
      arrays.seen[state] = generation;
      arrays.cost[state] = c;
      // Dense states are small non-negative numbers, so -1 is free to mean "none".
      arrays.parent[state] = fromState ?? -1;
    } else {
      sparseCost.set(state, c);
      if (fromState !== null) sparseParent.set(state, fromState);
    }
  };
  const parentOf = (state: number): number | null => {
    if (arrays) return arrays.parent[state] === -1 ? null : arrays.parent[state];
    return sparseParent.get(state) ?? null;
  };
  const sparseBlocked = (i: number, j: number) => blocking.some((b) => inside(at(i, j), b));
  const sparseRunBlocked = (i: number, j: number, ni: number, nj: number) => {
    const a = at(i, j);
    const b = at(ni, nj);
    return blocking.some((box) => crosses(a, b, box));
  };

  const [si, sj] = index(from);
  const [ti, tj] = index(to);
  const heap = new Heap();
  for (const [d, arrival] of leg.starts) {
    const start = stateOf(si, sj, d);
    reach(start, arrival.cost, null);
    heap.push(arrival.cost, start);
  }

  const best = new Map<Dir, { cost: number; state: number }>();
  while (heap.size > 0) {
    const state = heap.pop();
    const c = heap.topCost;
    if (c > (arrays ? (arrays.seen[state] === generation ? arrays.cost[state] : Infinity) : costOf(state))) continue;
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
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      if (blocked) {
        if (blocked.node[nj * W + ni] === 1) continue;
        const runs = RUN_IS_DOWN[nd] ? blocked.down : blocked.right;
        if (runs[(j + RUN_DJ[nd]) * W + i + RUN_DI[nd]] === 1) continue;
      } else if (sparseBlocked(ni, nj) || sparseRunBlocked(i, j, ni, nj)) {
        continue;
      }
      const length = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]);
      const onMid = nd % 2 === 0 ? midY[j] === 1 : midX[i] === 1;
      const step = length * (onMid ? MIDLINE_DISCOUNT : 1) + (nd !== d ? BEND_PENALTY : 0);
      const next = stateOf(ni, nj, nd);
      const nc = c + step;
      if (arrays) {
        if (nc < (arrays.seen[next] === generation ? arrays.cost[next] : Infinity)) {
          arrays.seen[next] = generation;
          arrays.cost[next] = nc;
          arrays.parent[next] = state;
          heap.push(nc, next);
        }
      } else if (nc < costOf(next)) {
        reach(next, nc, state);
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
      const p = parentOf(s);
      if (p === null) break;
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

/** The side of one cell of an `ObstacleIndex`'s grid, in board px. */
const CELL = 256;
/** A box spanning more cells than this is checked on every query instead. */
const MAX_CELLS_PER_BOX = 1024;

/**
 * Every obstacle on a board, grown by `ROUTE_MARGIN`, with a coarse grid of
 * which boxes touch which cell. Build it once per board with
 * `obstacleIndex(rects)` and hand it to every connector routed over that board.
 * Opaque outside this module.
 */
export interface ObstacleIndex {
  readonly rects: readonly RouteRect[];
  /** `boxOf(rects[k], ROUTE_MARGIN)`, in the same order. */
  readonly boxes: readonly Box[];
  /** Cell key → the indices of the boxes touching that cell, ascending. */
  readonly cells: ReadonlyMap<number, number[]>;
  /** Boxes too big (or not finite enough) to file under cells: always candidates. */
  readonly everywhere: readonly number[];
  /** How many times each rect appears, for `ignore` (built on first use). */
  counts: Map<RouteRect, number> | null;
  /** Scratch for de-duplicating a query's candidates. */
  readonly stamp: Uint32Array;
  generation: number;
}

const cellOf = (v: number) => Math.floor(v / CELL);
// Cell coordinates fit comfortably in 2^21 either way of zero for any board a
// browser can draw; the key packs the two into one exact integer.
const cellKey = (cx: number, cy: number) => (cx + 0x100000) * 0x200000 + (cy + 0x100000);
const CELL_LIMIT = 0xfffff;

/** Whether `[l, r] × [t, b]` can be walked cell by cell. */
function walkable(l: number, t: number, r: number, b: number, maxCells: number): boolean {
  if (!(Number.isFinite(l) && Number.isFinite(t) && Number.isFinite(r) && Number.isFinite(b))) return false;
  // Inside out (a negative size): it covers no cell, yet a region spanning
  // it still counts it as near — so it is a candidate everywhere.
  if (r < l || b < t) return false;
  const cl = cellOf(l), ct = cellOf(t), cr = cellOf(r), cb = cellOf(b);
  if (Math.abs(cl) > CELL_LIMIT || Math.abs(ct) > CELL_LIMIT || Math.abs(cr) > CELL_LIMIT || Math.abs(cb) > CELL_LIMIT) return false;
  return (cr - cl + 1) * (cb - ct + 1) <= maxCells;
}

/** The index for a board's obstacles (see `ObstacleIndex`). */
export function obstacleIndex(rects: readonly RouteRect[]): ObstacleIndex {
  const boxes = rects.map((r) => boxOf(r, ROUTE_MARGIN));
  const cells = new Map<number, number[]>();
  const everywhere: number[] = [];
  boxes.forEach((box, k) => {
    if (!walkable(box.l, box.t, box.r, box.b, MAX_CELLS_PER_BOX)) {
      everywhere.push(k);
      return;
    }
    for (let cx = cellOf(box.l); cx <= cellOf(box.r); cx++) {
      for (let cy = cellOf(box.t); cy <= cellOf(box.b); cy++) {
        const key = cellKey(cx, cy);
        const list = cells.get(key);
        if (list) list.push(k);
        else cells.set(key, [k]);
      }
    }
  });
  return { rects, boxes, cells, everywhere, counts: null, stamp: new Uint32Array(boxes.length), generation: 0 };
}

/**
 * The indices of every box that touches `[l, r] × [t, b]` (closed), plus any
 * that might — ascending, each once. A superset: callers still apply their
 * own exact test to each.
 */
function candidates(index: ObstacleIndex, l: number, t: number, r: number, b: number): number[] {
  const n = index.boxes.length;
  if (!walkable(l, t, r, b, Math.max(16, n))) return Array.from({ length: n }, (_, k) => k);
  const generation = ++index.generation;
  if (generation === 0xffffffff) {
    index.stamp.fill(0);
    index.generation = 1;
  }
  const stamp = index.stamp;
  const g = index.generation;
  const out: number[] = [];
  for (let cx = cellOf(l); cx <= cellOf(r); cx++) {
    for (let cy = cellOf(t); cy <= cellOf(b); cy++) {
      const list = index.cells.get(cellKey(cx, cy));
      if (!list) continue;
      for (const k of list) {
        if (stamp[k] !== g) {
          stamp[k] = g;
          out.push(k);
        }
      }
    }
  }
  for (const k of index.everywhere) {
    if (stamp[k] !== g) {
      stamp[k] = g;
      out.push(k);
    }
  }
  return out.sort((x, y) => x - y);
}

const isIgnored = (rect: RouteRect, ignore: readonly RouteRect[]) => ignore.length > 0 && ignore.includes(rect);

/** How many of the board's obstacles are left once `ignore` is taken out. */
function obstacleCount(index: ObstacleIndex, ignore: readonly RouteRect[]): number {
  if (ignore.length === 0) return index.boxes.length;
  if (!index.counts) {
    const counts = new Map<RouteRect, number>();
    for (const r of index.rects) counts.set(r, (counts.get(r) ?? 0) + 1);
    index.counts = counts;
  }
  let n = index.boxes.length;
  for (const r of new Set(ignore)) n -= index.counts.get(r) ?? 0;
  return n;
}

/** Every obstacle box but the ignored, in board order. */
function allBoxes(index: ObstacleIndex, ignore: readonly RouteRect[]): Box[] {
  if (ignore.length === 0) return index.boxes as Box[];
  return index.boxes.filter((_, k) => !isIgnored(index.rects[k], ignore));
}

/**
 * The obstacle boxes (already grown by `ROUTE_MARGIN`) that reach into
 * `region`, in board order. Grown *first*: a shape just outside the region can
 * still have its clearance inside it, and a route along that edge would graze
 * it.
 */
function nearby(index: ObstacleIndex, ignore: readonly RouteRect[], region: Box): Box[] {
  const out: Box[] = [];
  for (const k of candidates(index, region.l, region.t, region.r, region.b)) {
    const b = index.boxes[k];
    if (b.l < region.r && b.r > region.l && b.t < region.b && b.b > region.t && !isIgnored(index.rects[k], ignore)) out.push(b);
  }
  return out;
}

/**
 * Whether the polyline `points` keeps out of every obstacle box but those
 * holding one of `stops` (which the route cannot avoid). A run can only cross
 * a box, or end inside one, that touches the run's own bounding box, so only
 * those are asked.
 */
function clearOfBoard(
  index: ObstacleIndex,
  ignore: readonly RouteRect[],
  stops: readonly RoutePoint[],
  points: readonly RoutePoint[],
): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const p = points[i];
    const near = candidates(index, Math.min(a.x, p.x), Math.min(a.y, p.y), Math.max(a.x, p.x), Math.max(a.y, p.y));
    for (const k of near) {
      const b = index.boxes[k];
      if (!(crosses(a, p, b) || inside(p, b))) continue;
      if (isIgnored(index.rects[k], ignore)) continue;
      if (stops.some((s) => inside(s, b))) continue;
      return false;
    }
  }
  return true;
}

/**
 * The corners of an orthogonal route from `source` to `target`, in order,
 * **not** including those two points — `buildConnectorPath` puts them on.
 */
export function orthoRoute(input: OrthoRouteInput): RoutePoint[] {
  return orthoRouteMemo(input, null).points;
}

/**
 * What one `orthoRouteMemo` call remembers so the next can skip the search.
 * Opaque outside this module: hand back whatever the last call returned.
 */
export interface RouteMemo {
  readonly ends: EndsKey;
  readonly near: readonly Box[];
  /** Every obstacle box, kept only when a fallback answered (`usedNear` false). */
  readonly all: readonly Box[] | null;
  /** The route searched among the near shapes alone (`null`: there was none). */
  readonly nearRoute: RoutePoint[] | null;
  /** Whether the answer was that near route rather than a fallback. */
  readonly usedNear: boolean;
  readonly points: RoutePoint[];
}

/** Everything about a route but the obstacles. */
interface EndsKey {
  source: RoutePoint;
  sourceSide: Direction;
  sourceRect: RouteRect;
  target: RoutePoint;
  targetSide: Direction;
  targetRect: RouteRect;
  vertices: readonly RoutePoint[];
}

const samePoint = (a: RoutePoint, b: RoutePoint) => a.x === b.x && a.y === b.y;
const sameRect = (a: RouteRect, b: RouteRect) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function sameEnds(a: EndsKey, b: EndsKey): boolean {
  return (
    a.sourceSide === b.sourceSide &&
    a.targetSide === b.targetSide &&
    samePoint(a.source, b.source) &&
    samePoint(a.target, b.target) &&
    sameRect(a.sourceRect, b.sourceRect) &&
    sameRect(a.targetRect, b.targetRect) &&
    a.vertices.length === b.vertices.length &&
    a.vertices.every((v, i) => samePoint(v, b.vertices[i]))
  );
}

function sameBoxes(a: readonly Box[], b: readonly Box[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.l !== y.l || x.t !== y.t || x.r !== y.r || x.b !== y.b) return false;
  }
  return true;
}

function samePoints(a: readonly RoutePoint[], b: readonly RoutePoint[]): boolean {
  return a.length === b.length && a.every((p, i) => samePoint(p, b[i]));
}

/**
 * `orthoRoute`, remembering enough of the last answer to skip the search when
 * nothing that decides it has changed — which, while one shape is dragged
 * across a big board, is every connector but the few near it.
 *
 * The answer is exactly `orthoRoute`'s, never an approximation of it, and
 * that is what the rule below is built from. With the ends and the shapes in
 * the first region (`nearby`) unchanged, the near search would find the same
 * route, so it is not run again; what *can* still change it is a shape
 * further away, through the two places the whole board is read — the check
 * that the near route clears every shape, and the fallbacks behind it. So:
 *
 * - near route kept last time, and it still clears the board → same answer;
 * - a fallback answered last time and not one box on the board moved → same;
 * - anything else → searched again (the near route reused when it can be).
 *
 * The returned `points` is the previous array itself whenever the route is
 * unchanged, so a caller can compare by reference.
 */
export function orthoRouteMemo(input: OrthoRouteInput, memo: RouteMemo | null): { points: RoutePoint[]; memo: RouteMemo } {
  const ends: EndsKey = {
    source: input.source,
    sourceSide: input.sourceSide,
    sourceRect: input.sourceRect,
    target: input.target,
    targetSide: input.targetSide,
    targetRect: input.targetRect,
    vertices: input.vertices ?? [],
  };
  const vertices = ends.vertices;
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
  // An index built from some other array would answer for the wrong board.
  const index = input.index?.rects === input.obstacles ? input.index : obstacleIndex(input.obstacles);
  const ignore = input.ignore ?? [];
  const allCount = obstacleCount(index, ignore);
  const nearObstacles = nearby(index, ignore, region);
  let allList: Box[] | null = null;
  const allObstacles = () => (allList ??= allBoxes(index, ignore));

  const stops = [s1, ...vertices, t1];
  // A shape that holds one of the route's own stops is exempt, as it is in
  // the search.
  const clearOfAll = (points: RoutePoint[] | null) =>
    points && clearOfBoard(index, ignore, stops, points) ? points : null;

  const sameNear = memo !== null && sameEnds(memo.ends, ends) && sameBoxes(memo.near, nearObstacles);
  if (sameNear) {
    if (memo.usedNear) {
      // The same near route; the question is only whether it is still kept.
      const kept = nearObstacles.length === allCount ? memo.nearRoute : clearOfAll(memo.nearRoute);
      if (kept) return { points: memo.points, memo };
    } else if (memo.all && sameBoxes(memo.all, allObstacles())) {
      return { points: memo.points, memo };
    }
  }

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

  const route = (obstacleBoxes: readonly Box[]): RoutePoint[] | null => {
    let heads = new Map<Dir, Arrival>([[OUTWARD[input.sourceSide], { cost: 0, points: [s1] }]]);
    for (let k = 1; k < stops.length; k++) {
      const from = stops[k - 1];
      const to = stops[k];
      const isLast = k === stops.length - 1;
      // A box that holds either end of this leg cannot be avoided, so it is
      // not in the way: that is what lets two overlapping shapes, or a bend
      // dragged inside one, still route.
      const candidates = [sourceBox, targetBox, ...obstacleBoxes];
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

  // Near shapes first (cheap, and almost always enough); then every shape on
  // the board, since a way round can lie outside the first region; and only
  // when the shapes leave no way through at all — a connector walled in — is
  // the route drawn as if they were not there, because a connector that is
  // not drawn is worse than one that crosses a shape.
  // A route found among the near shapes can still detour out past one that
  // was left out, so it is checked against all of them before it is kept.
  const near = sameNear ? memo.nearRoute : route(nearObstacles);
  const kept = nearObstacles.length === allCount ? near : clearOfAll(near);
  const points =
    kept ??
    (nearObstacles.length < allCount ? route(allObstacles()) : null) ??
    route([]) ??
    [s1, { x: s1.x, y: t1.y }, t1];
  let result = simplify([input.source, ...points, input.target]).slice(1, -1);
  if (memo && samePoints(memo.points, result)) result = memo.points;
  return {
    points: result,
    memo: { ends, near: nearObstacles, all: kept !== null ? null : allObstacles(), nearRoute: near, usedNear: kept !== null, points: result },
  };
}
