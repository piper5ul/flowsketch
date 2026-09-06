/**
 * Standalone Manhattan (orthogonal) edge router, extracted from JointJS.
 *
 * Original: packages/joint-core/src/routers/manhattan.mjs
 * Copyright © 2013 client IO — licensed under MPL 2.0.
 * https://github.com/clientIO/joint
 *
 * Modifications: stripped JointJS model/view dependencies; inlined minimal
 * geometry helpers; accepts plain {x,y,width,height} obstacle rects.
 */

// ---------------------------------------------------------------------------
// Lightweight geometry primitives (only the subset manhattan.mjs needs)
// ---------------------------------------------------------------------------

class Pt {
  x: number;
  y: number;
  constructor(x: number, y: number) { this.x = x; this.y = y; }
  clone() { return new Pt(this.x, this.y); }
  round(precision = 0) {
    const f = 10 ** precision;
    this.x = Math.round(this.x * f) / f;
    this.y = Math.round(this.y * f) / f;
    return this;
  }
  offset(dx: number, dy: number) { this.x += dx; this.y += dy; return this; }
  equals(p: Pt) { return this.x === p.x && this.y === p.y; }
  theta(p: Pt) {
    const y = -(p.y - this.y);
    const x = p.x - this.x;
    let rad = Math.atan2(y, x);
    if (rad < 0) rad = 2 * Math.PI + rad;
    return (180 * rad) / Math.PI;
  }
  difference(p: Pt) { return new Pt(this.x - p.x, this.y - p.y); }
  manhattanDistance(p: Pt) { return Math.abs(this.x - p.x) + Math.abs(this.y - p.y); }
  squaredDistance(p: Pt) { return (this.x - p.x) ** 2 + (this.y - p.y) ** 2; }
  snapToGrid(size: number) {
    this.x = size * Math.round(this.x / size);
    this.y = size * Math.round(this.y / size);
    return this;
  }
  toString() { return `${this.x}@${this.y}`; }
  move(ref: Pt, dist: number) {
    const dx = ref.x - this.x;
    const dy = ref.y - this.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    this.x += (dx / len) * dist;
    this.y += (dy / len) * dist;
    return this;
  }
}

class Rt {
  x: number; y: number; width: number; height: number;
  constructor(x: number, y: number, w: number, h: number) {
    this.x = x; this.y = y; this.width = w; this.height = h;
  }
  clone() { return new Rt(this.x, this.y, this.width, this.height); }
  center() { return new Pt(this.x + this.width / 2, this.y + this.height / 2); }
  origin() { return new Pt(this.x, this.y); }
  corner() { return new Pt(this.x + this.width, this.y + this.height); }
  containsPoint(p: Pt) {
    return p.x >= this.x && p.x <= this.x + this.width &&
           p.y >= this.y && p.y <= this.y + this.height;
  }
  moveAndExpand(r: { x: number; y: number; width: number; height: number }) {
    this.x += r.x; this.y += r.y; this.width += r.width; this.height += r.height;
    return this;
  }
  inflate(d: number) {
    this.x -= d; this.y -= d; this.width += 2 * d; this.height += 2 * d;
    return this;
  }
  union(other: Rt) {
    const ox = Math.min(this.x, other.x);
    const oy = Math.min(this.y, other.y);
    const cx = Math.max(this.x + this.width, other.x + other.width);
    const cy = Math.max(this.y + this.height, other.y + other.height);
    this.x = ox; this.y = oy; this.width = cx - ox; this.height = cy - oy;
    return this;
  }
  intersect(other: Rt) { return this.clone().inflate(0).containsPoint(other.origin()); }
  pointNearestToPoint(p: Pt) {
    return new Pt(
      Math.max(this.x, Math.min(p.x, this.x + this.width)),
      Math.max(this.y, Math.min(p.y, this.y + this.height)),
    );
  }
}

/** Line segment intersection with a rectangle — returns intersection points. */
function lineIntersectRect(a: Pt, b: Pt, rect: Rt): Pt[] {
  const sides: [Pt, Pt][] = [
    [new Pt(rect.x, rect.y), new Pt(rect.x + rect.width, rect.y)],
    [new Pt(rect.x + rect.width, rect.y), new Pt(rect.x + rect.width, rect.y + rect.height)],
    [new Pt(rect.x + rect.width, rect.y + rect.height), new Pt(rect.x, rect.y + rect.height)],
    [new Pt(rect.x, rect.y + rect.height), new Pt(rect.x, rect.y)],
  ];
  const result: Pt[] = [];
  for (const [c, d] of sides) {
    const pt = segSeg(a, b, c, d);
    if (pt) result.push(pt);
  }
  return result;
}

