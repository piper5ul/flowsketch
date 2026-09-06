/**
 * The dashboard's view of the diagram list: fetching it without letting a
 * failure escape, and the pure filter/sort rules the toolbar drives.
 */
import type { DiagramMeta } from '../../shared/types';
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
