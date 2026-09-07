import type {
  CommentInfo,
  CommentThreadFilter,
  CommentThreadInfo,
  DiagramData,
  DiagramMemberInfo,
  DiagramMemberRole,
  DiagramMeta,
  DiagramRole,
  DiagramVersion,
  DiagramVersionMeta,
  FolderInfo,
  SharedDiagram,
} from '../../shared/types';

const BASE = import.meta.env.VITE_API_URL || '';

/**
 * The session behind a request has expired or was never there.
 *
 * Thrown rather than acted on, because what a 401 should *do* depends on what
 * the page is holding: the dashboard can bounce to the login form, but the
 * canvas has unsaved edits in memory that a navigation would throw away.
 */
export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

/**
 * `PUT /api/diagrams/:id` refused the write: the row has been saved by someone
 * else — in practice a second tab — since the version this client is holding.
 * `updatedAt` is where the row actually is now.
 */
export class ConflictError extends Error {
  readonly updatedAt: string;

  constructor(updatedAt: string) {
    super('Conflict');
    this.name = 'ConflictError';
    this.updatedAt = updatedAt;
  }
}

/** The dashboard's answer to a 401: nothing unsaved, so go and sign in again. */
function redirectToLogin() {
  if (typeof window !== 'undefined') window.location.href = '/login';
}

let onUnauthorized: () => void = redirectToLogin;

