import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createApiLimiter, createImageUploadLimiter } from './rateLimit.js';
import { serveForTest } from './testServer.js';

/**
 * A listening server for a one-route app behind `limiter`. A limiter counts,
 * so each case needs a fresh one — which is why the server is per test rather
 * than per file here; it is still one port per test instead of one per
 * request. See `testServer.ts`.
 */
async function serverWith(limiter: express.RequestHandler) {
  const app = express();
  app.use(limiter);
  app.get('/', (_req, res) => {
    res.json({ ok: true });
  });
  return serveForTest(app);
}

const nodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = nodeEnv;
});

describe('createApiLimiter', () => {
  // The limiters only count in production (see the suite below).
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  it('lets requests through up to the limit and 429s the next one', async () => {
    const server = await serverWith(createApiLimiter({ windowMs: 60_000, limit: 2 }));
    await request(server).get('/').expect(200);
    await request(server).get('/').expect(200);
    const res = await request(server).get('/').expect(429);
    expect(res.body).toEqual({ error: 'Too many requests' });
  });

  it('advertises the limit in standard headers, not legacy ones', async () => {
    const server = await serverWith(createApiLimiter({ windowMs: 60_000, limit: 2 }));
    const res = await request(server).get('/').expect(200);
    expect(Object.keys(res.headers).some((h) => h.startsWith('ratelimit'))).toBe(true);
    expect(res.headers).not.toHaveProperty('x-ratelimit-limit');
  });

  it('counts each limiter separately, so uploads do not spend the general budget', async () => {
    const general = await serverWith(createApiLimiter({ windowMs: 60_000, limit: 2 }));
    const uploads = await serverWith(createImageUploadLimiter({ windowMs: 60_000, limit: 2 }));
    await request(general).get('/').expect(200);
    await request(general).get('/').expect(200);
    await request(general).get('/').expect(429);
    await request(uploads).get('/').expect(200);
  });
});

describe('outside production', () => {
  it('does not limit anything, so dev servers and unit tests are unaffected', async () => {
    process.env.NODE_ENV = 'development';
    const server = await serverWith(createApiLimiter({ windowMs: 60_000, limit: 1 }));
    await request(server).get('/').expect(200);
    await request(server).get('/').expect(200);
    await request(server).get('/').expect(200);
  });
});
