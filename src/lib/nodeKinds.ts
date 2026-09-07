import type { DiagramNodeType, ShapeData, ShapeKind } from '../types';

/** Just enough of a node to ask what kind of node it is. */
type Typed = { type?: DiagramNodeType | string };

/**
 * True for the invisible box that makes a handful of shapes move as one.
 *
 * A container is told from a drawn shape by its `type` and never by its data:
 * a group's fill and stroke are both `transparent`, which is exactly what
 * `isAnchorNode` looks for, so asking the data would confuse the two.
 */
export function isGroupNode(node: Typed): boolean {
  return node.type === 'group';
}

/** True for a titled section shapes join by being dropped into it. */
export function isFrameNode(node: Typed): boolean {
  return node.type === 'frame';
}

/** True for either container — the nodes other nodes can hang off. */
export function isContainerNode(node: Typed): boolean {
  return isGroupNode(node) || isFrameNode(node);
}

/**
 * True for one freehand pen stroke.
 *
 * Read from the `type` for the reason the containers are: an ink node carries
 * an ordinary `ShapeData` (its `stroke` is the pen's colour, which is what lets
 * the palette work on it unchanged), and its `shape` field is a rectangle
 * nothing draws. The stroke itself is `data.ink` — see `src/lib/ink.ts`.
 */
export function isInkNode(node: Typed): boolean {
  return node.type === 'ink';
}

/**
 * True for a grid of editable cells.
 *
 * Read from the `type` for the same reason the containers are: a table's data
 * is an ordinary `ShapeData` carrying `shape: 'rectangle'` and a fill, so
 * asking the data would answer "rectangle". The grid itself lives in
 * `data.table` — but a node with that field and the wrong `type` is not a
 * table, and this is the predicate that says so.
 *
 * A table is **not** a container: nothing hangs off it through `parentId`, so
 * `isContainerNode` deliberately stays the two it was.
 */
export function isTableNode(node: Typed): boolean {
  return node.type === 'table';
}

/**
 * True for one wireframe component — a button, a browser chrome, a toggle.
 *
 * Read from the `type` for the reason every other node kind is: a wire node
 * carries an ordinary `ShapeData` whose `shape` is a rectangle nothing draws
 * and whose `fill`/`stroke` are the wireframe palette, so asking the data would
 * answer "rectangle". *Which* component it is lives in `data.wire.component`
 * — but a node with that field and the wrong `type` is not a wireframe
 * component, and this is the predicate that says so.
 *
 * Like a table, a wire node is **not** a container: `browser`, `phone` and
 * `card` look like frames and nothing hangs off them through `parentId` in this
 * build, so `isContainerNode` stays the two it has always been.
 */
export function isWireNode(node: Typed): boolean {
  return node.type === 'wire';
}

/**
 * Every shape kind, at runtime. Built from an exhaustive record rather than
 * written out as an array, so adding a kind to `ShapeKind` and forgetting it
 * here is a type error rather than a table that silently misses a shape.
 */
const ALL_SHAPE_KINDS: Record<ShapeKind, true> = {
  rectangle: true,
  ellipse: true,
  diamond: true,
  sticky: true,
  text: true,
  pill: true,
  triangle: true,
  hexagon: true,
  cylinder: true,
  image: true,
  parallelogram: true,
  document: true,
  cloud: true,
  star: true,
  callout: true,
  arrow: true,
};

export const SHAPE_KINDS = Object.keys(ALL_SHAPE_KINDS) as ShapeKind[];

/**
 * True for the invisible 1×1 rectangles a floating arrow hangs off.
 *
 * A floating arrow — a connector drawn on empty canvas, belonging to no shape —
 * is modelled as an edge between two anchor nodes with a transparent fill and
 * stroke. Several places need to tell those apart from real content: the node
 * renderer skips their chrome, the connector tool refuses them as endpoints,
 * and the edge renderer draws them without endpoint handles.
 *
 * Transparency alone is not enough. Text shapes are transparent by design, and
 * so are image nodes, so the shape kind has to be part of the test — hence one
 * predicate rather than the expression repeated at each call site.
 */
export function isAnchorNode(data: Pick<ShapeData, 'shape' | 'fill' | 'stroke'>): boolean {
  if (data.shape === 'text' || data.shape === 'image') return false;
  return data.fill === 'transparent' && data.stroke === 'transparent';
}

/**
 * True for the shapes with corners to round.
 *
 * A radius is a property of a CSS box: an ellipse and a pill are already as
 * round as they go, a silhouette's corners belong to its path, and a text shape
 * draws no outline to round at all. That leaves the two rectangles — plain and
 * sticky — which is exactly where the control is offered.
 */
export function canRoundCorners(shape: ShapeKind): boolean {
  return shape === 'rectangle' || shape === 'sticky';
}

/**
 * True for the shapes whose kind the toolbar can swap.
 *
 * An image *is* its bytes and a text shape draws no outline at all while sizing
 * itself to what is typed — turning either into a diamond would throw away the
 * thing that makes it what it is. An anchor node is not a shape the user drew
 * at all but one end of a floating arrow, and giving a 1×1 invisible endpoint a
 * silhouette would put a speck of a star on the canvas that nothing selected. A
 * locked shape sits the edit out, as it sits out every other one. A table is a
 * grid of cells and a freehand stroke a line drawn by hand: neither has a
 * silhouette to exchange, and both are told by their `type` — which is why
 * this takes the whole node rather than only its data, their data being an
 * ordinary rectangle's. A wireframe component is a third of that kind: what it
 * draws is `data.wire.component`, so redrawing a toggle as a star would throw
 * away the whole of what it is. The floating toolbar and the store share this
 * predicate so the button is offered exactly when pressing it would do
 * something.
 */
export function canSwapShapeKind(
  node: Typed & { data: Pick<ShapeData, 'shape' | 'locked' | 'fill' | 'stroke'> },
): boolean {
  if (isContainerNode(node) || isTableNode(node) || isInkNode(node) || isWireNode(node)) return false;
  const { data } = node;
  if (data.shape === 'image' || data.shape === 'text') return false;
  if (isAnchorNode(data)) return false;
  return !data.locked;
}
