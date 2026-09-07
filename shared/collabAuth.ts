/**
 * Why the collaboration server refused a socket — the one string both ends
 * agree on.
 *
 * Hocuspocus answers a rejected `onAuthenticate` with a permission-denied
 * message carrying the `reason` off the thrown error, falling back to a
 * `permission-denied` that says nothing. The browser has two very different
 * things to do about a refusal, though: a session that has expired is worth
 * offering the re-auth dialog for, while being removed from a diagram means
 * leaving it — and dropping the copy this browser has cached offline, which
 * nothing is ever going to sync again. So the server names the two.
 *
 * `src/lib/collab/authFailure.ts` is the browser's half; the strings live here
 * because the server writes them and the client reads them.
 */

/** No session at all: the cookie is gone or expired. The HTTP `401`. */
export const COLLAB_UNAUTHORIZED = 'unauthorized';

/**
 * A session, but no business with this diagram: removed, or it is deleted.
 * The `403` and the `404`, which are deliberately the same answer here for the
 * reason they are over HTTP — a diagram you cannot see stays indistinguishable
 * from one that is not there.
 */
export const COLLAB_FORBIDDEN = 'forbidden';
