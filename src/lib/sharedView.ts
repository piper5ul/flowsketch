/**
 * Reading a diagram through a share token rather than a session.
 *
 * A stored diagram points at its pictures as `/api/images/<id>`, which is an
 * *authenticated* route: it serves the owner, and a member of some diagram that
 * draws the image. Nobody holding only a share link is either of those, so every
 * one of those URLs would 404 on the public page and the board would render as a
 * grid of broken images.
 *
 * The token has its own door — `/api/shared/<token>/images/<id>`, where the
 * diagram's own JSON is the allow-list of what may be fetched — so the nodes are
 * repointed at it as they are loaded. This is the only place that mapping is
 * written down, and it is pure so it can be tested without a page.
 */
import type { SerializedNode } from '../../shared/types';

/**
 * The authenticated image URL a node stores. Anchored, and with the id spelled
 * out, so an `imageSrc` that merely *contains* the path (a base64 data URL from
 * before uploads existed, an absolute URL to some other host) is left alone.
 */
const AUTHENTICATED_IMAGE_URL = /^\/api\/images\/([A-Za-z0-9_-]+)$/;

/** A node's data, as far as this module cares. */
interface NodeWithImage {
  data?: Record<string, unknown>;
}

/**
 * `nodes` with every `/api/images/<id>` repointed at the share token's own
 * image route. Nodes that draw nothing — or that draw something this does not
 * recognise — come back by identity, so the diagram is not needlessly rebuilt.
 */
export function rewriteSharedImageUrls<T extends NodeWithImage>(
  nodes: readonly T[],
  token: string,
): T[] {
  const prefix = `/api/shared/${encodeURIComponent(token)}/images/`;
  return nodes.map((node) => {
    const src = node.data?.imageSrc;
    if (typeof src !== 'string') return node;
    const match = AUTHENTICATED_IMAGE_URL.exec(src);
    if (!match) return node;
    return { ...node, data: { ...node.data, imageSrc: `${prefix}${match[1]}` } };
  });
}

/** `data`'s nodes, rewritten. The rest of the diagram is carried through as-is. */
export function rewriteSharedDiagram<D extends { nodes: SerializedNode[] }>(
  data: D,
  token: string,
): D {
  return { ...data, nodes: rewriteSharedImageUrls(data.nodes, token) };
}
