/**
 * Turning a file the user handed us into an image the diagram can reference.
 *
 * Diagrams are stored as one JSON document behind a 5 MB body limit, so an
 * image can never live inside them: it is uploaded to `POST /api/images` and
 * the diagram keeps the short `/api/images/<id>` URL that comes back. Before
 * that, anything larger than `MAX_EDGE_PX` is downscaled in the browser —
 * a 12-megapixel phone photo is nobody's idea of a 300 px diagram tile, and
 * shrinking it here saves the upload as well as the disk.
 */
import type { ImageMeta } from '../../shared/types';

const BASE = import.meta.env.VITE_API_URL || '';

/** Matches the server's own upload ceiling in `server/images.ts`. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Longest edge kept after downscaling. Twice a 4K-ish canvas tile. */
export const DEFAULT_MAX_EDGE_PX = 2000;

/** JPEG quality for re-encoded images. Visually lossless at diagram sizes. */
const JPEG_QUALITY = 0.9;

export const TOO_LARGE_MESSAGE = 'That image is over 10 MB. Try a smaller one.';
const UNSUPPORTED_MESSAGE = 'That file is not an image we can read. Use a PNG, JPEG, GIF or WEBP.';

/**
 * The box `width × height` fits into when its longer edge is capped at
 * `maxEdge`, preserving the aspect ratio. Never upscales: an image already
 * inside the box comes back untouched.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return {
    // A very wide, very short image must not round its short edge to nothing.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** True for a file the server would reject outright. Checked before uploading. */
export function isImageTooLarge(blob: Blob): boolean {
  return blob.size > MAX_IMAGE_BYTES;
}

/**
 * Re-encodes `file` so its longer edge is at most `maxEdge`, returning the
 * bytes to upload along with their pixel size.
 *
 * PNGs stay PNGs — they are usually screenshots or diagrams, where JPEG's
 * ringing around text is obvious. Everything else comes back as JPEG. GIFs are
 * passed through untouched: a canvas re-encode would keep only the first frame
 * and silently kill the animation.
 */
export async function downscaleImage(
  file: Blob,
  maxEdge: number = DEFAULT_MAX_EDGE_PX,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const target = fitWithin(bitmap.width, bitmap.height, maxEdge);

  // Nothing to gain from a re-encode when the pixels are already in range.
  if (file.type === 'image/gif' || (target.width === bitmap.width && target.height === bitmap.height)) {
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return { blob: file, ...size };
  }

  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return { blob: file, width: bitmap.width, height: bitmap.height };
  }
  ctx.drawImage(bitmap, 0, 0, target.width, target.height);
  bitmap.close();

  const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mime, mime === 'image/jpeg' ? JPEG_QUALITY : undefined);
  });
  // `toBlob` yields null only when the canvas cannot be encoded at all; the
  // original bytes are still a valid upload, so fall back to them.
  if (!blob) return { blob: file, width: target.width, height: target.height };
  return { blob, width: target.width, height: target.height };
}

/**
 * Uploads image bytes and returns the stored image's metadata. Throws an
 * `Error` whose message is safe to show the user as-is.
 */
export async function uploadImage(blob: Blob): Promise<ImageMeta> {
  if (isImageTooLarge(blob)) throw new Error(TOO_LARGE_MESSAGE);

  const res = await fetch(`${BASE}/api/images`, {
    method: 'POST',
    body: blob,
    // The server buffers `image/*` bodies raw; anything else is turned away
    // before a byte is read, so the blob's own type has to travel with it.
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    credentials: 'include',
  });

  if (!res.ok) {
    if (res.status === 413) throw new Error(TOO_LARGE_MESSAGE);
    if (res.status === 415) throw new Error(UNSUPPORTED_MESSAGE);
    throw new Error('Could not upload that image. Please try again.');
  }
  return (await res.json()) as ImageMeta;
}
