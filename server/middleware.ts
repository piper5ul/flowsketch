import type { Request, Response, NextFunction } from 'express';
import { auth } from './auth.js';
import { fromNodeHeaders } from 'better-auth/node';
// Side-effect import: declares `user` and `session` on Express.Request.
import './types.js';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.session = session.session;
  req.user = session.user;
  next();
}
