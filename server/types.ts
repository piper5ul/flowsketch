/**
 * Request typing for the Express API.
 *
 * `requireAuth` attaches the BetterAuth session to the request; this module is
 * what makes that visible to TypeScript. The types are inferred from the auth
 * instance itself (`auth.$Infer.Session`), so adding a field to the session in
 * `auth.ts` immediately types the request too.
 */
import type { Request } from 'express';
import type { auth } from './auth.js';

/** The signed-in user, exactly as BetterAuth models it. */
export type AuthUser = typeof auth.$Infer.Session.user;
/** The session row backing the request's cookie. */
export type AuthSession = typeof auth.$Infer.Session.session;

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. Optional: routes that skip the guard have none. */
      user?: AuthUser;
      /** Set by `requireAuth`, alongside `user`. */
      session?: AuthSession;
    }
  }
}

/**
 * The authenticated user of a request that has passed `requireAuth`.
 *
 * Every route that calls this sits behind the guard, so a missing user is a
 * wiring mistake, not a request the client can provoke — hence a throw (which
 * Express turns into a 500) rather than a 401 the caller could act on.
 */
export function authedUser(req: Request): AuthUser {
  if (!req.user) {
    throw new Error('authedUser() called on a request that did not pass requireAuth');
  }
  return req.user;
}
