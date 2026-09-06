import type { ShapeData } from '../types';

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
 * True for the shapes whose kind the toolbar can swap.
 *
 * An image *is* its bytes and a text shape draws no outline at all while sizing
 * itself to what is typed — turning either into a diamond would throw away the
 * thing that makes it what it is. A locked shape sits the edit out, as it sits
 * out every other one. The floating toolbar and the store share this predicate
 * so the button is offered exactly when pressing it would do something.
 */
export function canSwapShapeKind(data: Pick<ShapeData, 'shape' | 'locked'>): boolean {
  return data.shape !== 'image' && data.shape !== 'text' && !data.locked;
}
