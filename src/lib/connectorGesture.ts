/**
 * The pure half of drawing a connector by hand: pressing on one shape and
 * releasing on another (or on empty board).
 *
 * The rule, borrowed from Whimsical: a connector starts at the point on the
 * source's outline nearest to where the pointer went down, and ends at the
 * point on the target's outline nearest to where it came up — both pinned as
 * a side and a fraction along it (`EdgeAnchor`), so the line leaves the shape
 * where the user pointed and keeps leaving there when the shapes move.
 */
import { nearestAnchorOnRect, type Point, type Rect } from './edgeGeometry';
import { absolutePosition, type TreeNode } from './nodeTree';
import type { Direction, EdgeAnchor } from '../types';

/** What hit-testing needs to know about a node: where it is and how big. */
export interface HitNode extends TreeNode {
  width?: number | null;
  height?: number | null;
  measured?: { width?: number; height?: number };
  hidden?: boolean;
}

/** A node's box in board coordinates, or `null` while it has no size yet. */
export function boardRect(node: HitNode, byId: ReadonlyMap<string, HitNode>): Rect | null {
  const width = node.width ?? node.measured?.width;
  const height = node.height ?? node.measured?.height;
  if (!width || !height) return null;
  const { x, y } = absolutePosition(node, byId);
  return { x, y, width, height };
}

const lookups = new WeakMap<readonly HitNode[], ReadonlyMap<string, HitNode>>();

/**
 * `nodes` by id, built once per node array. The store replaces the array on
 * every change to any node, so a gesture that hit-tests on every pointer move
 * pays for the map once while the board holds still — and gets a fresh one the
 * moment anything on it changes.
 */
export function lookupOf<T extends HitNode>(nodes: readonly T[]): ReadonlyMap<string, T> {
  let byId = lookups.get(nodes);
  if (!byId) {
    byId = new Map(nodes.map((n) => [n.id, n] as const));
    lookups.set(nodes, byId);
  }
  return byId as ReadonlyMap<string, T>;
}

/**
 * The node under `point`, or `null`. Later nodes win: a parent precedes its
 * children in the array, so the innermost shape inside a frame is the one
 * picked, and a shape drawn over another is picked over it. `skip` says which
 * nodes are not targets — a floating arrow's anchors, and the shape a gesture
 * started on. A hidden node (a folded mind-map branch) is never one: it keeps
 * its box while nobody can see it.
 */
export function nodeAtPoint<T extends HitNode>(
  nodes: readonly T[],
  point: Point,
  skip: (node: T) => boolean = () => false,
): T | null {
  const byId = lookupOf(nodes);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.hidden || skip(node)) continue;
    const rect = boardRect(node, byId);
    if (!rect) continue;
    if (point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height) {
      return node;
    }
  }
  return null;
}

/** Where on `node`'s outline a connector pinned by `point` sits. */
export function anchorFor(node: HitNode, byId: ReadonlyMap<string, HitNode>, point: Point): EdgeAnchor | null {
  const rect = boardRect(node, byId);
  return rect ? nearestAnchorOnRect(point.x, point.y, rect) : null;
}

export const OPPOSITE_SIDE: Record<Direction, Direction> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/** The middle of a side, which is what a handle or a quick-add stands for. */
export function sideAnchor(side: Direction): EdgeAnchor {
  return { side, t: 0.5 };
}

/**
 * The side of a box at `to` that faces `from`: the one a connector arriving
 * from there would enter through. Horizontal wins a tie.
 */
export function facingSide(from: Point, to: Point): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'left' : 'right';
  return dy >= 0 ? 'top' : 'bottom';
}

/** How far the pointer has to travel before a press is a drag, not a click. */
export const DRAG_THRESHOLD_PX = 4;

/**
 * True when a press on a side dot is a click — quick-add — rather than the
 * start of a connector. `maxTravel` is the furthest the pointer got from the
 * press, in screen px, at any point before the release: a drag that wandered
 * off and came back to the dot was a drag. The comparison is React Flow's own,
 * which starts a connection only *past* `connectionDragThreshold` (a strict
 * `>`), so every press is exactly one of the two.
 */
export function isDotClick(maxTravel: number): boolean {
  return maxTravel <= DRAG_THRESHOLD_PX;
}

/**
 * The grid a connector's free end lands on. Whimsical snaps a dangling end to
 * its board's dots whether or not shapes snap, so a row of arrows drawn by
 * hand ends on one line; 10 px is the board's own grid (`GRID_SIZE` in
 * `Canvas`), fine enough that it reads as "tidy" rather than "jumpy".
 */
export const FREE_END_GRID_PX = 10;

/** `point` rounded to the nearest free-end grid dot. */
export function snapToFreeEndGrid(point: Point, grid = FREE_END_GRID_PX): Point {
  return { x: grid * Math.round(point.x / grid), y: grid * Math.round(point.y / grid) };
}

/**
 * The side a connector's free end is entered through, given where its
 * attached end leaves its shape. Whimsical's rule, observed live: the free end
 * is approached along the axis the line set off on — a line leaving a bottom
 * edge arrives vertically, downwards when the end is below and upwards when it
 * is above — so dragging the end around never flips the attached end's side
 * and the last run always points the way the line was heading.
 */
export function freeEndSide(attached: { point: Point; side: Direction }, free: Point): Direction {
  if (attached.side === 'top' || attached.side === 'bottom') {
    return free.y >= attached.point.y ? 'top' : 'bottom';
  }
  return free.x >= attached.point.x ? 'left' : 'right';
}

/**
 * The invisible 1×1 node a connector's free end hangs off — the floating-arrow
 * hack (`isAnchorNode`: a rectangle whose fill and stroke are both
 * transparent), centred on `at`.
 */
export function anchorNodeAt(id: string, at: Point) {
  return {
    id,
    type: 'shape' as const,
    position: { x: at.x - 0.5, y: at.y - 0.5 },
    width: 1,
    height: 1,
    data: { label: '', shape: 'rectangle' as const, fill: 'transparent', stroke: 'transparent' },
  };
}
