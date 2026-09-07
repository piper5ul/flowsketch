/**
 * Finding a shape or a connector on the board by what it says.
 *
 * Pure and structural, the way `arrange.ts` is: this is handed labels and
 * positions rather than the store, so the ordering rules below can be stated
 * over plain objects and tested without a diagram behind them. The store's
 * `ShapeNode[]` and `ConnectorEdge[]` satisfy these shapes as they stand.
 */

export interface SearchableNode {
  id: string;
  position: { x: number; y: number };
  data: {
    label?: string;
    /**
     * A table's grid, when the node is one. Searched cell by cell — a table
     * says what it says in its cells, and a find that could not reach them
     * would miss most of the words on a board that uses them.
     */
    table?: { rows: { cells: string[] }[] };
  };
}

export interface SearchableEdge {
  id: string;
  data?: { label?: string };
}

export type SearchHitKind = 'node' | 'edge';

/**
 * One shape or connector whose label holds the query.
 *
 * At most one hit per element, at the *first* occurrence: "3 of 7" counts
 * things on the board, which is what the user is cycling through, and not the
 * number of times a word happens to appear inside one of them.
 */
export interface SearchHit {
  kind: SearchHitKind;
  id: string;
  /** The whole label the match was found in, as it is drawn. */
  text: string;
  /** Where the match starts in `text`, and one past where it ends. */
  start: number;
  end: number;
}

function hitIn(kind: SearchHitKind, id: string, text: string, needle: string): SearchHit[] {
  const start = text.toLowerCase().indexOf(needle);
  return start < 0 ? [] : [{ kind, id, text, start, end: start + needle.length }];
}

/**
 * The one hit a shape is worth: its label, or — for a table — the first of its
 * cells that holds the query, read row by row.
 *
 * Still **at most one hit per element**: a table full of the word is one thing
 * on the board and counts once, exactly as a label that says it three times
 * does. The `text` reported is the cell the match was found in, which is what
 * the find bar would highlight if it drew the words rather than a ring.
 */
function hitInNode(node: SearchableNode, needle: string): SearchHit[] {
  const label = hitIn('node', node.id, node.data.label ?? '', needle);
  if (label.length > 0) return label;
  for (const row of node.data.table?.rows ?? []) {
    for (const cell of row.cells) {
      const hit = hitIn('node', node.id, cell, needle);
      if (hit.length > 0) return hit;
    }
  }
  return [];
}

/**
 * Reading order: down the board, then across it, so the cycle moves the way
 * the eye does. Two shapes a pixel apart vertically are two rows rather than
 * one — a rule that is wrong about a hand-drawn row is also one nobody can
 * predict, and the id breaks the remaining ties so the order never depends on
 * where a node happens to sit in the array.
 */
function byReadingOrder(a: SearchableNode, b: SearchableNode): number {
  if (a.position.y !== b.position.y) return a.position.y - b.position.y;
  if (a.position.x !== b.position.x) return a.position.x - b.position.x;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Every shape and connector whose label — or, for a table, whose cells —
 * contains `query`, case-insensitively, in the order the find bar cycles them:
 * shapes first in reading order, then connectors in the order the diagram
 * holds them.
 *
 * An empty query matches nothing rather than everything — an empty find bar
 * should light the board up no more than a closed one does. A query that is
 * only whitespace is a real search: somebody looking for a double space means
 * it, and there is no other way to ask for one.
 */
export function searchDiagram(
  nodes: SearchableNode[],
  edges: SearchableEdge[],
  query: string,
): SearchHit[] {
  if (query === '') return [];
  const needle = query.toLowerCase();
  return [
    ...[...nodes]
      .sort(byReadingOrder)
      .flatMap((node) => hitInNode(node, needle)),
    ...edges.flatMap((edge) => hitIn('edge', edge.id, edge.data?.label ?? '', needle)),
  ];
}
