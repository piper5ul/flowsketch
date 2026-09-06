import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDiagrams } from './diagramList';
import { api } from './api';
import { useToastStore } from '../store/useToastStore';

vi.mock('./api', () => ({ api: { listDiagrams: vi.fn() } }));

const listDiagrams = vi.mocked(api.listDiagrams);

function meta(id: string) {
  return { id, title: id, starred: false, updatedAt: '2026-01-01T00:00:00.000Z', thumbnail: null };
}

beforeEach(() => {
  vi.resetAllMocks();
  useToastStore.getState().clear();
});

describe('loadDiagrams', () => {
  it('returns the list the API handed back', async () => {
    listDiagrams.mockResolvedValue([meta('d1')]);
    const result = await loadDiagrams();
    expect(result).toEqual({ ok: true, diagrams: [meta('d1')] });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('reports a failure instead of rejecting, so the dashboard can leave "loading"', async () => {
    listDiagrams.mockRejectedValue(new Error('API error: 500'));
    await expect(loadDiagrams()).resolves.toEqual({ ok: false });
  });

  it('tells the user once when the list could not be fetched', async () => {
    listDiagrams.mockRejectedValue(new Error('API error: 500'));
    await loadDiagrams();
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ kind: 'error' });
  });
});
