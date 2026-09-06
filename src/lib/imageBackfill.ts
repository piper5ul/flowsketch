/**
 * Moving the last base64 images out of the diagram JSON.
 *
 * Before `POST /api/images` existed, a pasted image was inlined into the node
 * as a `data:image/...;base64,...` URL. Those diagrams still open — `ShapeNode`
 * renders an `imageSrc` whatever its scheme — but they carry their pixels
 * through every save, and a couple of screenshots is enough to push a diagram
 * past the 5 MB JSON body limit and strand it as unsaveable.
 *
 * So the first time such a diagram is opened, its inline images are uploaded
 * and the nodes repointed at the short `/api/images/<id>` URL. The work is
 * deliberately not part of loading: the diagram is on screen first, the
 * uploads land afterwards, and an upload that fails simply leaves that node as
 * it was — still rendering, still saveable, still a candidate next time.
 */
import type { ImageMeta } from '../../shared/types';
import type { ShapeData } from '../types';
import { uploadImage } from './imageUpload';

/** Only real images qualify: `data:application/json` and friends are not pictures. */
const BASE64_IMAGE_PREFIX = /^data:image\/[a-z0-9.+-]+;base64,/i;

/** A node still holding its pixels inline. */
export interface Base64ImageNode {
  id: string;
  imageSrc: string;
}

/**
 * What `applyImageBackfill` writes onto a node: the uploaded URL, and the
 * `shape` that makes it render as a bare image. Nothing else is touched, so
 * the node keeps the box it was drawn at.
 */
export interface ImageBackfillPatch {
  id: string;
  imageSrc: string;
  shape: 'image';
}

/** The shape of a node this module reads — anything with an id and some data. */
interface NodeLike {
  id: string;
  data: Partial<ShapeData>;
}

/** Nodes whose `imageSrc` is an inline base64 image, in node order. */
export function findBase64ImageNodes(nodes: readonly NodeLike[]): Base64ImageNode[] {
  const found: Base64ImageNode[] = [];
  for (const node of nodes) {
    const src = node.data?.imageSrc;
    if (typeof src === 'string' && BASE64_IMAGE_PREFIX.test(src)) {
      found.push({ id: node.id, imageSrc: src });
    }
  }
  return found;
}

/**
 * Decodes a base64 data URL into the bytes to upload. Returns null for
 * anything it cannot read rather than throwing: a malformed URL is one node to
 * leave alone, not a reason to abandon the rest of the diagram.
 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  const mime = dataUrl.slice('data:'.length, dataUrl.indexOf(';'));
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

/**
 * Uploads every inline image in `nodes` and returns the patches to apply.
 *
 * One patch per upload that succeeded, in node order. A node whose upload
 * failed is simply absent — the caller can tell from the count that not
 * everything moved.
 */
export async function backfillBase64Images(
  nodes: readonly NodeLike[],
  upload: (blob: Blob) => Promise<ImageMeta> = uploadImage,
): Promise<ImageBackfillPatch[]> {
  const candidates = findBase64ImageNodes(nodes);
  // Sequential on purpose: a diagram with a dozen inlined screenshots should
  // trickle up behind the user's editing, not saturate the connection with it.
  const patches: ImageBackfillPatch[] = [];
  for (const candidate of candidates) {
    const blob = dataUrlToBlob(candidate.imageSrc);
    if (!blob) continue;
    try {
      const image = await upload(blob);
      patches.push({ id: candidate.id, imageSrc: image.url, shape: 'image' });
    } catch {
      // Left inline. It still renders, and the next open tries again.
    }
  }
  return patches;
}
