/**
 * Mind maps — the structural half, pure and free of React Flow.
 *
 * **A mind map is ordinary shapes and connectors wearing a role.** There is no
 * new node type: a shape is a mind-map node when its `data.mindMap` says which
 * map it belongs to (`root`, the id of that map's root — the root points at
 * itself), and a connector is a branch of the map when its `data.role` is
 * `'mindmap'`, running **source = parent → target = child**. Both fields are
 * optional and absent on every diagram written before this existed, so nothing
 * needed migrating — see the note in `diagramMigrations.ts`.
 *
 * **The parent/child order is the order of the `edges` array.** A `Y.Map` has
 * no order and neither does a `Set`, but the edge array does: it is serialized,
 * it survives the document, and it is what `parentEdgeIndex` splices into when
 * a sibling is added above or below. That is why there is no `order` number on
 * a node to renumber, and why two people adding children at once merge into a
 * list rather than fighting over one key.
 *
 * **Collapsing is `collapsed` in the data, never `hidden` on the node.**
 * `hidden` is React Flow's own flag and is not serialized (`serializeNodes`
 * writes it nowhere); it is *derived* from `collapsed` by `hiddenMindMapIds`
 * every time the map is laid out and every time a diagram is loaded, so the
 * stored JSON stays a plain description of the map rather than a cache of what
 * is on screen.
 */

/** Vertical space between two siblings' boxes. */
export const MIND_MAP_SIBLING_GAP = 40;
/** Horizontal space between a parent's right edge and its children's left. */
export const MIND_MAP_LEVEL_GAP = 80;
/** How big a freshly added mind-map node is, and the size a layout assumes. */
export const MIND_MAP_NODE_SIZE = { width: 160, height: 44 };

/** What a node's `data.mindMap` holds. Absent on an ordinary shape. */
export interface MindMapNodeData {
  /** The id of this map's root. The root's own entry points at itself. */
  root: string;
  /** Whether this node's descendants are folded away. */
  collapsed?: boolean;
}

/** The little a node has to be for the structure here to reason about it. */
export interface MindMapNodeLike {
  id: string;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  data: { mindMap?: MindMapNodeData };
}

/** The little a connector has to be. `role` is what makes it a branch. */
export interface MindMapEdgeLike {
  id: string;
  source: string;
  target: string;
  data?: { role?: string } | null;
}

export interface MindMapSize {
  width: number;
  height: number;
}

/** Every parent/child pair on the board, whichever map each belongs to. */
export interface MindMapGraph {
  /** child id -> parent id. A child reached twice keeps its first parent. */
  parent: ReadonlyMap<string, string>;
  /** parent id -> child ids, in `edges` order. */
  children: ReadonlyMap<string, readonly string[]>;
}

/** One map, as reached from its root. */
export interface MindMapTree {
  rootId: string;
  /** Every node of the map, root first, in pre-order. */
  ids: readonly string[];
  children: ReadonlyMap<string, readonly string[]>;
  parent: ReadonlyMap<string, string>;
  /** The nodes whose descendants are folded away. */
  collapsed: ReadonlySet<string>;
}

export function isMindMapNode(node: MindMapNodeLike): boolean {
  return !!node.data.mindMap;
}

/** Which map a node belongs to, or `null` for an ordinary shape. */
export function mindMapRootOf(node: MindMapNodeLike): string | null {
  return node.data.mindMap?.root ?? null;
}

/** True when this connector is a branch of a mind map rather than a drawn line. */
export function isMindMapEdge(edge: MindMapEdgeLike): boolean {
  return edge.data?.role === 'mindmap';
}

/**
 * The whole board's mind-map structure. Built once and shared, because every
 * question here — what to hide, what a drag takes with it, what a map looks
 * like — is a walk over the same two maps.
 *
 * Only edges whose two ends are both mind-map nodes count, and a child reached
 * twice keeps the first parent it was given: `Diagram.data` is free-form JSON
 * written by other browsers, so a second parent, a cycle or a dangling end must
 * make the structure smaller, never make it throw.
 */
export function graphOf(
  nodes: readonly MindMapNodeLike[],
  edges: readonly MindMapEdgeLike[],
): MindMapGraph {
  const mindMapIds = new Set(nodes.filter(isMindMapNode).map((n) => n.id));
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    if (!isMindMapEdge(edge)) continue;
    if (!mindMapIds.has(edge.source) || !mindMapIds.has(edge.target)) continue;
    if (edge.source === edge.target || parent.has(edge.target)) continue;
    parent.set(edge.target, edge.source);
    const siblings = children.get(edge.source);
    if (siblings) siblings.push(edge.target);
    else children.set(edge.source, [edge.target]);
  }
  return { parent, children };
}

