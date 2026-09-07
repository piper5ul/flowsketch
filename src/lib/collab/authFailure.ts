/**
 * What the browser does about a refused collaboration socket.
 *
 * The provider reports a refusal as one string (`onAuthenticationFailed`'s
 * `reason`), written by the server out of `shared/collabAuth.ts`. Turning it
 * into a decision is worth its own pure function for the reason
 * `connectionStatus.ts` is: it is the whole of what the store and the canvas
 * page branch on, and every case of it can be tested without a socket.
 *
 * Anything unrecognised is `'unknown'` on purpose. A reason can come from an
 * older deployment, from a Hocuspocus fallback (`permission-denied`), or from
 * the provider itself when it could not even ask — and none of those is a good
 * enough answer to sign the user out of the page or to throw away the copy of
 * their diagram cached in this browser. The connection simply stays down, which
 * is what it did before any of this existed.
 */
import { COLLAB_FORBIDDEN, COLLAB_UNAUTHORIZED } from '../../../shared/collabAuth';

/**
 * `'no-session'` — sign back in, without leaving the canvas.
 * `'no-access'` — this diagram is not yours to have; leave, and drop the cache.
 * `'unknown'` — say nothing; the indicator already reports the connection.
 */
export type CollabAuthFailure = 'no-session' | 'no-access' | 'unknown';

export function collabAuthFailure(reason: string): CollabAuthFailure {
  if (reason === COLLAB_UNAUTHORIZED) return 'no-session';
  if (reason === COLLAB_FORBIDDEN) return 'no-access';
  return 'unknown';
}
