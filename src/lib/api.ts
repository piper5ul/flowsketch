import type { DiagramMeta } from '../../shared/types';

const BASE = import.meta.env.VITE_API_URL || '';

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
    throw new Error(`API error: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  listDiagrams: () => request<DiagramMeta[]>('/api/diagrams'),

  createDiagram: (title?: string) =>
    request<{ id: string }>('/api/diagrams', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  getDiagram: (id: string) =>
    request<{ id: string; title: string; starred: boolean; data: { nodes: unknown[]; edges: unknown[] } }>(
      `/api/diagrams/${id}`,
    ),

  /**
   * `keepalive` lets the request outlive the page that started it, which is
   * what the autosave flush on `pagehide` needs — without it the browser
   * cancels the save as the tab goes away.
   */
  saveDiagram: (
    id: string,
    payload: { title?: string; data?: unknown; starred?: boolean },
    options?: { keepalive?: boolean },
  ) =>
    request(`/api/diagrams/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
      keepalive: options?.keepalive,
    }),

  deleteDiagram: (id: string) =>
    request(`/api/diagrams/${id}`, { method: 'DELETE' }),

  toggleStar: (id: string) =>
    request<{ starred: boolean }>(`/api/diagrams/${id}/star`, { method: 'PATCH' }),
};
