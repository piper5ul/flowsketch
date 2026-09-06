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
 * locked shape sits the edit out, as it sits out every other one. The floating
 * toolbar and the store share this predicate so the button is offered exactly
 * when pressing it would do something.
 */
export function canSwapShapeKind(
  data: Pick<ShapeData, 'shape' | 'locked' | 'fill' | 'stroke'>,
): boolean {
  if (data.shape === 'image' || data.shape === 'text') return false;
  if (isAnchorNode(data)) return false;
  return !data.locked;
}
