/**
 * Rate limiters for the API.
 *
 * The instance is small and single-user today, so these are a brake on runaway
 * clients and casual abuse rather than a quota system: the budgets are far
 * above what the app's own autosave loop can spend. Counting is in-process
 * memory, which is enough for the single `whimsy.service` process; a second
 * process would need a shared store.
 */
import rateLimit, { type Options } from 'express-rate-limit';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/** General ceiling for `/api`. Autosave is one PUT per 2 s at its busiest. */
const API_LIMIT = 600;
/** Uploads are 10 MB each and hit the disk, so they get a tighter budget. */
const IMAGE_UPLOAD_LIMIT = 60;
/**
 * `/api/shared/*` is the only unauthenticated surface, so it gets a budget of
 * its own. Generous next to the upload one because opening a single shared
 * board spends one request for the diagram and another for every image it
 * draws — a handful of page loads must not exhaust it.
 */
const SHARED_LINK_LIMIT = 300;

/**
 * Only production is limited. Unit tests fire dozens of requests from one
 * address, and a local e2e loop against the dev server burns the 15-minute
 * budget in a couple of runs. Read at request time, not at import time, so a
 * test can build a limiter and exercise it under NODE_ENV=production.
 */
function skipOutsideProduction(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function limiter(limit: number, overrides: Partial<Options>) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' },
    skip: skipOutsideProduction,
    ...overrides,
  });
}

/** `600 / 15 min` per IP across `/api`. */
export function createApiLimiter(overrides: Partial<Options> = {}) {
  return limiter(API_LIMIT, overrides);
}

/** `60 / 15 min` per IP for `POST /api/images`, on top of the general limiter. */
export function createImageUploadLimiter(overrides: Partial<Options> = {}) {
  return limiter(IMAGE_UPLOAD_LIMIT, overrides);
}

/** `300 / 15 min` per IP for `/api/shared/*`, the routes that need no session. */
export function createSharedLinkLimiter(overrides: Partial<Options> = {}) {
  return limiter(SHARED_LINK_LIMIT, overrides);
}
