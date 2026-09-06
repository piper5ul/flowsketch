/**
 * Where uploaded images live on disk.
 *
 * Layout is `<UPLOAD_DIR>/<userId>/<imageId>.<ext>`: one directory per user so
 * a listing never leaks across accounts, and a flat file per image so serving
 * one is a single `createReadStream`. `UPLOAD_DIR` defaults to `./uploads`,
 * resolved from the process working directory (not this file — the compiled
 * server runs from `dist-server/`).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/** Read at call time, not module load, so tests can point it at a temp dir. */
export function uploadRoot(): string {
  return path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
}

/**
 * Reject anything that could escape the upload root. Ids come from cuid() and
 * user ids from BetterAuth, so this should never fire — it is here so that a
 * future caller passing user input cannot turn a filename into a traversal.
 */
function assertSafeSegment(segment: string, label: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new Error(`Unsafe ${label} for image storage: ${JSON.stringify(segment)}`);
  }
  return segment;
}

/** Absolute path of one stored image. Does not check that it exists. */
export function imagePath(userId: string, id: string, ext: string): string {
  return path.join(
    uploadRoot(),
    assertSafeSegment(userId, 'user id'),
    `${assertSafeSegment(id, 'image id')}.${assertSafeSegment(ext, 'extension')}`,
  );
}

/** Write an image, creating the user's directory on first upload. */
export async function writeImage(userId: string, id: string, ext: string, buffer: Buffer): Promise<string> {
  const target = imagePath(userId, id, ext);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return target;
}

/** Remove an image. A file that is already gone is not an error. */
export async function deleteImage(userId: string, id: string, ext: string): Promise<void> {
  try {
    await fs.unlink(imagePath(userId, id, ext));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
