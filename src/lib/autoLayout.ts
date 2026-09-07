/**
 * Auto-layout: rearranging a connected selection into a clean layered flow.
 *
 * Whimsical's "Lay out vertically / horizontally" takes the shapes you have
 * selected, works out how the connectors between them run, and redraws them as
 * a tidy top-to-bottom (or left-to-right) flow. The layered placement itself is
 * the Eclipse Layout Kernel's job — `src/lib/elk.ts` loads it — and everything
 * on this side of that call is here: which nodes take part, what graph they
 * make, where the answer is put back on the board, and how the connectors
 * between them are re-pinned.
 *
 * Like `arrange.ts` and `nodeTree.ts` this is pure and structural: plain nodes
 * and plain edges in, plain positions out, no store and no React Flow. That is
 * what lets the interesting half be tested without a canvas around it.
 */
import { boardRect, sideAnchor, type HitNode } from './connectorGesture';
import { isAnchorNode, isContainerNode } from './nodeKinds';
import { absolutePosition, boundsOf, type Bounds } from './nodeTree';
import type { EdgeAnchor, ShapeData } from '../types';

/** Which way the flow runs. ELK's own spelling, passed through as `elk.direction`. */
export type LayoutDirection = 'DOWN' | 'RIGHT';

/** What layout needs to know about a node: a box, a parent, and what kind of thing it is. */
export interface LayoutNode extends HitNode {
  type?: string;
  selected?: boolean;
  data: Pick<ShapeData, 'shape' | 'fill' | 'stroke'>;
}

/** What layout needs to know about a connector: which two nodes it joins. */
export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

/** The subset of ELK's graph JSON we build. Structurally an `ElkNode`. */
export interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: { id: string; width: number; height: number }[];
  edges: { id: string; sources: string[]; targets: string[] }[];
}

/** One node's placement as ELK reports it back, in the graph's own coordinates. */
export interface ElkPlacement {
  id: string;
  x: number;
  y: number;
}

/**
 * The gap left between two shapes ELK could not put in the same layer, and
 * between one layer and the next.
 *
 * 48 / 64 is a little more room along the flow than across it, which is what
 * makes a column read as a sequence rather than a grid.
 */
const SPACING_NODE_NODE = 48;
const SPACING_BETWEEN_LAYERS = 64;

/**
 * The layout options every graph is built with.
 *
 * - `layered` is Sugiyama, the algorithm a flowchart wants: nodes fall into
 *   layers along the flow and edges run between neighbouring layers.
 * - `NETWORK_SIMPLEX` places nodes within a layer by minimising total edge
 *   length. On a chain that centres every shape on the same line exactly (which
 *   is the result a user reads as "laid out"), where the default `BRANDES_KOEPF`
 *   averages four candidate placements and can leave a shape two thirds of a
 *   pixel off its neighbours. Both look the same on a branching graph; the
 *   straight chain is what settled it.
 * - `ORTHOGONAL` routing costs nothing here — we throw ELK's edge sections away
 *   and draw connectors with our own router — but it is what makes ELK reserve
 *   the space between layers that a right-angled connector needs.
 */
function layoutOptions(direction: LayoutDirection): Record<string, string> {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': direction,
    'elk.spacing.nodeNode': String(SPACING_NODE_NODE),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(SPACING_BETWEEN_LAYERS),
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.edgeRouting': 'ORTHOGONAL',
  };
}

/**
 * True for a node auto-layout is allowed to move.
 *
 * A floating arrow's two invisible 1×1 endpoints are not shapes anybody drew
 * and must not become boxes in a flow — but a group and a frame wear the same
 * transparent fill and stroke, which is what `isAnchorNode` reads, so the
 * containers are let back in explicitly. A container is laid out as **one box**:
 * its contents travel with it, which is exactly what its children's
 * parent-relative positions already mean.
 */
function isLayoutable(node: LayoutNode): boolean {
  return isContainerNode(node) || !isAnchorNode(node.data);
}

