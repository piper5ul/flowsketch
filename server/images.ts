/**
 * Image upload, download and deletion.
 *
 * Bytes live on disk (see storage.ts) and only the metadata is rowed in
 * Postgres, so a diagram stores a short `/api/images/<id>` URL instead of a
 * base64 blob that would blow past the 5 MB JSON body limit.
 */
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { prisma } from './db.js';
import { requireAuth } from './middleware.js';
import { extForMime, sniffImage } from './imageTypes.js';
import { imageIdsInDiagram } from './imageRefs.js';
import { imagesReferencedByLiveDiagrams, isImageInMemberDiagram } from './diagramImages.js';
import { deleteImage, imagePath, writeImage } from './storage.js';
import { createImageUploadLimiter } from './rateLimit.js';
import { authedUser } from './types.js';
import type { ImageMeta } from '../shared/types.js';

/** Upload ceiling. Kept separate from the 5 MB JSON limit in index.ts. */
const MAX_UPLOAD_BYTES = '10mb';

export const imagesRouter = Router();

imagesRouter.use(requireAuth);

imagesRouter.post(
  '/',
  // Ahead of the body parser, so a flood of oversized uploads is turned away
  // before 10 MB of it is buffered.
  createImageUploadLimiter(),
  express.raw({ type: 'image/*', limit: MAX_UPLOAD_BYTES }),
  async (req, res) => {
    // A non-image Content-Type is never buffered by the parser above, and a
    // body that only claims to be an image is caught by sniffing its bytes.
    const body: unknown = req.body;
    const sniffed = Buffer.isBuffer(body) ? sniffImage(body) : null;
    if (!sniffed) {
      res.status(415).json({ error: 'Unsupported image type. Expected PNG, JPEG, GIF or WEBP.' });
      return;
    }

    const owner = authedUser(req).id;
    const image = await prisma.image.create({
      data: {
        userId: owner,
        mime: sniffed.mime,
        size: (body as Buffer).length,
        width: sniffed.width,
        height: sniffed.height,
      },
    });

    try {
      await writeImage(owner, image.id, sniffed.ext, body as Buffer);
    } catch (err) {
      // Never leave a row pointing at bytes that are not there.
      await prisma.image.delete({ where: { id: image.id } }).catch(() => {});
      throw err;
    }

    const meta: ImageMeta = {
      id: image.id,
      url: `/api/images/${image.id}`,
      mime: image.mime,
      size: image.size,
      width: image.width,
      height: image.height,
    };
    res.status(201).json(meta);
  },
);

/**
 * Streams an image row's bytes, or 404s when the file behind it is not there
 * (a row whose mime we cannot name an extension for is the same case). Shared
 * with the tokened route in `sharing.ts`, which reaches the same files through
 * a different gate.
 */
export async function sendImage(
  res: Response,
  image: { id: string; userId: string; mime: string; size: number },
): Promise<void> {
  const ext = extForMime(image.mime);
  if (!ext) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const file = imagePath(image.userId, image.id, ext);
  try {
    await fs.access(file);
  } catch {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  // Content is immutable: an edit uploads a new image with a new id.
  res.setHeader('Content-Type', image.mime);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('Content-Length', String(image.size));
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/**
 * Whether `viewerId` may see `imageId` without owning it: they may, if any
 * diagram they were invited to draws it.
 *
 * **Cost:** one indexed lookup on `DiagramImage`. This used to read the JSON of
 * every diagram shared with the caller and search it for the id — the join
 * table (`server/diagramImages.ts`) is exactly the index Postgres could not
 * build over an arbitrary node's `imageSrc`.
 */
async function memberCanSeeImage(viewerId: string, imageId: string): Promise<boolean> {
  return isImageInMemberDiagram(viewerId, imageId);
}

imagesRouter.get('/:id', async (req, res) => {
  const viewer = authedUser(req).id;
  const image = await prisma.image.findUnique({ where: { id: req.params.id } });
  // 404 rather than 403 for an image they may not see: ownership, and the
  // existence of the row itself, both stay unobservable.
  if (!image) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (image.userId !== viewer && !(await memberCanSeeImage(viewer, image.id))) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await sendImage(res, image);
});

imagesRouter.delete('/:id', async (req, res) => {
  const owner = authedUser(req).id;
  const image = await prisma.image.findFirst({
    where: { id: req.params.id, userId: owner },
    select: { id: true, mime: true },
  });
  if (!image) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await prisma.image.delete({ where: { id: image.id } });
  const ext = extForMime(image.mime);
  if (ext) await deleteImage(owner, image.id, ext);
  res.status(204).end();
});

/**
 * Body-parser rejects an oversized upload with an HTML error page by default.
 * Every other route on this API answers in JSON, so this one should too.
 */
imagesRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.too.large') {
    res.status(413).json({ error: `Image too large. Maximum upload size is ${MAX_UPLOAD_BYTES}.` });
    return;
  }
  next(err);
});

/**
 * Delete the images in `candidateIds` that nothing of `ownerId`'s references
 * any more, rows and files both. Call it *after* the diagram (or version) that
 * referenced them is gone, or it will count itself as a live reference.
 *
 * **What counts as a reference:** the owner's live diagrams *and* the stored
 * `DiagramVersion` rows of those diagrams. Scanning boards alone was the
 * original behaviour and it was wrong: an image edited off the canvas was
 * deleted while a snapshot still drew it, so restoring far enough back brought
 * the node back pointing at a 404. Version history is part of what keeps an
 * image alive, so it is part of what decides one is dead.
 *
 * **Cost:** one indexed lookup for the live diagrams (`DiagramImage`), and the
 * old `data`-wide scan of version history only for whatever the index did not
 * already save — usually nothing, since an image being collected has just left
 * the board it was on. Retention caps history at `MAX_VERSIONS` per diagram, so
 * that scan is bounded even when it does run.
 */
export async function deleteOrphanImages(ownerId: string, candidateIds: string[]): Promise<string[]> {
  if (candidateIds.length === 0) return [];

  const live = await imagesReferencedByLiveDiagrams(ownerId, candidateIds);
  const unclaimed = candidateIds.filter((id) => !live.has(id));
  if (unclaimed.length === 0) return [];

  // Versions are deliberately not indexed row by row: this is the only place
  // that asks about them, and only about images no live diagram claims.
  const history = await prisma.diagramVersion.findMany({
    where: { diagram: { userId: ownerId } },
    select: { data: true },
  });
  const inHistory = new Set(history.flatMap((v) => imageIdsInDiagram(v.data)));
  const orphanIds = unclaimed.filter((id) => !inHistory.has(id));
  if (orphanIds.length === 0) return [];

  // Scoped by userId so an id planted in the JSON cannot delete another
  // account's image.
  const orphans = await prisma.image.findMany({
    where: { id: { in: orphanIds }, userId: ownerId },
    select: { id: true, mime: true },
  });
  if (orphans.length === 0) return [];

  await prisma.image.deleteMany({ where: { id: { in: orphans.map((o) => o.id) }, userId: ownerId } });
  await Promise.all(
    orphans.map(async (o) => {
      const ext = extForMime(o.mime);
      if (ext) await deleteImage(ownerId, o.id, ext);
    }),
  );
  return orphans.map((o) => o.id);
}