/**
 * Replaces what a 401 does *besides* rejecting. The canvas installs a no-op
 * while it is mounted so an expired session is renewed in place rather than
 * navigating away from edits that have not been saved yet; passing `null`
 * restores the redirect.
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler ?? redirectToLogin;
}

/** The 409 body the server sends; `updatedAt` is missing only if it changes shape. */
async function conflictUpdatedAt(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { updatedAt?: string };
    if (typeof body.updatedAt === 'string') return body.updatedAt;
  } catch {
    // A body that is not JSON tells us nothing more than the status did.
  }
  return '';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    if (res.status === 401) {
      onUnauthorized();
      throw new UnauthorizedError();
    }
    if (res.status === 409) throw new ConflictError(await conflictUpdatedAt(res));
    throw new Error(`API error: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  listDiagrams: () => request<DiagramMeta[]>('/api/diagrams'),

  /** `data` seeds an imported diagram; omitted, the server creates an empty one. */
  createDiagram: (title?: string, data?: DiagramData) =>
    request<{ id: string }>('/api/diagrams', {
      method: 'POST',
      body: JSON.stringify({ title, data }),
    }),

  // `data` is deliberately `unknown`: it is a free-form JSON column that may
  // hold any version the app has ever written. `migrateDiagramData` types it.
  // `role` says what this user may do with it; `shareToken` is only sent to
  // the owner, and is `null` when the public link is off.
  getDiagram: (id: string) =>
    request<{
      id: string;
      title: string;
      starred: boolean;
      data: unknown;
      updatedAt: string;
      role: DiagramRole;
      shareToken?: string | null;
    }>(`/api/diagrams/${id}`),

  /**
   * `keepalive` lets the request outlive the page that started it, which is
   * what the autosave flush on `pagehide` needs — without it the browser
   * cancels the save as the tab goes away.
   *
   * `ifUnmodifiedSince` is the `updatedAt` the caller is building on. Sent, a
   * row that has moved on rejects with `ConflictError` instead of being
   * overwritten; left out, the write always lands.
   */
  saveDiagram: (
    id: string,
    payload: {
      title?: string;
      data?: unknown;
      starred?: boolean;
      thumbnail?: string | null;
      ifUnmodifiedSince?: string;
    },
    options?: { keepalive?: boolean },
  ) =>
    request<{ updatedAt: string }>(`/api/diagrams/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
      keepalive: options?.keepalive,
    }),

  duplicateDiagram: (id: string) =>
    request<DiagramMeta>(`/api/diagrams/${id}/duplicate`, { method: 'POST' }),

  deleteDiagram: (id: string) =>
    request(`/api/diagrams/${id}`, { method: 'DELETE' }),

  toggleStar: (id: string) =>
    request<{ starred: boolean }>(`/api/diagrams/${id}/star`, { method: 'PATCH' }),

  /**
   * The caller's own folders, oldest first, each with its diagram count.
   * There is no shared half: a folder is one person's filing.
   */
  listFolders: () => request<FolderInfo[]>('/api/folders'),

  createFolder: (name: string) =>
    request<FolderInfo>('/api/folders', { method: 'POST', body: JSON.stringify({ name }) }),

  renameFolder: (id: string, name: string) =>
    request<FolderInfo>(`/api/folders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  /**
   * Removes a folder. The diagrams in it are **not** deleted — they come back
   * to the root of the dashboard — so the caller refreshes its list rather
   * than dropping the cards that were in it.
   */
  deleteFolder: (id: string) =>
    request(`/api/folders/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /**
   * Files a diagram into one of the caller's folders, or `null` to move it
   * back to the root. Owner-only, like the star: a folder is the owner's, so
   * an id belonging to somebody else rejects with `API error: 404`.
   */
  moveDiagramToFolder: (id: string, folderId: string | null) =>
    request<{ updatedAt: string }>(`/api/diagrams/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ folderId }),
    }),

  /**
   * Turns the public read-only link on, or returns the one already there —
   * calling it twice never invalidates a URL the user has handed out. `url` is
   * app-relative (`/s/<token>`); the caller pairs it with `location.origin`.
   */
  shareDiagram: (id: string) =>
    request<{ shareToken: string; url: string }>(`/api/diagrams/${id}/share`, { method: 'POST' }),

  /** Turns the public link off. A later `shareDiagram` mints a different one. */
  unshareDiagram: (id: string) =>
    request(`/api/diagrams/${id}/share`, { method: 'DELETE' }),

  /**
   * Reads a diagram through its share token. The only call here that needs no
   * session, so a 404 is the ordinary answer for a link that was revoked.
   */
  getSharedDiagram: (token: string) =>
    request<SharedDiagram>(`/api/shared/${encodeURIComponent(token)}`),

  /** Everyone with access, owner first. Readable by the owner and by editors. */
  listMembers: (id: string) =>
    request<DiagramMemberInfo[]>(`/api/diagrams/${id}/members`),

  /**
   * Invites an existing account, or changes the role of one already invited.
   * An address with no account behind it rejects with `API error: 404`.
   */
  addMember: (id: string, email: string, role: DiagramMemberRole) =>
    request<DiagramMemberInfo>(`/api/diagrams/${id}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),

  /** Removes a member. Allowed to the owner, and to that member themselves. */
  removeMember: (id: string, userId: string) =>
    request(`/api/diagrams/${id}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),

  /**
   * The diagram's history, newest first and without any bodies. Readable by
   * anyone who can read the diagram, viewers included.
   */
  listVersions: (id: string) =>
    request<DiagramVersionMeta[]>(`/api/diagrams/${id}/versions`),

  /** One version *with* its `data`, for previewing before restoring it. */
  getVersion: (id: string, versionId: string) =>
    request<DiagramVersion>(`/api/diagrams/${id}/versions/${encodeURIComponent(versionId)}`),

  /**
   * Snapshots the diagram as the server currently holds it — so flush any
   * pending autosave first, or the snapshot is of the last save rather than of
   * what is on screen. Editor+.
   */
  createVersion: (id: string, label?: string) =>
    request<DiagramVersionMeta>(`/api/diagrams/${id}/versions`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),

  /** A new diagram of your own holding exactly this version. Any role. */
  forkVersion: (id: string, versionId: string) =>
    request<{ id: string; title: string }>(`/api/diagrams/${id}/versions/${encodeURIComponent(versionId)}/fork`, { method: 'POST' }),

  /**
   * Puts a version back, after snapshotting what it replaces. Editor+.
   *
   * The returned `updatedAt` is the row's new timestamp: hand it to the
   * autosaver (`noteSaved`) or its next save will 409 against the write this
   * restore just made.
   */
  restoreVersion: (id: string, versionId: string) =>
    request<{ id: string; title: string; data: unknown; updatedAt: string }>(
      `/api/diagrams/${id}/versions/${encodeURIComponent(versionId)}/restore`,
      { method: 'POST' },
    ),

  /**
   * The diagram's comment threads, newest first, each with its whole
   * conversation nested — one request for the panel, not one per pin. Readable
   * by anyone who can read the diagram, viewers included; `filter` defaults to
   * the open threads, which is what the canvas draws.
   */
  listThreads: (id: string, filter: CommentThreadFilter = 'open') =>
    request<CommentThreadInfo[]>(`/api/diagrams/${id}/threads?resolved=${filter}`),

  /**
   * Starts a thread, pinned either to a shape (`nodeId`) or to a point on the
   * canvas (`x`+`y`) — the server refuses both and neither. The returned thread
   * already carries the comment that started it. Viewer+: a reviewer who cannot
   * write anything down is not reviewing.
   */
  createThread: (
    id: string,
    anchor: { nodeId: string } | { x: number; y: number },
    body: string,
  ) =>
    request<CommentThreadInfo>(`/api/diagrams/${id}/threads`, {
      method: 'POST',
      body: JSON.stringify({ ...anchor, body }),
    }),

  /** Replies to a thread. Viewer+, like starting one. */
  addComment: (id: string, threadId: string, body: string) =>
    request<CommentInfo>(
      `/api/diagrams/${id}/threads/${encodeURIComponent(threadId)}/comments`,
      { method: 'POST', body: JSON.stringify({ body }) },
    ),

  /** Resolves a thread or reopens it. Editor+, or whoever opened it. */
  setThreadResolved: (id: string, threadId: string, resolved: boolean) =>
    request<CommentThreadInfo>(`/api/diagrams/${id}/threads/${encodeURIComponent(threadId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolved }),
    }),

  /** Rewrites a comment. The author alone; the response carries `editedAt`. */
  editComment: (id: string, threadId: string, commentId: string, body: string) =>
    request<CommentInfo>(
      `/api/diagrams/${id}/threads/${encodeURIComponent(threadId)}/comments/${encodeURIComponent(commentId)}`,
      { method: 'PATCH', body: JSON.stringify({ body }) },
    ),

  /**
   * Removes a comment — the author, the thread's opener, or the diagram's
   * owner. Deleting the last comment in a thread deletes the thread too, so
   * refetch rather than assuming the pin is still there.
   */
  deleteComment: (id: string, threadId: string, commentId: string) =>
    request(
      `/api/diagrams/${id}/threads/${encodeURIComponent(threadId)}/comments/${encodeURIComponent(commentId)}`,
      { method: 'DELETE' },
    ),

  /** Removes a whole thread, comments and all. The owner, or whoever opened it. */
  deleteThread: (id: string, threadId: string) =>
    request(`/api/diagrams/${id}/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' }),
};
