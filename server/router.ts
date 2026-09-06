import { Router } from 'express';
import { prisma } from './db.js';
import { requireAuth } from './middleware.js';
import { deleteOrphanImages } from './images.js';
import { imageIdsInDiagram } from './imageRefs.js';
import { authedUser } from './types.js';
import {
  copyTitle,
  createDiagramBody,
  updateDiagramBody,
  validateBody,
  type CreateDiagramBody,
  type UpdateDiagramBody,
} from './validation.js';

export const apiRouter = Router();

apiRouter.use(requireAuth);

apiRouter.get('/diagrams', async (req, res) => {
  const userId = authedUser(req).id;
  const diagrams = await prisma.diagram.findMany({
    where: { userId },
    select: {
      id: true,
      title: true,
      starred: true,
      createdAt: true,
      updatedAt: true,
      thumbnail: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(diagrams);
});

// The explicit generics are what make `req.body` the parsed shape rather than
// `any`; Express only infers them for a route with a single handler.
apiRouter.post<Record<string, string>, unknown, CreateDiagramBody>(
  '/diagrams',
  validateBody(createDiagramBody),
  async (req, res) => {
    const userId = authedUser(req).id;
    const { title, data } = req.body;
    const diagram = await prisma.diagram.create({
      data: {
        userId,
        title: title || 'Untitled',
        data: data || { nodes: [], edges: [] },
      },
    });
    res.status(201).json(diagram);
  },
);

apiRouter.get('/diagrams/:id', async (req, res) => {
  const userId = authedUser(req).id;
  const diagram = await prisma.diagram.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!diagram) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(diagram);
});

apiRouter.put<{ id: string }, unknown, UpdateDiagramBody>(
  '/diagrams/:id',
  validateBody(updateDiagramBody),
  async (req, res) => {
    const userId = authedUser(req).id;
    const existing = await prisma.diagram.findFirst({
      where: { id: req.params.id, userId },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const { title, data, starred, thumbnail } = req.body;
    const updated = await prisma.diagram.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined && { title }),
        ...(data !== undefined && { data }),
        ...(starred !== undefined && { starred }),
        ...(thumbnail !== undefined && { thumbnail }),
      },
    });
    res.json(updated);
  },
);

apiRouter.delete('/diagrams/:id', async (req, res) => {
  const userId = authedUser(req).id;
  const existing = await prisma.diagram.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true, data: true },
  });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const referencedImageIds = imageIdsInDiagram(existing.data);
  await prisma.diagram.delete({ where: { id: req.params.id } });

  // Only after the row is gone, or the diagram would count as a live reference
  // to its own images. A cleanup failure leaves orphaned files, not a failed
  // delete: the diagram the caller asked to remove is already gone.
  try {
    await deleteOrphanImages(userId, referencedImageIds);
  } catch (err) {
    console.error(`Orphan image cleanup failed for diagram ${req.params.id}:`, err);
  }
  res.status(204).end();
});

apiRouter.post('/diagrams/:id/duplicate', async (req, res) => {
  const userId = authedUser(req).id;
  const source = await prisma.diagram.findFirst({
    where: { id: req.params.id, userId },
    select: { title: true, data: true, thumbnail: true },
  });
  if (!source) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const copy = await prisma.diagram.create({
    data: {
      userId,
      title: copyTitle(source.title),
      data: source.data ?? {},
      // The thumbnail is already rendered and the copy looks identical, so
      // carrying it over saves the new card a trip through the icon.
      thumbnail: source.thumbnail,
      // A copy is not what the user starred.
      starred: false,
    },
  });
  res.status(201).json(copy);
});

apiRouter.patch('/diagrams/:id/star', async (req, res) => {
  const userId = authedUser(req).id;
  const diagram = await prisma.diagram.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true, starred: true },
  });
  if (!diagram) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const updated = await prisma.diagram.update({
    where: { id: req.params.id },
    data: { starred: !diagram.starred },
  });
  res.json({ starred: updated.starred });
});
