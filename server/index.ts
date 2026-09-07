import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth.js';
import { apiRouter } from './router.js';
import { imagesRouter } from './images.js';
import { sharedRouter } from './sharing.js';
import { healthRouter } from './health.js';
import { createApiLimiter } from './rateLimit.js';
import { COLLAB_PATH, attachCollab } from './collab.js';
import { legacyHostRedirect, legacyHosts, publicOrigin, publicOrigins } from './origins.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Production sits behind a Cloudflare tunnel, so the socket address is always
// the tunnel's. Trust exactly one proxy hop, which makes `req.ip` the
// left-most X-Forwarded-For entry — the address the rate limiters count by.
app.set('trust proxy', 1);

// A hostname the site has moved away from (`LEGACY_HOSTS`) answers with a
// redirect to the current one — before the rate limiter, so a redirect is
// not a request counted against anyone.
app.use(legacyHostRedirect(legacyHosts(process.env), publicOrigin(process.env)));

app.use(cors({
  origin: publicOrigins(process.env),
  credentials: true,
}));

app.use('/api', createApiLimiter());

// `/api/health` (liveness, DB-free) and `/api/health?deep=1` (readiness).
app.use('/api', healthRouter);

app.all('/api/auth/*splat', toNodeHandler(auth));

// Diagram JSON stays at 5 MB. Image bodies are `image/*`, which express.json
// leaves alone; the images router applies its own, larger raw-body limit.
app.use('/api', express.json({ limit: '5mb' }));
app.use('/api/images', imagesRouter);
// Before `apiRouter`, which guards everything under it with `requireAuth`: a
// share token is the whole credential these routes need.
app.use('/api/shared', sharedRouter);
app.use('/api', apiRouter);

if (process.env.NODE_ENV === 'production') {
  // Resolve dist/ from the working directory, not this file: the compiled
  // server lives at dist-server/server/index.js, where '../dist' is wrong.
  const distPath = process.env.STATIC_DIR ?? path.resolve(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*splat', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// The HTTP server is built by hand rather than by `app.listen`, because the
// collaboration server needs the `upgrade` event — which only the `http.Server`
// has, and which `app.listen` creates and keeps to itself.
const server = http.createServer(app);
attachCollab(server);

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} (collab on ${COLLAB_PATH})`);
});
