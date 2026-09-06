import type { DiagramData, DiagramMeta } from '../../shared/types';

const BASE = import.meta.env.VITE_API_URL || '';

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
      window.location.href = '/login';
      throw new Error('Unauthorized');
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
  getDiagram: (id: string) =>
    request<{ id: string; title: string; starred: boolean; data: unknown; updatedAt: string }>(
      `/api/diagrams/${id}`,
    ),

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
};
