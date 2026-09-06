/**
 * The dashboard's view of the diagram list: fetching it without letting a
 * failure escape, and the pure filter/sort rules the toolbar drives.
 */
import type { DiagramMeta, FolderInfo } from '../../shared/types';
import { api } from './api';
import { toastError } from '../store/useToastStore';

/** Either the list, or the fact that it could not be fetched. */
export type DiagramListResult =
  | { ok: true; diagrams: DiagramMeta[] }
  | { ok: false };

/**
 * Fetches the dashboard list. A failure is a value, not a rejection: an
 * uncaught one used to leave the dashboard on "Loading…" forever, so the
 * caller is handed an outcome it has to render either way.
 */
export async function loadDiagrams(): Promise<DiagramListResult> {
  try {
    return { ok: true, diagrams: await api.listDiagrams() };
  } catch {
    toastError('Could not load your diagrams. Please try again.');
    return { ok: false };
  }
}

/**
 * The list split into the dashboard's two sections: the user's own diagrams,
 * and the ones somebody else invited them to.
 *
 * The split is by `role` rather than by an `ownerName` being present, because
 * the role is what the rest of the UI keys off too — the star, the actions
 * menu and what the canvas will let them do when they open it.
 */
export function splitByOwnership(diagrams: DiagramMeta[]): {
  owned: DiagramMeta[];
  shared: DiagramMeta[];
} {
  return {
    owned: diagrams.filter((d) => d.role === 'owner'),
    shared: diagrams.filter((d) => d.role !== 'owner'),
  };
}

/**
 * Fetches the sidebar's folders. Empty rather than fatal on failure: a
 * dashboard whose folders did not load still lists every diagram, and losing
 * the sidebar is a smaller failure than losing the grid with it.
 */
export async function loadFolders(): Promise<FolderInfo[]> {
  try {
    return await api.listFolders();
  } catch {
    toastError('Could not load your folders.');
    return [];
  }
}

/**
 * What the sidebar has selected, and so what the grid shows.
 *
 * `starred` and `shared` are not folders and never will be — one is a flag on
 * the row, the other is somebody else's diagram — so they are cases here
 * rather than reserved folder ids that a real folder could one day collide
 * with.
 */
export type FolderSelection =
  | { kind: 'all' }
  | { kind: 'starred' }
  | { kind: 'shared' }
  | { kind: 'folder'; id: string };

/** The selection a fresh dashboard opens on, and what a deleted folder falls back to. */
export const ALL_DIAGRAMS: FolderSelection = { kind: 'all' };

/**
 * The two sections a selection leaves on screen.
 *
 * "All diagrams" is deliberately the *whole* dashboard — the user's own
 * diagrams and, below them, the ones they were invited to — because that is
 * what the page showed before folders existed and what a user means by "all".
 * Every other selection is a subset of one section, so the other empties.
 *
 * Filing only ever applies to the caller's own diagrams: a shared one carries
 * no `folderId` (the server sends `null`), so a folder never quietly hides
 * somebody else's board.
 */
export function applyFolderSelection(
  sections: { owned: DiagramMeta[]; shared: DiagramMeta[] },
  selection: FolderSelection,
): { owned: DiagramMeta[]; shared: DiagramMeta[] } {
  const { owned, shared } = sections;
  switch (selection.kind) {
    case 'all':
      return { owned, shared };
    case 'starred':
      // Starring is owner-only on the server, so there is no shared half to show.
      return { owned: owned.filter((d) => d.starred), shared: [] };
    case 'folder':
      return { owned: owned.filter((d) => d.folderId === selection.id), shared: [] };
    case 'shared':
      return { owned: [], shared };
  }
}

/**
 * How many diagrams sit in each folder, keyed by folder id.
 *
 * Derived from the list the grid is already holding rather than read from
 * `FolderInfo.diagramCount`, so the number beside a folder changes the moment
 * a card is moved into it instead of after a round trip. The server's count is
 * the same number for a client that has just loaded; this one stays right
 * afterwards too.
 */
export function countByFolder(diagrams: DiagramMeta[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const diagram of diagrams) {
    if (diagram.folderId === null) continue;
    counts.set(diagram.folderId, (counts.get(diagram.folderId) ?? 0) + 1);
  }
  return counts;
}

export type DiagramSort = 'updated' | 'title' | 'created';

/** The sort control's options, in the order it offers them. */
export const DIAGRAM_SORTS: { value: DiagramSort; label: string }[] = [
  { value: 'updated', label: 'Last edited' },
  { value: 'title', label: 'Title' },
  { value: 'created', label: 'Created' },
];

/** Diagrams whose title contains `query`, ignoring case and outer whitespace. */
export function filterDiagrams(diagrams: DiagramMeta[], query: string): DiagramMeta[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return diagrams;
  return diagrams.filter((d) => d.title.toLowerCase().includes(needle));
}

function newestFirst(a: string, b: string): number {
  return new Date(b).getTime() - new Date(a).getTime();
}

/**
 * Orders the grid. Starred diagrams are pinned to the front whatever the sort
 * — starring is the user saying "keep this where I can see it", which a sort
 * order should not be able to bury.
 */
export function sortDiagrams(diagrams: DiagramMeta[], sort: DiagramSort): DiagramMeta[] {
  return [...diagrams].sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1;
    if (sort === 'title') return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    if (sort === 'created') return newestFirst(a.createdAt, b.createdAt);
    return newestFirst(a.updatedAt, b.updatedAt);
  });
}
