/**
 * Health probes.
 *
 * `GET /api/health` is the liveness probe: it answers from the process alone,
 * so uptime checks and the e2e harness can tell "the server is up" apart from
 * "the database is down". `GET /api/health?deep=1` is the readiness probe and
 * does touch Postgres.
 */
import { Router } from 'express';
import { prisma } from './db.js';

export const healthRouter = Router();

healthRouter.get('/health', async (req, res) => {
  const deep = req.query.deep === '1' || req.query.deep === 'true';
  if (!deep) {
    res.json({ ok: true });
    return;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true });
  } catch (err) {
    // 503, not 500: the process is fine, its dependency is not, and a load
    // balancer or uptime check should read that as "not ready".
    console.error('Deep health check failed:', err);
    res.status(503).json({ ok: false, db: false });
  }
});