function segSeg(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const dABx = b.x - a.x, dABy = b.y - a.y;
  const dCDx = d.x - c.x, dCDy = d.y - c.y;
  const denom = dABx * dCDy - dABy * dCDx;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((c.x - a.x) * dCDy - (c.y - a.y) * dCDx) / denom;
  const u = ((c.x - a.x) * dABy - (c.y - a.y) * dABx) / denom;
  if (t < -1e-10 || t > 1 + 1e-10 || u < -1e-10 || u > 1 + 1e-10) return null;
  return new Pt(a.x + t * dABx, a.y + t * dABy);
}

function normalizeAngle(angle: number) {
  return ((angle % 360) + 360) % 360;
}

function snapToGridVal(val: number, gridSize: number) {
  return gridSize * Math.round(val / gridSize);
}

// ---------------------------------------------------------------------------
// Sorted set (open list for A*)
// ---------------------------------------------------------------------------

const OPEN = 1;
const CLOSE = 2;

class SortedSet {
  items: string[] = [];
  hash: Record<string, number> = {};
  values: Record<string, number> = {};

  add(item: string, value: number) {
    if (this.hash[item]) {
      this.items.splice(this.items.indexOf(item), 1);
    } else {
      this.hash[item] = OPEN;
    }
    this.values[item] = value;
    let lo = 0, hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.values[this.items[mid]] < value) lo = mid + 1; else hi = mid;
    }
    this.items.splice(lo, 0, item);
  }
  remove(item: string) { this.hash[item] = CLOSE; }
  isOpen(item: string) { return this.hash[item] === OPEN; }
  isClose(item: string) { return this.hash[item] === CLOSE; }
  isEmpty() { return this.items.length === 0; }
  pop() { const item = this.items.shift()!; this.remove(item); return item; }
}

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

interface ManhattanOptions {
  step: number;
  maximumLoops: number;
  precision: number;
  maxAllowedDirectionChange: number;
  startDirections: string[];
  endDirections: string[];
  directionMap: Record<string, { x: number; y: number }>;
  directions: { offsetX: number; offsetY: number; cost: number; angle?: number; gridOffsetX?: number; gridOffsetY?: number }[];
  penalties: Record<number, number>;
  paddingBox: { x: number; y: number; width: number; height: number };
  previousDirectionAngle?: number | null;
}

