/**
 * Sharing: public read-only links, and per-user invitations.
 *
 * Two routers, because they are guarded differently. `sharingRouter` is
 * mounted inside `apiRouter` and inherits its `requireAuth`; `sharedRouter` is
 * mounted on its own at `/api/shared` and has **no session at all** — a share
 * token is the whole credential, which is why it is 144 bits of
 * `crypto.randomBytes` and never derived from the diagram id.
 */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { prisma } from './db.js';
import { getDiagramAccess, requireDiagramRole } from './access.js';
import { sendImage } from './images.js';
import { imageIdsInDiagram } from './imageRefs.js';
import { createSharedLinkLimiter } from './rateLimit.js';
import { authedUser } from './types.js';
import { addMemberBody, validateBody, type AddMemberBody } from './validation.js';
import {
  sharedDiagramPath,
  type DiagramMemberInfo,
  type SharedDiagram,
} from '../shared/types.js';

/** Bytes of entropy behind a share link. 18 → 24 URL-safe characters. */
const SHARE_TOKEN_BYTES = 18;

/** An unguessable, URL-safe share token. */
export function createShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
}

export const sharingRouter = Router();
export const sharedRouter = Router();

// ---------------------------------------------------------------------------
// The public link (authenticated half)
// ---------------------------------------------------------------------------

/**
 * Turns the link on, or hands back the one that is already there. Idempotent
 * on purpose: a share dialog that opens twice must not invalidate the URL the
 * user already pasted somewhere.
 */
sharingRouter.post('/diagrams/:id/share', async (req, res) => {
  const access = await requireDiagramRole(req, res, 'owner', { id: true, shareToken: true });
  if (!access) return;

  let token = access.diagram.shareToken;
  if (!token) {
    token = createShareToken();
    await prisma.diagram.update({ where: { id: req.params.id }, data: { shareToken: token } });
  }
  res.json({ shareToken: token, url: sharedDiagramPath(token) });
});

/** Turns the link off. The next `POST` mints a different one, so the old URL stays dead. */
sharingRouter.delete('/diagrams/:id/share', async (req, res) => {
  const access = await requireDiagramRole(req, res, 'owner', { id: true });
  if (!access) return;
  await prisma.diagram.update({ where: { id: req.params.id }, data: { shareToken: null } });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

/**
 * Everyone with access, owner first. An editor may read it — they can already
 * see the diagram, and a share dialog that hides its collaborators is worse
 * than one that names them — but only the owner may change it.
 */
sharingRouter.get('/diagrams/:id/members', async (req, res) => {
  const access = await requireDiagramRole(req, res, 'editor', { id: true });
  if (!access) return;

  const diagram = await prisma.diagram.findUnique({
    where: { id: req.params.id },
    select: {
      user: { select: { id: true, name: true, email: true } },
      members: {
        select: { role: true, user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!diagram) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const members: DiagramMemberInfo[] = [
    { userId: diagram.user.id, name: diagram.user.name, email: diagram.user.email, role: 'owner' },
    ...diagram.members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role === 'editor' ? ('editor' as const) : ('viewer' as const),
    })),
  ];
  res.json(members);
});

/**
 * Invites an existing account, or changes the role of one already invited.
 *
 * There is no invitation-by-email flow yet: the address has to belong to an
 * account, and an unknown one is a 404 the dialog can show verbatim rather
 * than a row that would never be claimed.
 */
sharingRouter.post<{ id: string }, unknown, AddMemberBody>(
  '/diagrams/:id/members',
  validateBody(addMemberBody),
  async (req, res) => {
    const access = await requireDiagramRole(req, res, 'owner', { id: true, userId: true });
    if (!access) return;

    const { email, role } = req.body;
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true },
    });
    if (!user) {
      res.status(404).json({ error: 'No account with that email' });
      return;
    }
    if (user.id === access.diagram.userId) {
      res.status(400).json({ error: 'You already own this diagram' });
      return;
    }

    await prisma.diagramMember.upsert({
      where: { diagramId_userId: { diagramId: req.params.id, userId: user.id } },
      create: { diagramId: req.params.id, userId: user.id, role },
      update: { role },
    });

    const member: DiagramMemberInfo = { userId: user.id, name: user.name, email: user.email, role };
    res.status(201).json(member);
  },
);

/**
 * Removes a member — by the owner, or by that member leaving. `deleteMany` so
 * removing someone twice is the same 204 as removing them once.
 */
sharingRouter.delete('/diagrams/:id/members/:userId', async (req, res) => {
  const callerId = authedUser(req).id;
  const access = await getDiagramAccess(callerId, req.params.id, { id: true });
  if (!access) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (access.role !== 'owner' && req.params.userId !== callerId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  await prisma.diagramMember.deleteMany({
    where: { diagramId: req.params.id, userId: req.params.userId },
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// The public link (unauthenticated half) — mounted at /api/shared
// ---------------------------------------------------------------------------

// Anyone on the internet holding a token can spend these, so they get their
// own budget on top of the general `/api` limiter.
sharedRouter.use(createSharedLinkLimiter());

sharedRouter.get('/:token', async (req, res) => {
  const diagram = await prisma.diagram.findUnique({
    where: { shareToken: req.params.token },
    select: { id: true, title: true, data: true, updatedAt: true },
  });
  // A token that has been revoked is indistinguishable from one that never
  // existed, which is the whole point of revoking it.
  if (!diagram) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const shared: SharedDiagram = {
    id: diagram.id,
    title: diagram.title,
    data: diagram.data,
    updatedAt: diagram.updatedAt.toISOString(),
  };
  res.json(shared);
});

/**
 * An image a shared diagram draws. The token is the credential and the
 * diagram's own JSON is the allow-list, so a token cannot be used to walk the
 * owner's other uploads: an id the diagram does not reference is a 404.
 */
sharedRouter.get('/:token/images/:imageId', async (req, res) => {
  const diagram = await prisma.diagram.findUnique({
    where: { shareToken: req.params.token },
    select: { data: true },
  });
  if (!diagram || !imageIdsInDiagram(diagram.data).includes(req.params.imageId)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const image = await prisma.image.findUnique({ where: { id: req.params.imageId } });
  if (!image) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await sendImage(res, image);
});
