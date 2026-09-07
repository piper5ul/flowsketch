/**
 * The pure half of "Filter selection": narrowing a multi-selection to the
 * shapes that share a kind or a colour — Whimsical's way of grabbing every
 * sticky, or every yellow thing, out of a sweep-select without picking them
 * one by one. Connectors in the selection drop out when a filter is applied:
 * the filters are about shapes, and a connector kept beside them would be
 * moved or restyled by whatever comes next.
 */
import type { ShapeKind } from '../types';
import type { WireComponent } from './wireframe';
import { wireComponentOf } from './wireframe';

/**
 * What "by shape" can name: a shape kind, or one wireframe component.
 *
 * A wire node's `data.shape` is a rectangle nothing draws (see `nodeKinds.ts`),
 * so bucketing one by its data would file every button, browser and toggle
 * under "Rectangle" — which is worse than not offering them at all. The
 * component is what the user sees, so the component is what they filter by, and
 * the `wire:` prefix is what keeps `image` the shape kind apart from `image`
 * the wireframe placeholder.
 */
export type FilterKind = ShapeKind | `wire:${WireComponent}`;

/** The bucket key for one wireframe component. */
export function wireFilterKind(component: WireComponent): `wire:${WireComponent}` {
  return `wire:${component}`;
}

/**
 * Whether a bucket key names a wireframe component rather than a shape kind.
 * A type guard, so the other branch narrows to `ShapeKind` and the shape icon
 * and label tables can be indexed with it directly.
 */
export function isWireFilterKind(kind: FilterKind): kind is `wire:${WireComponent}` {
  return kind.startsWith('wire:');
}

/** The component a `wire:` bucket key names. */
export function wireComponentOfFilterKind(kind: `wire:${WireComponent}`): WireComponent {
  return kind.slice(5) as WireComponent;
}

export interface FilterableNode {
  id: string;
  type?: string;
  selected?: boolean;
  data: { shape: ShapeKind; fill: string; wire?: unknown };
}

export interface FilterOption<T extends string> {
  value: T;
  count: number;
}

/** Which bucket this node falls in — its component when it is a wireframe, its shape kind otherwise. */
function kindOfNode(node: FilterableNode): FilterKind {
  if (node.type === 'wire') {
    const component = wireComponentOf(node.data);
    // A wire node naming a component this build cannot draw has no bucket of
    // its own; it files under its data's shape, which is where it already was.
    if (component) return wireFilterKind(component);
  }
  return node.data.shape;
}

/** What the current selection could be narrowed by: each kind and each fill present, with how many. */
export function filterOptions<N extends FilterableNode>(nodes: readonly N[]): { shapes: FilterOption<FilterKind>[]; fills: FilterOption<string>[] } {
  const shapes = new Map<FilterKind, number>();
  const fills = new Map<string, number>();
  for (const n of nodes) {
    if (!n.selected) continue;
    const kind = kindOfNode(n);
    shapes.set(kind, (shapes.get(kind) ?? 0) + 1);
    if (n.data.fill !== 'transparent') fills.set(n.data.fill.toUpperCase(), (fills.get(n.data.fill.toUpperCase()) ?? 0) + 1);
  }
  const sorted = <T extends string>(m: Map<T, number>) =>
    [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return { shapes: sorted(shapes), fills: sorted(fills) };
}

/** The ids, out of the selected nodes, that match `filter`. Both criteria apply when both are given. */
export function narrowedIds<N extends FilterableNode>(nodes: readonly N[], filter: { shape?: FilterKind; fill?: string }): Set<string> {
  const fill = filter.fill?.toUpperCase();
  return new Set(
    nodes
      .filter((n) => n.selected)
      .filter((n) => (filter.shape === undefined || kindOfNode(n) === filter.shape) && (fill === undefined || n.data.fill.toUpperCase() === fill))
      .map((n) => n.id),
  );
}