function defaultOptions(step: number): ManhattanOptions {
  return {
    step,
    maximumLoops: 2000,
    precision: 1,
    maxAllowedDirectionChange: 90,
    startDirections: ['top', 'right', 'bottom', 'left'],
    endDirections: ['top', 'right', 'bottom', 'left'],
    directionMap: {
      top: { x: 0, y: -1 },
      right: { x: 1, y: 0 },
      bottom: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
    },
    directions: [
      { offsetX: step, offsetY: 0, cost: step },
      { offsetX: -step, offsetY: 0, cost: step },
      { offsetX: 0, offsetY: step, cost: step },
      { offsetX: 0, offsetY: -step, cost: step },
    ],
    penalties: { 0: 0, 45: step / 2, 90: step / 2 },
    paddingBox: { x: -step, y: -step, width: 2 * step, height: 2 * step },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDirectionAngle(start: Pt, end: Pt, numDirections: number, grid: { x: number; y: number; source: Pt }, opt: ManhattanOptions) {
  const quadrant = 360 / numDirections;
  const step = opt.step;
  const diffX = end.x - start.x;
  const diffY = end.y - start.y;
  const fixedEnd = new Pt(start.x + (diffX / grid.x) * step, start.y + (diffY / grid.y) * step);
  const angleTheta = start.theta(fixedEnd);
  const normalized = normalizeAngle(angleTheta + quadrant / 2);
  return quadrant * Math.floor(normalized / quadrant);
}

function getDirectionChange(angle1: number | null, angle2: number) {
  if (angle1 === null) return 0;
  const change = Math.abs(angle1 - angle2);
  return change > 180 ? 360 - change : change;
}

function getGrid(step: number, source: Pt, target: Pt) {
  const getD = (diff: number) => {
    if (!diff) return step;
    const abs = Math.abs(diff);
    const n = Math.round(abs / step);
    if (!n) return abs;
    return step + (abs - n * step) / n;
  };
  return { source: source.clone(), x: getD(target.x - source.x), y: getD(target.y - source.y) };
}

function snapPtToGrid(point: Pt, grid: { x: number; y: number; source: Pt }) {
  return new Pt(
    snapToGridVal(point.x - grid.source.x, grid.x) + grid.source.x,
    snapToGridVal(point.y - grid.source.y, grid.y) + grid.source.y,
  );
}

function align(point: Pt, grid: { x: number; y: number; source: Pt }, precision: number) {
  return snapPtToGrid(point, grid).round(precision);
}

function getKey(p: Pt) { return p.toString(); }

function normalizePt(p: Pt) {
  return new Pt(p.x === 0 ? 0 : p.x / Math.abs(p.x), p.y === 0 ? 0 : p.y / Math.abs(p.y));
}

// ---------------------------------------------------------------------------
// A* core
// ---------------------------------------------------------------------------

function estimateCost(from: Pt, endPoints: Pt[]) {
  let min = Infinity;
  for (const ep of endPoints) { const c = from.manhattanDistance(ep); if (c < min) min = c; }
  return min;
}

function reconstructRoute(parents: Record<string, Pt | undefined>, points: Record<string, Pt>, tailPoint: Pt, from: Pt, to: Pt) {
  const route: Pt[] = [];
  let prevDiff = normalizePt(to.difference(tailPoint));
  let currentKey = getKey(tailPoint);
  let parent = parents[currentKey];
  while (parent) {
    const point = points[currentKey];
    const diff = normalizePt(point.difference(parent));
    if (!diff.equals(prevDiff)) { route.unshift(point); prevDiff = diff; }
    currentKey = getKey(parent);
    parent = parents[currentKey];
  }
  const leadPoint = points[currentKey];
  if (leadPoint) {
    const fromDiff = normalizePt(leadPoint.difference(from));
    if (!fromDiff.equals(prevDiff)) route.unshift(leadPoint);
  }
  return route;
}

function getRectPoints(anchor: Pt, bbox: Rt, directionList: string[], grid: { x: number; y: number; source: Pt }, opt: ManhattanOptions) {
  const { precision, directionMap } = opt;
  const anchorCenterVector = anchor.difference(bbox.center());
  const rectPoints: Pt[] = [];

  for (const key of Object.keys(directionMap)) {
    if (!directionList.includes(key)) continue;
    const dir = directionMap[key];
    const endpoint = new Pt(
      anchor.x + dir.x * (Math.abs(anchorCenterVector.x) + bbox.width),
      anchor.y + dir.y * (Math.abs(anchorCenterVector.y) + bbox.height),
    );
    const intersections = lineIntersectRect(anchor, endpoint, bbox);
    let farthest: Pt | null = null;
    let farthestDist = -1;
    for (const ix of intersections) {
      const d = anchor.squaredDistance(ix);
      if (d > farthestDist) { farthestDist = d; farthest = ix; }
    }
    if (farthest) {
      let pt = align(farthest, grid, precision);
      if (bbox.containsPoint(pt)) {
        pt = align(pt.offset(dir.x * grid.x, dir.y * grid.y), grid, precision);
      }
      rectPoints.push(pt);
    }
  }
  if (!bbox.containsPoint(anchor)) rectPoints.push(align(anchor.clone(), grid, precision));
  return rectPoints;
}

function findRoute(
  sourceAnchor: Pt,
  targetAnchor: Pt,
  sourceBBox: Rt,
  targetBBox: Rt,
  isPointObstacle: (p: Pt) => boolean,
  opt: ManhattanOptions,
): Pt[] | null {
  const { precision, directions } = opt;
  const sa = sourceAnchor.clone().round(precision);
  const ta = targetAnchor.clone().round(precision);
  const grid = getGrid(opt.step, sa, ta);

  // compute grid offsets for directions
  for (const d of directions) {
    d.gridOffsetX = (d.offsetX / opt.step) * grid.x;
    d.gridOffsetY = (d.offsetY / opt.step) * grid.y;
    const p2 = new Pt(d.offsetX, d.offsetY);
    d.angle = normalizeAngle(new Pt(0, 0).theta(p2));
  }

  // A zero-size bbox is a user waypoint, not an element: route to the point
  // itself (as JointJS does for vertices) instead of looking for border
  // intersections that a degenerate rect can never produce.
  const isPoint = (r: Rt) => r.width === 0 && r.height === 0;
  const startPoints = (isPoint(sourceBBox) ? [sa] : getRectPoints(sa, sourceBBox, opt.startDirections, grid, opt))
    .filter(p => !isPointObstacle(p));
  const endPoints = (isPoint(targetBBox) ? [ta] : getRectPoints(ta, targetBBox, opt.endDirections, grid, opt))
    .filter(p => !isPointObstacle(p));

  if (startPoints.length === 0 || endPoints.length === 0) return null;

  const openSet = new SortedSet();
  const points: Record<string, Pt> = {};
  const parents: Record<string, Pt | undefined> = {};
  const costs: Record<string, number> = {};

  for (const sp of startPoints) {
    const key = getKey(sp);
    openSet.add(key, estimateCost(sp, endPoints));
    points[key] = sp;
    costs[key] = 0;
  }

  const previousRouteDirectionAngle = opt.previousDirectionAngle ?? undefined;
  const isPathBeginning = previousRouteDirectionAngle === undefined;
  const numDirections = directions.length;
  const endPointsKeys = endPoints.map(ep => getKey(ep));

  let loopsRemaining = opt.maximumLoops;
  while (!openSet.isEmpty() && loopsRemaining > 0) {
    const currentKey = openSet.pop();
    const currentPoint = points[currentKey];
    const currentParent = parents[currentKey];
    const currentCost = costs[currentKey];

    const isRouteBeginning = currentParent === undefined;
    const isStart = currentPoint.equals(sa);

    let previousDirectionAngle: number | null;
    if (!isRouteBeginning) previousDirectionAngle = getDirectionAngle(currentParent!, currentPoint, numDirections, grid, opt);
    else if (!isPathBeginning) previousDirectionAngle = previousRouteDirectionAngle!;
    else if (!isStart) previousDirectionAngle = getDirectionAngle(sa, currentPoint, numDirections, grid, opt);
    else previousDirectionAngle = null;

    // check start/end overlap
    let samePoints = startPoints.length === endPoints.length;
    if (samePoints) { for (let j = 0; j < startPoints.length; j++) { if (!startPoints[j].equals(endPoints[j])) { samePoints = false; break; } } }
    const skipEndCheck = isRouteBeginning && samePoints;

    if (!skipEndCheck && endPointsKeys.indexOf(currentKey) >= 0) {
      opt.previousDirectionAngle = previousDirectionAngle;
      return reconstructRoute(parents, points, currentPoint, sa, ta);
    }

    for (let i = 0; i < numDirections; i++) {
      const direction = directions[i];
      const directionAngle = direction.angle!;
      const directionChange = getDirectionChange(previousDirectionAngle, directionAngle);
      if (!(isPathBeginning && isStart) && directionChange > opt.maxAllowedDirectionChange) continue;

      const neighborPoint = align(currentPoint.clone().offset(direction.gridOffsetX!, direction.gridOffsetY!), grid, precision);
      const neighborKey = getKey(neighborPoint);

      if (openSet.isClose(neighborKey) || isPointObstacle(neighborPoint)) continue;

      if (endPointsKeys.indexOf(neighborKey) >= 0) {
        const isNeighborEnd = neighborPoint.equals(ta);
        if (!isNeighborEnd) {
          const endDirAngle = getDirectionAngle(neighborPoint, ta, numDirections, grid, opt);
          if (getDirectionChange(directionAngle, endDirAngle) > opt.maxAllowedDirectionChange) continue;
        }
      }

      const neighborCost = direction.cost;
      const neighborPenalty = isStart ? 0 : (opt.penalties[directionChange] ?? 0);
      const costFromStart = currentCost + neighborCost + neighborPenalty;

      if (!openSet.isOpen(neighborKey) || costFromStart < costs[neighborKey]) {
        points[neighborKey] = neighborPoint;
        parents[neighborKey] = currentPoint;
        costs[neighborKey] = costFromStart;
        openSet.add(neighborKey, costFromStart + estimateCost(neighborPoint, endPoints));
      }
    }
    loopsRemaining--;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Orthogonal fallback (simplified from JointJS orthogonal.mjs)
// ---------------------------------------------------------------------------

function orthogonalFallback(source: Pt, target: Pt, sourceBBox: Rt, targetBBox: Rt): Pt[] {
  const from = source;
  const to = target;
  const p1 = new Pt(from.x, to.y);
  const p2 = new Pt(to.x, from.y);
  if (!sourceBBox.containsPoint(p1) && !targetBBox.containsPoint(p1)) return [p1];
  if (!sourceBBox.containsPoint(p2) && !targetBBox.containsPoint(p2)) return [p2];
  const mid = new Pt((from.x + to.x) / 2, (from.y + to.y) / 2);
  return [new Pt(from.x, mid.y), new Pt(to.x, mid.y)];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ObstacleRect {
  x: number; y: number; width: number; height: number;
}

export interface ManhattanRouterInput {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourceRect: ObstacleRect;
  targetRect: ObstacleRect;
  obstacles: ObstacleRect[];
  vertices?: { x: number; y: number }[];
  /** Grid step size (default 10) */
  step?: number;
  /** Padding around obstacles (default = step) */
  padding?: number;
  /** Which sides the connector can exit the source from */
  startDirections?: string[];
  /** Which sides the connector can enter the target from */
  endDirections?: string[];
}

export interface ManhattanRouterResult {
  points: { x: number; y: number }[];
}

/**
 * Route an orthogonal (Manhattan) connector from source to target,
 * avoiding the given obstacle rectangles.
 */
export function manhattanRoute(input: ManhattanRouterInput): ManhattanRouterResult {
  const step = input.step ?? 10;
  const padding = input.padding ?? step;
  const opt = defaultOptions(step);

  if (input.startDirections) opt.startDirections = input.startDirections;
  if (input.endDirections) opt.endDirections = input.endDirections;

  opt.paddingBox = { x: -padding, y: -padding, width: 2 * padding, height: 2 * padding };

  // Build obstacle checker from padded rects
  const MAP_GRID = 100;
  const obstacleMap: Record<string, Rt[]> = {};

  const allRects = input.obstacles.map(o => {
    const r = new Rt(o.x, o.y, o.width, o.height);
    return r.clone().moveAndExpand(opt.paddingBox);
  });

  for (const bbox of allRects) {
    const o = bbox.origin().snapToGrid(MAP_GRID);
    const c = bbox.corner().snapToGrid(MAP_GRID);
    for (let x = o.x; x <= c.x; x += MAP_GRID) {
      for (let y = o.y; y <= c.y; y += MAP_GRID) {
        const key = `${x}@${y}`;
        (obstacleMap[key] ??= []).push(bbox);
      }
    }
  }

  const isPointObstacle = (p: Pt): boolean => {
    const k = p.clone().snapToGrid(MAP_GRID).toString();
    const rects = obstacleMap[k];
    if (!rects) return false;
    return rects.some(r => r.containsPoint(p));
  };

  const sourceAnchor = new Pt(input.sourceX, input.sourceY);
  const targetAnchor = new Pt(input.targetX, input.targetY);
  const sourceBBox = new Rt(input.sourceRect.x, input.sourceRect.y, input.sourceRect.width, input.sourceRect.height)
    .clone().moveAndExpand(opt.paddingBox);
  const targetBBox = new Rt(input.targetRect.x, input.targetRect.y, input.targetRect.width, input.targetRect.height)
    .clone().moveAndExpand(opt.paddingBox);

  const vertices = input.vertices ?? [];

  // Route through vertices: source → v1 → v2 → ... → target
  const allWaypoints: Pt[] = [];
  let from = sourceBBox;
  let fromAnchor = sourceAnchor;

  for (let i = 0; i <= vertices.length; i++) {
    const isLast = i === vertices.length;
    const to = isLast ? targetBBox : new Rt(vertices[i].x, vertices[i].y, 0, 0);
    const toAnchor = isLast ? targetAnchor : new Pt(vertices[i].x, vertices[i].y);

    const partial = findRoute(fromAnchor, toAnchor, from, to, isPointObstacle, opt);

    if (partial === null) {
      const fallback = orthogonalFallback(fromAnchor, toAnchor, from, to);
      allWaypoints.push(...fallback);
    } else {
      const tailPoint = allWaypoints[allWaypoints.length - 1];
      if (partial.length > 0 && tailPoint && partial[0].equals(tailPoint)) partial.shift();
      allWaypoints.push(...partial);
    }

    from = to;
    fromAnchor = toAnchor;
  }

  // Post-process: align the first/last waypoints with source/target anchors
  // to prevent the tiny S-kinks caused by grid-snapping misalignment.
  const startDir = input.startDirections?.[0];
  const endDir = input.endDirections?.[0];
  if (allWaypoints.length > 0) {
    const first = allWaypoints[0];
    if (startDir === 'top' || startDir === 'bottom') {
      if (Math.abs(first.x - sourceAnchor.x) < 15) first.x = sourceAnchor.x;
    } else if (startDir === 'left' || startDir === 'right') {
      if (Math.abs(first.y - sourceAnchor.y) < 15) first.y = sourceAnchor.y;
    }
    const last = allWaypoints[allWaypoints.length - 1];
    if (endDir === 'top' || endDir === 'bottom') {
      if (Math.abs(last.x - targetAnchor.x) < 15) last.x = targetAnchor.x;
    } else if (endDir === 'left' || endDir === 'right') {
      if (Math.abs(last.y - targetAnchor.y) < 15) last.y = targetAnchor.y;
    }
  }

  return { points: allWaypoints.map(p => ({ x: p.x, y: p.y })) };
}
