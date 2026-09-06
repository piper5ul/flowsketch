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
 * Unit tests fire dozens of requests from one address; throttling them would
 * make the suite order-dependent. Read at request time, not at import time, so
 * a test can build a limiter and exercise it under another NODE_ENV.
 */
function skipInTests(): boolean {
  return process.env.NODE_ENV === 'test';
}

function limiter(limit: number, overrides: Partial<Options>) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' },
    skip: skipInTests,
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
