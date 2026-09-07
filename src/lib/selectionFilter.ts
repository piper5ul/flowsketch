/**
 * The pure half of "Filter selection": narrowing a multi-selection to the
 * shapes that share a kind or a colour — Whimsical's way of grabbing every
 * sticky, or every yellow thing, out of a sweep-select without picking them
 * one by one. Connectors in the selection drop out when a filter is applied:
 * the filters are about shapes, and a connector kept beside them would be
 * moved or restyled by whatever comes next.
 */
import type { ShapeKind } from '../types';

export interface FilterableNode {
  id: string;
  selected?: boolean;
  data: { shape: ShapeKind; fill: string };
}

export interface FilterOption<T extends string> {
  value: T;
  count: number;
}

/** What the current selection could be narrowed by: each kind and each fill present, with how many. */
export function filterOptions<N extends FilterableNode>(nodes: readonly N[]): { shapes: FilterOption<ShapeKind>[]; fills: FilterOption<string>[] } {
  const shapes = new Map<ShapeKind, number>();
  const fills = new Map<string, number>();
  for (const n of nodes) {
    if (!n.selected) continue;
    shapes.set(n.data.shape, (shapes.get(n.data.shape) ?? 0) + 1);
    if (n.data.fill !== 'transparent') fills.set(n.data.fill.toUpperCase(), (fills.get(n.data.fill.toUpperCase()) ?? 0) + 1);
  }
  const sorted = <T extends string>(m: Map<T, number>) =>
    [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return { shapes: sorted(shapes), fills: sorted(fills) };
}

/** The ids, out of the selected nodes, that match `filter`. Both criteria apply when both are given. */
export function narrowedIds<N extends FilterableNode>(nodes: readonly N[], filter: { shape?: ShapeKind; fill?: string }): Set<string> {
  const fill = filter.fill?.toUpperCase();
  return new Set(
    nodes
      .filter((n) => n.selected)
      .filter((n) => (filter.shape === undefined || n.data.shape === filter.shape) && (fill === undefined || n.data.fill.toUpperCase() === fill))
      .map((n) => n.id),
  );
}
