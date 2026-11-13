/**
 * What a screen reader calls a connector. React Flow's own name is "Edge from
 * <source id> to <target id>", and an id is a random string nobody can say, so
 * a connector is named after the labels of the shapes it joins instead.
 *
 * The name is handed to React Flow on the edge objects it draws (`ariaLabel`)
 * and never reaches the store: `serializeEdge` writes a fixed list of keys.
 */

/** A label as one line of plain words, or `''` when there is nothing to say. */
function spoken(label: unknown): string {
  return typeof label === 'string' ? label.replace(/\s+/g, ' ').trim() : '';
}

/** "Connector from A to B", saying only the ends that have a label. */
export function connectorAriaLabel(sourceLabel: unknown, targetLabel: unknown): string {
  const from = spoken(sourceLabel);
  const to = spoken(targetLabel);
  if (from && to) return `Connector from ${from} to ${to}`;
  if (from) return `Connector from ${from}`;
  if (to) return `Connector to ${to}`;
  return 'Connector';
}

interface AriaEdge {
  source: string;
  target: string;
  ariaLabel?: string;
}

/** The labelled copy made of each store edge, kept until its name changes. */
const labelled = new WeakMap<object, { name: string; edge: object }>();

/**
 * `edges` with an `ariaLabel` each, from `labelOf` (a node id to its label).
 *
 * **Identity is the point.** React Flow re-renders a connector whose edge
 * object changed, and a big board depends on a connector re-rendering only
 * when its own line moves (see `connectorGeometry.ts`). So each store edge
 * keeps one labelled copy until its name actually changes, and when no copy
 * changed at all the `previous` array itself comes back — dragging a shape
 * hands React Flow the very same edges it already has.
 */
export function withConnectorAriaLabels<E extends AriaEdge>(
  edges: readonly E[],
  labelOf: (id: string) => unknown,
  previous: readonly E[],
): E[] {
  let unchanged = edges.length === previous.length;
  const next = edges.map((edge, index) => {
    const name = connectorAriaLabel(labelOf(edge.source), labelOf(edge.target));
    const hit = labelled.get(edge);
    let out: E;
    if (hit && hit.name === name) {
      out = hit.edge as E;
    } else {
      out = { ...edge, ariaLabel: name };
      labelled.set(edge, { name, edge: out });
    }
    if (out !== previous[index]) unchanged = false;
    return out;
  });
  return unchanged ? (previous as E[]) : next;
}