/**
 * The map rooted at `rootId`, or `null` when there is no mind-map node there.
 *
 * The walk carries its own `seen` set, so a cycle in the stored JSON costs a
 * branch rather than the stack.
 */
export function mapOf(
  nodes: readonly MindMapNodeLike[],
  edges: readonly MindMapEdgeLike[],
  rootId: string,
): MindMapTree | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = byId.get(rootId);
  if (!root || !isMindMapNode(root)) return null;

  const graph = graphOf(nodes, edges);
  const ids: string[] = [];
  const children = new Map<string, readonly string[]>();
  const parent = new Map<string, string>();
  const collapsed = new Set<string>();
  const seen = new Set<string>();

  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
    if (byId.get(id)?.data.mindMap?.collapsed) collapsed.add(id);
    const kids = (graph.children.get(id) ?? []).filter((kid) => !seen.has(kid));
    if (kids.length > 0) children.set(id, kids);
    for (const kid of kids) {
      parent.set(kid, id);
      walk(kid);
    }
  };
  walk(rootId);

  return { rootId, ids, children, parent, collapsed };
}

/** A node's children, in order — the empty list for a leaf. */
export function childrenOf(tree: MindMapTree, id: string): readonly string[] {
  return tree.children.get(id) ?? [];
}

/** Everything under `id`, in pre-order, collapsed or not. */
export function descendantIds(tree: MindMapTree, id: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const kid of childrenOf(tree, current)) {
      out.push(kid);
      walk(kid);
    }
  };
  walk(id);
  return out;
}

/** The ids a collapsed node folds away — every descendant of every collapsed node. */
export function nodesToHide(tree: MindMapTree): Set<string> {
  const hidden = new Set<string>();
  for (const id of tree.collapsed) {
    for (const descendant of descendantIds(tree, id)) hidden.add(descendant);
  }
  return hidden;
}

/**
 * Every node on the board that a collapsed ancestor folds away.
 *
 * Walked from each node up rather than from each root down, so it answers the
 * same way for a node whose stored `mindMap.root` has drifted — the branches
 * are the structure, and the root id is only ever a way of *finding* a map.
 */
export function hiddenMindMapIds(
  nodes: readonly MindMapNodeLike[],
  edges: readonly MindMapEdgeLike[],
): Set<string> {
  const { parent } = graphOf(nodes, edges);
  if (parent.size === 0) return new Set();
  const collapsed = new Set(
    nodes.filter((n) => n.data.mindMap?.collapsed).map((n) => n.id),
  );
  const hidden = new Set<string>();
  if (collapsed.size === 0) return hidden;

  for (const node of nodes) {
    const seen = new Set<string>([node.id]);
    let current = parent.get(node.id);
    while (current !== undefined && !seen.has(current)) {
      if (collapsed.has(current)) {
        hidden.add(node.id);
        break;
      }
      seen.add(current);
      current = parent.get(current);
    }
  }
  return hidden;
}

/**
 * Where every node of the map goes: a tidy tree growing to the right, with the
 * root's own top-left pinned to `origin` so laying the map out again never
 * moves the thing the user is looking at.
 *
 * Siblings are stacked in order with `MIND_MAP_SIBLING_GAP` between them, a
 * parent is centred against its first and last child, and each level starts
 * `MIND_MAP_LEVEL_GAP` past its parent's right edge — so a wide node pushes
 * only its own branch across. **A collapsed subtree takes no room at all**: it
 * is not walked, and its nodes are simply absent from the result, which leaves
 * their stored positions untouched until they are unfolded again.
 *
 * (Hand-rolled rather than ELK's `mrtree`, which `src/lib/autoLayout.ts`
 * reaches through a dynamic import: the whole gesture here is type-Tab-type,
 * and a layout that lands a frame later — after a 1.4 MB chunk has been
 * fetched — is a layout the typist has already typed past.)
 */
