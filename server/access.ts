/**
 * Who may do what with a diagram.
 *
 * Before sharing existed every route scoped its lookup with
 * `where: { id, userId }`, which answered "is this yours?" and read the row in
 * the same query. A diagram now has an owner *and* invited members, so the
 * question is "what may you do with this?" — this module is the one place that
 * answers it, and it keeps the single-query property: the access check and the
 * columns the route needs come back together.
 */
import type { Request, Response } from 'express';
import { prisma } from './db.js';
import { authedUser } from './types.js';
import type { DiagramRole } from '../shared/types.js';

/**
 * The roles ordered by power. A check is always "at least this role", so a new
 * role cannot be added without deciding where it sits.
 */
const ROLE_RANK: Record<DiagramRole, number> = { viewer: 1, editor: 2, owner: 3 };

/** True when `role` is `minimum` or stronger. */
export function roleAtLeast(role: DiagramRole, minimum: DiagramRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** A stored role is a plain String column; anything else is not a role at all. */
function asMemberRole(role: string): DiagramRole | null {
  return role === 'editor' || role === 'viewer' ? role : null;
}

/** The `Diagram` columns a route may ask for alongside the access check. */
export interface DiagramRow {
  id: string;
  userId: string;
  title: string;
  data: unknown;
  thumbnail: string | null;
  starred: boolean;
  shareToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A Prisma-style `select` restricted to the columns above. */
export type DiagramColumns = { [K in keyof DiagramRow]?: true };

/** Only the columns that were asked for are populated, so only those are typed. */
export type SelectedDiagram<S extends DiagramColumns> = Pick<
  DiagramRow,
  Extract<keyof S, keyof DiagramRow>
>;

export interface DiagramAccess<S extends DiagramColumns> {
  diagram: SelectedDiagram<S>;
  role: DiagramRole;
}

/**
 * What `userId` may do with `diagramId`, plus the columns in `select`, or
 * `null` when they may do nothing at all (which covers a diagram that is not
 * there — the two stay indistinguishable).
 *
 * One query: the member row is read as a nested filtered relation rather than
 * a second round trip, and the owner is decided from `userId` on the row.
 */
export async function getDiagramAccess<S extends DiagramColumns>(
  userId: string,
  diagramId: string,
  select: S,
): Promise<DiagramAccess<S> | null> {
  const row = (await prisma.diagram.findFirst({
    where: {
      id: diagramId,
      OR: [{ userId }, { members: { some: { userId } } }],
    },
    select: {
      ...select,
      // Always read, whatever the caller asked for: these are what decide the
      // role. `members` is filtered to the caller, so it is at most one row.
      userId: true,
      members: { where: { userId }, select: { role: true } },
    },
  })) as (SelectedDiagram<S> & { userId?: string; members?: { role: string }[] }) | null;

  if (!row) return null;

  if (row.userId === userId) return { diagram: row, role: 'owner' };

  const membership = row.members?.[0];
  const role = membership ? asMemberRole(membership.role) : null;
  // A row that matched the `OR` but carries no role we recognise is a member
  // row written by a newer build. Refusing is the safe reading.
  if (!role) return null;
  return { diagram: row, role };
}

/**
 * `getDiagramAccess` for a request, answering the client itself when the
 * caller may not proceed: `404` when they have no access to `:id` at all (a
 * diagram they cannot see stays indistinguishable from one that is not there)
 * and `403` when they can see it but not do this to it. Returns `null` in both
 * cases, so a route is `const access = await …; if (!access) return;`.
 */
export async function requireDiagramRole<S extends DiagramColumns>(
  req: Request<{ id: string }>,
  res: Response,
  minimum: DiagramRole,
  select: S,
): Promise<DiagramAccess<S> | null> {
  const access = await getDiagramAccess(authedUser(req).id, req.params.id, select);
  if (!access) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  if (!roleAtLeast(access.role, minimum)) {
    // Not a 404: reaching here means the caller already knows it exists.
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return access;
}
