import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth.js';
import { apiRouter } from './router.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: [
    process.env.BETTER_AUTH_URL || 'http://localhost:5199',
    'https://whimsical.vedalogy.com',
  ],
  credentials: true,
}));

// Liveness probe for uptime checks and the e2e harness. Deliberately DB-free.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.all('/api/auth/*splat', toNodeHandler(auth));

app.use('/api', express.json({ limit: '5mb' }));
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
