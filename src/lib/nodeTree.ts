/**
 * The parent/child half of the node array, as pure geometry.
 *
 * Groups and frames are ordinary nodes that other nodes hang off through React
 * Flow's `parentId`, and that arrangement carries three invariants the store
 * has to keep whatever the user does:
 *
 * 1. **A child's `position` is relative to its parent**, so anything that
 *    reasons about where a node actually *is* has to walk up the chain
 *    (`absolutePosition`).
 * 2. **A parent must come before its children in the array** — React Flow
 *    reads it in order — which every z-order action has to restore
 *    (`sortParentsFirst`).
 * 3. **A `parentId` must point at a node that is really there**, or React Flow
 *    throws rather than drawing the board (`normalizeParentage`).
 *
 * Like `arrange.ts`, this is structural and knows nothing about the store: it
 * takes plain nodes and returns plain answers, so the rules are testable
 * without a diagram around them.
 */

/** The shape of a node this module needs: an id, a parent, a box. */
export interface TreeNode {
  id: string;
  parentId?: string;
  position: { x: number; y: number };
}

/** A box in absolute (board) coordinates. */
export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where `node` really is on the board, its ancestors' offsets folded in.
 *
 * A chain that loops back on itself (which stored JSON can express and React
 * Flow cannot draw) stops rather than spinning; `normalizeParentage` is what
 * removes such a chain, and this only has to survive meeting one.
 */
export function absolutePosition<T extends TreeNode>(
  node: T,
  byId: ReadonlyMap<string, T>,
): { x: number; y: number } {
  let { x, y } = node.position;
  const seen = new Set<string>([node.id]);
  let parentId = node.parentId;
  while (parentId !== undefined && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
}

/**
 * `roots` and everything hanging off them, however deep.
 *
 * This is what makes a container behave like one thing: deleting a group
 * deletes what is inside it, duplicating one duplicates what is inside it, and
 * a frame dragged into another frame takes its contents along.
 */
export function subtreeIds<T extends TreeNode>(nodes: readonly T[], roots: Iterable<string>): Set<string> {
  const ids = new Set(roots);
  // One pass per level of nesting; a diagram's tree is shallow, and stopping
  // when a pass adds nothing also terminates on a cycle.
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId !== undefined && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        grew = true;
      }
    }
  }
  return ids;
}

/**
 * The same nodes, with every parent ahead of its children.
 *
 * Each subtree comes out contiguous, in the order its members were given, so a
 * z-order action stays meaningful: "bring to front" still moves a container
 * past its neighbours, it just brings the contents with it rather than leaving
 * them behind in an array React Flow cannot read. With no `parentId` anywhere
 * this is the identity, which is why an ordinary diagram is unaffected.
 */
export function sortParentsFirst<T extends TreeNode>(nodes: readonly T[]): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];

  for (const node of nodes) {
    const parent = node.parentId !== undefined ? byId.get(node.parentId) : undefined;
    if (!parent || parent.id === node.id) {
      roots.push(node);
      continue;
    }
    const siblings = childrenOf.get(parent.id);
    if (siblings) siblings.push(node);
    else childrenOf.set(parent.id, [node]);
  }

  const out: T[] = [];
  const emitted = new Set<string>();
  const visit = (node: T) => {
    if (emitted.has(node.id)) return;
    emitted.add(node.id);
    out.push(node);
    for (const child of childrenOf.get(node.id) ?? []) visit(child);
  };
  for (const root of roots) visit(root);

  // Only a cycle can leave a node unvisited. Keeping it (parentless is fixed by
  // `normalizeParentage`) is better than dropping a shape off the board.
  for (const node of nodes) if (!emitted.has(node.id)) out.push(node);
  return out;
}

/**
 * Nodes React Flow can actually draw: no `parentId` pointing at a node that is
 * not there (or at itself), and parents ahead of children.
 *
 * `Diagram.data` is a free-form JSON column — a row can be older than parenting,
 * hand-edited, or half-written — and a dangling `parentId` is not a cosmetic
 * problem there: React Flow throws on it and the board never renders. A node
 * whose parent has gone keeps the position it was stored with, which is the
 * best guess available once the offset it was relative to no longer exists.
 */
export function normalizeParentage<T extends TreeNode>(nodes: readonly T[]): T[] {
  const ids = new Set(nodes.map((n) => n.id));
  const rooted = nodes.map((node) =>
    node.parentId !== undefined && (node.parentId === node.id || !ids.has(node.parentId))
      ? ({ ...node, parentId: undefined } as T)
      : node,
  );
  return sortParentsFirst(rooted);
}

/**
 * The innermost container whose box holds `bounds` — the one a shape dropped
 * there belongs to.
 *
 * Frames nest, so "which frame is this in" has more than one true answer and
 * the useful one is the deepest: dropping a card onto a column inside a board
 * means the column. Depth settles it first (an inner frame is always contained
 * by its outer one); equal depth falls back to the smaller box, and then to
 * whichever is drawn last, so two frames stacked exactly on top of each other
 * hand the shape to the one the user can see.
 */
export function innermostContaining<T extends TreeNode & Bounds>(
  bounds: Bounds,
  candidates: readonly T[],
  byId: ReadonlyMap<string, TreeNode>,
): T | undefined {
  let best: T | undefined;
  let bestDepth = -1;
  let bestArea = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (!contains(candidate, bounds)) continue;
    const depth = depthOf(candidate, byId);
    const area = candidate.w * candidate.h;
    if (depth > bestDepth || (depth === bestDepth && area <= bestArea)) {
      best = candidate;
      bestDepth = depth;
      bestArea = area;
    }
  }
  return best;
}

/** True when `outer` completely holds `inner`. */
function contains(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** How many ancestors a node has. 0 for a node sitting on the board itself. */
function depthOf(node: TreeNode, byId: ReadonlyMap<string, TreeNode>): number {
  let depth = 0;
  const seen = new Set<string>([node.id]);
  let parentId = node.parentId;
  while (parentId !== undefined && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    depth++;
    parentId = parent.parentId;
  }
  return depth;
}

/** The smallest box holding every one of `rects`, or `null` when there are none. */
export function boundsOf(rects: readonly Bounds[]): Bounds | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}
