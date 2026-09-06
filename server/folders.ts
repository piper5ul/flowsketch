/**
 * Personal folders: one flat level of filing over the diagrams a user owns.
 *
 * Everything here is scoped to `authedUser(req).id` and nothing else. A folder
 * has no access list, is never listed to anybody but its owner, and cannot be
 * shared — which is what makes the routes below as short as they are: the
 * question a diagram route has to ask `server/access.ts` ("what may you do with
 * this?") has one answer for a folder, so the `where` clause *is* the
 * authorization rule, exactly as it was for diagrams before sharing existed.
 *
 * A folder the caller does not own is answered `404` rather than `403`, for the
 * same reason a diagram they cannot see is: someone else's filing should not be
 * enumerable by id.
 *
 * Deleting a folder never deletes a diagram. The foreign key is `ON DELETE SET
 * NULL`, so the rows the folder held come back to the root of the dashboard on
 * their own — no route here touches the `Diagram` table at all.
 */
import { Router } from 'express';
import { prisma } from './db.js';
import { authedUser } from './types.js';
import { folderNameBody, validateBody, type FolderNameBody } from './validation.js';
import type { FolderInfo } from '../shared/types.js';

export const foldersRouter = Router();

/**
 * True when `folderId` names a folder `userId` owns.
 *
 * Lives here rather than in the diagram router because it is the same
 * ownership rule the routes below run, and `PUT /api/diagrams/:id` needs it to
 * decide whether a move is a move or an attempt to file a diagram into
 * somebody else's drawer.
 */
export async function ownsFolder(userId: string, folderId: string): Promise<boolean> {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, userId }, select: { id: true } });
  return folder !== null;
}

/** A folder row plus its diagram count, as the sidebar reads it. */
function toFolderInfo(row: {
  id: string;
  name: string;
  createdAt: Date;
  _count: { diagrams: number };
}): FolderInfo {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    diagramCount: row._count.diagrams,
  };
}

/**
 * The caller's folders, oldest first, each with how many diagrams it holds.
 *
 * Oldest first rather than alphabetical: the sidebar is a list the user built
 * by adding to it, and a new folder appearing in the middle of the list is
 * harder to find than one appearing at the end of it. The count comes from the
 * relation rather than a second query, so the sidebar is one round trip.
 */
foldersRouter.get('/folders', async (req, res) => {
  const userId = authedUser(req).id;
  const folders = await prisma.folder.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, createdAt: true, _count: { select: { diagrams: true } } },
  });
  res.json(folders.map(toFolderInfo));
});

foldersRouter.post<Record<string, string>, unknown, FolderNameBody>(
  '/folders',
  validateBody(folderNameBody),
  async (req, res) => {
    const folder = await prisma.folder.create({
      data: { userId: authedUser(req).id, name: req.body.name },
      select: { id: true, name: true, createdAt: true },
    });
    // Nothing has been filed into it yet, so the count is known without asking.
    res.status(201).json(toFolderInfo({ ...folder, _count: { diagrams: 0 } }));
  },
);

/**
 * Renames a folder. `updateMany` rather than `update`, because the scoping
 * clause is the authorization check: `update` can only be given a unique
 * `where`, which would mean reading the row to see whose it is and then
 * writing it — two queries, and a window between them.
 */
foldersRouter.patch<{ id: string }, unknown, FolderNameBody>(
  '/folders/:id',
  validateBody(folderNameBody),
  async (req, res) => {
    const userId = authedUser(req).id;
    const { count } = await prisma.folder.updateMany({
      where: { id: req.params.id, userId },
      data: { name: req.body.name },
    });
    if (count === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const folder = await prisma.folder.findFirst({
      where: { id: req.params.id, userId },
      select: { id: true, name: true, createdAt: true, _count: { select: { diagrams: true } } },
    });
    // Deleted between the write and the read back — vanishingly unlikely, and
    // "it is not there" is the honest answer rather than an invented row.
    if (!folder) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(toFolderInfo(folder));
  },
);

/**
 * Removes a folder. The diagrams it held are *not* touched: `Diagram.folderId`
 * is `ON DELETE SET NULL`, so they come back to the root of the dashboard on
 * their own. Deleting a label must never delete the work.
 */
foldersRouter.delete('/folders/:id', async (req, res) => {
  const { count } = await prisma.folder.deleteMany({
    where: { id: req.params.id, userId: authedUser(req).id },
  });
  if (count === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(204).end();
});