export function layoutMindMap(
  tree: MindMapTree,
  sizes: ReadonlyMap<string, MindMapSize>,
  origin: { x: number; y: number } = { x: 0, y: 0 },
): Map<string, { x: number; y: number }> {
  const sizeOf = (id: string): MindMapSize => sizes.get(id) ?? MIND_MAP_NODE_SIZE;
  const centreY = new Map<string, number>();
  const left = new Map<string, number>();

  /** Places `id` and its visible subtree below `top`, and reports its height. */
  const place = (id: string, top: number, x: number): number => {
    const { width, height } = sizeOf(id);
    left.set(id, x);
    const kids = tree.collapsed.has(id) ? [] : childrenOf(tree, id);
    if (kids.length === 0) {
      centreY.set(id, top + height / 2);
      return height;
    }
    let y = top;
    for (const kid of kids) {
      y += place(kid, y, x + width + MIND_MAP_LEVEL_GAP) + MIND_MAP_SIBLING_GAP;
    }
    const blockHeight = y - MIND_MAP_SIBLING_GAP - top;
    let centre = (centreY.get(kids[0])! + centreY.get(kids[kids.length - 1])!) / 2;

    // A node taller than everything hanging off it would otherwise stick up out
    // of the row it was given and overlap the sibling above. Its whole branch
    // is pushed down instead, so the node's own top edge rests on `top` and the
    // children stay centred on it.
    const overshoot = top + height / 2 - centre;
    if (overshoot > 0) {
      for (const descendant of descendantIds(tree, id)) {
        const at = centreY.get(descendant);
        if (at !== undefined) centreY.set(descendant, at + overshoot);
      }
      centre += overshoot;
    }
    centreY.set(id, centre);
    return Math.max(blockHeight, centre + height / 2 - top);
  };

  place(tree.rootId, 0, 0);

  // Everything is measured from the root's own corner, so the root lands
  // exactly on `origin` however the branches below it grew.
  const rootTop = centreY.get(tree.rootId)! - sizeOf(tree.rootId).height / 2;
  const positions = new Map<string, { x: number; y: number }>();
  for (const [id, x] of left) {
    positions.set(id, {
      x: origin.x + x,
      y: origin.y + centreY.get(id)! - sizeOf(id).height / 2 - rootTop,
    });
  }
  return positions;
}

/**
 * How many branches leave this node. Counted straight off the edges rather than
 * through `graphOf`, because every mind-map node on the board asks this on every
 * store update — it is what decides whether the fold button is drawn at all.
 */
export function childCount(edges: readonly MindMapEdgeLike[], id: string): number {
  let count = 0;
  for (const edge of edges) if (isMindMapEdge(edge) && edge.source === id) count += 1;
  return count;
}

/** How many nodes a folded branch is hiding — the number on the fold button. */
export function foldedCount(
  nodes: readonly MindMapNodeLike[],
  edges: readonly MindMapEdgeLike[],
  id: string,
): number {
  const graph = graphOf(nodes, edges);
  const seen = new Set<string>([id]);
  const queue = [...(graph.children.get(id) ?? [])];
  let count = 0;
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    count += 1;
    queue.push(...(graph.children.get(next) ?? []));
  }
  return count;
}

/**
 * Where in the `edges` array the branch that ends at `childId` sits, or `-1`.
 * Adding a sibling is splicing next to it, since child order *is* edge order.
 */
export function parentEdgeIndex(edges: readonly MindMapEdgeLike[], childId: string): number {
  return edges.findIndex((edge) => isMindMapEdge(edge) && edge.target === childId);
}

/**
 * A React Flow node change, as much of one as this module needs. `id` is
 * optional because React Flow's own union has a member without one (an `add`
 * carries the whole item instead), and this has to be a supertype of all of them.
 */
export interface PositionChangeLike {
  type: string;
  id?: string;
  position?: { x: number; y: number } | null;
}

/**
 * The extra position changes that make a dragged mind-map node carry its
 * subtree — one per descendant, moved by the same delta, and none at all for a
 * board with no mind map on it.
 *
 * Returned to be appended to the drag's own changes rather than applied here,
 * so everything downstream (the alignment snap, the history boundary, the
 * collaboration binding's transient hold) sees one gesture moving several
 * nodes, exactly as a multi-selection drag already does.
 */
export function subtreePositionChanges<C extends PositionChangeLike>(
  changes: readonly C[],
  nodes: readonly MindMapNodeLike[],
  edges: readonly MindMapEdgeLike[],
): C[] {
  const moving = changes.filter((c) => c.type === 'position' && c.position && c.id);
  if (moving.length === 0) return [];
  if (!nodes.some(isMindMapNode)) return [];

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const graph = graphOf(nodes, edges);
  const already = new Set(changes.map((c) => c.id));
  const extra: C[] = [];

  for (const change of moving) {
    const node = byId.get(change.id!);
    if (!node || !isMindMapNode(node)) continue;
    const dx = change.position!.x - node.position.x;
    const dy = change.position!.y - node.position.y;
    if (dx === 0 && dy === 0) continue;

    const seen = new Set<string>([change.id!]);
    const queue = [...(graph.children.get(change.id!) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...(graph.children.get(id) ?? []));
      if (already.has(id)) continue;
      const descendant = byId.get(id);
      if (!descendant) continue;
      already.add(id);
      extra.push({
        ...change,
        id,
        position: { x: descendant.position.x + dx, y: descendant.position.y + dy },
      });
    }
  }
  return extra;
}
