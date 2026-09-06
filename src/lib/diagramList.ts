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