/** True when any of `node`'s ancestors is in `ids`. */
function hasAncestorIn(node: LayoutNode, byId: ReadonlyMap<string, LayoutNode>, ids: ReadonlySet<string>): boolean {
  const seen = new Set<string>([node.id]);
  let parentId = node.parentId;
  while (parentId !== undefined && !seen.has(parentId)) {
    if (ids.has(parentId)) return true;
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  return false;
}

/**
 * The selected nodes auto-layout will actually place, in node order.
 *
 * **A selected node whose ancestor is also selected sits the command out**, the
 * rule `arrange.ts` and `groupSelected` both apply: moving a container already
 * moves its contents, so laying out both would move the descendant twice and
 * the result would match neither. A node React Flow has not measured yet has no
 * box to lay out and is skipped too.
 */
export function layoutMembers<T extends LayoutNode>(nodes: readonly T[], selectedIds: Iterable<string>): T[] {
  const ids = new Set(selectedIds);
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  return nodes.filter(
    (n) => ids.has(n.id) && isLayoutable(n) && !hasAncestorIn(n, byId, ids) && boardRect(n, byId) !== null,
  );
}

/** The connectors that join two members — the only ones a layout has an opinion about. */
export function layoutEdgesAmong<E extends LayoutEdge>(edges: readonly E[], memberIds: ReadonlySet<string>): E[] {
  return edges.filter((e) => memberIds.has(e.source) && memberIds.has(e.target));
}

/**
 * True when "lay out" would do something: at least two outermost selected nodes
 * with at least one connector between them.
 *
 * Two shapes with nothing joining them are not a flow — ELK would stack them in
 * one layer and the command would read as a very opinionated align — so a
 * connector is what makes the selection a graph.
 */
export function canAutoLayout(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): boolean {
  const members = layoutMembers(nodes, nodes.filter((n) => n.selected).map((n) => n.id));
  if (members.length < 2) return false;
  return layoutEdgesAmong(edges, new Set(members.map((m) => m.id))).length > 0;
}

/**
 * The ELK graph for a selection, or `null` when there is nothing to lay out.
 *
 * Sizes are the nodes' boxes **in board coordinates** (`boardRect` folds in the
 * ancestors' offsets), which for a size is the same number a frame-relative
 * reading would give — but the same helper answers for position below, and one
 * source for both is what keeps a framed shape landing where it was shown.
 */
export function layoutGraphFor(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  selectedIds: Iterable<string>,
  direction: LayoutDirection,
): ElkGraph | null {
  const members = layoutMembers(nodes, selectedIds);
  if (members.length < 2) return null;

  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const memberIds = new Set(members.map((m) => m.id));
  const graphEdges = layoutEdgesAmong(edges, memberIds);
  if (graphEdges.length === 0) return null;

  return {
    id: 'root',
    layoutOptions: layoutOptions(direction),
    children: members.map((node) => {
      // Non-null: `layoutMembers` already dropped the unmeasured nodes.
      const rect = boardRect(node, byId)!;
      return { id: node.id, width: rect.width, height: rect.height };
    }),
    edges: graphEdges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
}

/** The box the members occupy on the board right now, or `null` when there are none. */
export function layoutOrigin(nodes: readonly LayoutNode[], selectedIds: Iterable<string>): Bounds | null {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const rects = layoutMembers(nodes, selectedIds).map((node) => {
    const rect = boardRect(node, byId)!;
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  });
  return boundsOf(rects);
}

/**
 * ELK's placements, turned into positions the store can hold.
 *
 * Two conversions happen here, and both matter:
 *
 * 1. **The drawing must not jump.** ELK lays a graph out in its own coordinates
 *    starting near the origin, so the whole result is translated until its
 *    top-left corner sits on `anchor` — the top-left of the selection's own
 *    bounding box before the command ran. The flow is rearranged where the user
 *    was already looking rather than somewhere off screen.
 * 2. **A child's position is relative to its parent** (`nodeTree.ts`), so a
 *    member inside a frame gets the board position minus its parent's — the
 *    same conversion `commitArrangedPositions` does for align and distribute.
 *    A member's parent is never itself a member (the outermost rule), so the
 *    parent's own position is the same before and after.
 *
 * Positions are rounded: a diagram's coordinates are whole pixels everywhere
 * else, and ELK's placement strategies can hand back thirds of one.
 */
export function applyLayout(
  nodes: readonly LayoutNode[],
  laidOut: readonly ElkPlacement[],
  anchor: { x: number; y: number },
): Record<string, { x: number; y: number }> {
  if (laidOut.length === 0) return {};

  const dx = anchor.x - Math.min(...laidOut.map((p) => p.x));
  const dy = anchor.y - Math.min(...laidOut.map((p) => p.y));
  const byId = new Map(nodes.map((n) => [n.id, n] as const));

  const positions: Record<string, { x: number; y: number }> = {};
  for (const placed of laidOut) {
    const node = byId.get(placed.id);
    if (!node) continue;
    const parent = node.parentId !== undefined ? byId.get(node.parentId) : undefined;
    const origin = parent ? absolutePosition(parent, byId) : { x: 0, y: 0 };
    positions[placed.id] = {
      x: Math.round(placed.x + dx - origin.x),
      y: Math.round(placed.y + dy - origin.y),
    };
  }
  return positions;
}

/**
 * Where a connector between two laid-out shapes should leave and arrive.
 *
 * A layered flow has a grain, and a connector that ignores it — leaving the
 * left edge of one box to arrive at the left edge of the one below — reads as a
 * mistake even when the shapes are perfectly placed. So the two ends are pinned
 * to the sides that face each other along the direction of the flow, at the
 * middle of each: bottom → top going down, right → left going across. This is
 * the one thing the app does that Whimsical does invisibly — our `EdgeAnchor`
 * model keeps whichever sides the user drew on until something says otherwise,
 * and a layout is that something.
 */
export function layoutAnchors(direction: LayoutDirection): { source: EdgeAnchor; target: EdgeAnchor } {
  return direction === 'DOWN'
    ? { source: sideAnchor('bottom'), target: sideAnchor('top') }
    : { source: sideAnchor('right'), target: sideAnchor('left') };
}
