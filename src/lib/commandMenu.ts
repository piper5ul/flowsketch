/**
 * The pure half of the ⌘K command menu: which commands are offered for a
 * query, in what order, and which were used recently.
 *
 * Ranking is deliberately simple and explainable — the menu is for finding a
 * command whose name you half know, not for fuzzy magic: a title that starts
 * with the query beats one with a word that starts with it, which beats one
 * that merely contains it, which beats one whose letters appear in order.
 * Ties keep the registry's own order, which is grouped and stable.
 */

export interface MenuCommand {
  id: string;
  title: string;
}

/** How many recently-used commands lead the list when nothing has been typed. */
export const RECENT_SHOWN = 3;
/** How many are remembered. */
export const RECENT_KEPT = 8;

function scoreOf(title: string, query: string): number | null {
  const t = title.toLowerCase();
  if (t.startsWith(query)) return 0;
  if (t.split(/\s+/).some((word) => word.startsWith(query))) return 1;
  if (t.includes(query)) return 2;
  // Subsequence: every character of the query appears in order.
  let i = 0;
  for (const ch of t) if (ch === query[i]) i++;
  return i === query.length ? 3 : null;
}

/**
 * The commands to show for `query`: with nothing typed, the recent ones first
 * (most recent first, only those still on offer) and then everything in
 * registry order; otherwise every match, best first.
 */
export function rankCommands<T extends MenuCommand>(query: string, commands: readonly T[], recents: readonly string[]): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') {
    const byId = new Map(commands.map((c) => [c.id, c] as const));
    const lead = recents.map((id) => byId.get(id)).filter((c): c is T => c !== undefined).slice(0, RECENT_SHOWN);
    const leadIds = new Set(lead.map((c) => c.id));
    return [...lead, ...commands.filter((c) => !leadIds.has(c.id))];
  }
  return commands
    .map((c, index) => ({ c, index, score: scoreOf(c.title, q) }))
    .filter((e): e is { c: T; index: number; score: number } => e.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((e) => e.c);
}

/** `recents` with `id` moved to the front, capped at `RECENT_KEPT`. */
export function rememberRecent(recents: readonly string[], id: string): string[] {
  return [id, ...recents.filter((r) => r !== id)].slice(0, RECENT_KEPT);
}

/** Only strings, and only so many: a stored value from another build is not trusted further than that. */
export function sanitizeRecents(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, RECENT_KEPT) : [];
}
