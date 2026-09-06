/**
 * Which uploaded images a diagram's JSON still points at.
 *
 * Kept free of Prisma and fs so the scanning rules — the part that decides
 * whether a file gets deleted — are covered by plain unit tests.
 */

/** Matches exactly `/api/images/<id>`, optionally with a query string. */
const IMAGE_URL = /^\/api\/images\/([A-Za-z0-9_-]+)(?:\?.*)?$/;

/**
 * Every image id referenced by a node's `data.imageSrc`, deduped.
 *
 * Base64 data URLs (the pre-upload format still written by the client) and any
 * URL that is not one of our own image routes are ignored, so an id is only
 * ever returned for a file this server actually stores.
 */
export function imageIdsInDiagram(data: unknown): string[] {
  if (typeof data !== 'object' || data === null) return [];
  const nodes = (data as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];

  const ids = new Set<string>();
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) continue;
    const nodeData = (node as { data?: unknown }).data;
    if (typeof nodeData !== 'object' || nodeData === null) continue;
    const imageSrc = (nodeData as { imageSrc?: unknown }).imageSrc;
    if (typeof imageSrc !== 'string') continue;
    const match = IMAGE_URL.exec(imageSrc);
    if (match) ids.add(match[1]);
  }
  return [...ids];
}
