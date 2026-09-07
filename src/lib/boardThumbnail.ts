/**
 * The board's custom thumbnail — which shapes stand for the whole diagram on
 * the dashboard card.
 *
 * "Set as board thumbnail" (Whimsical's own) remembers a set of node ids;
 * `DiagramData.thumbnailNodeIds` is where they are stored and the collaborative
 * document's `meta` map is where they live while the board is open. Absent
 * means **automatic**: the card shows a picture of the whole board, which is
 * what every diagram written before this existed already wants — so this needed
 * no format version, exactly like `DiagramData.defaults`.
 *
 * The module is pure and knows nothing about the store, React or Yjs, which is
 * what lets `migrateDiagramData` (a stored row), `server/collab/render.ts` (a
 * document rendered to JSON) and `src/lib/collab/binding.ts` (a peer's write)
 * all narrow the same untrusted value through the same `sanitizeThumbnailIds`.
 *
 * Relative imports would spell out `.js` here — the server compiles this under
 * `nodenext`, see the note on `diagramMigrations.ts` in CLAUDE.md — but there
 * are none: this file depends on nothing.
 */

/**
 * The stored ids, if they are ids at all.
 *
 * `Diagram.data` is a free-form JSON column and the document is written by
 * other browsers, so what comes back is anything: a string, a list of numbers,
 * a list with a `null` in it. Everything that is not a non-empty string is
 * dropped and duplicates are collapsed (a repeated id would render the same
 * shape twice and make "is this selection already the thumbnail?" answer no to
 * a selection that is), and a value with nothing left in it is `null` — which
 * is the same thing as an absent field: an automatic thumbnail.
 *
 * Ids naming shapes that are no longer on the board are *not* dropped here:
 * this narrows a value's shape and knows nothing about any diagram. See
 * `thumbnailSubsetIds`, which is where a board gets a say.
 */
export function sanitizeThumbnailIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    ids.push(entry);
  }
  return ids.length > 0 ? ids : null;
}

/**
 * The thumbnail's ids that are still on the board.
 *
 * A shape the thumbnail names can be deleted — by this user or by a
 * collaborator — and a thumbnail of nothing is not a picture. The ids
 * themselves are deliberately **left in place** when that happens: an undo, a
 * version restore or a peer's own undo can bring the shape back, and quietly
 * rewriting the board's thumbnail because a shape was missing for a moment
 * would be a worse answer than falling back to the whole board until it is.
 *
 * Order follows the stored ids rather than the node array: nothing downstream
 * cares (the subset is a set), and keeping it makes the result readable.
 */
export function thumbnailSubsetIds(
  ids: readonly string[] | null | undefined,
  nodes: readonly { id: string }[],
): string[] {
  if (!ids || ids.length === 0) return [];
  const present = new Set(nodes.map((node) => node.id));
  return ids.filter((id) => present.has(id));
}

/**
 * Whether `selected` is already exactly the thumbnail — the question
 * `view.setThumbnail`'s `when` asks, so the menu does not offer to set what is
 * already set. A set comparison: which order the user clicked two shapes in is
 * not part of what the thumbnail is.
 */
export function isSameThumbnail(
  ids: readonly string[] | null | undefined,
  selected: readonly string[],
): boolean {
  if (!ids || ids.length === 0) return false;
  if (ids.length !== selected.length) return false;
  const wanted = new Set(ids);
  return selected.every((id) => wanted.has(id));
}
