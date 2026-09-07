import type { RequestHandler } from 'express';

/**
 * Where the app is reached from, and the names it has stopped using.
 *
 * `BETTER_AUTH_URL` is the one public origin: BetterAuth checks it as the
 * trusted origin for sign-in and the CORS layer allows it. Nothing else is
 * hard-coded, so moving the site to a new hostname is a change to `.env` and
 * not to the code. Outside production the Vite dev server's origins are
 * trusted too, so local sign-in works whatever the public URL is set to.
 */
export const DEV_ORIGIN = 'http://localhost:5199';

export function publicOrigin(env: NodeJS.ProcessEnv): string {
  return (env.BETTER_AUTH_URL || DEV_ORIGIN).replace(/\/+$/, '');
}

export function publicOrigins(env: NodeJS.ProcessEnv): string[] {
  const origins = [publicOrigin(env)];
  if (env.NODE_ENV !== 'production') {
    for (const dev of [DEV_ORIGIN, 'http://127.0.0.1:5199']) {
      if (!origins.includes(dev)) origins.push(dev);
    }
  }
  return origins;
}

/**
 * `LEGACY_HOSTS` — a comma-separated list of hostnames the site used to
 * answer on. A request that arrives for one of them is redirected, with its
 * path and query intact, to the public origin: an old bookmark or a shared
 * link keeps working, and it lands on the origin whose cookie the session
 * is scoped to rather than on a name where sign-in would be refused.
 */
export function legacyHosts(env: NodeJS.ProcessEnv): string[] {
  return (env.LEGACY_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function legacyHostRedirect(hosts: string[], target: string): RequestHandler {
  const retired = new Set(hosts);
  const origin = target.replace(/\/+$/, '');
  return (req, res, next) => {
    if (retired.size > 0 && retired.has(req.hostname.toLowerCase())) {
      res.redirect(301, origin + req.originalUrl);
      return;
    }
    next();
  };
}
