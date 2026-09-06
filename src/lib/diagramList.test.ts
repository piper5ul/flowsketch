import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filterDiagrams, loadDiagrams, sortDiagrams } from './diagramList';
import { api } from './api';
import { useToastStore } from '../store/useToastStore';
import type { DiagramMeta } from '../../shared/types';

vi.mock('./api', () => ({ api: { listDiagrams: vi.fn() } }));

const listDiagrams = vi.mocked(api.listDiagrams);

function meta(id: string, overrides: Partial<DiagramMeta> = {}): DiagramMeta {
  return {
    id,
    title: id,
    starred: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    thumbnail: null,
    role: 'owner',
    ...overrides,
  };
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

describe('filterDiagrams', () => {
  const diagrams = [meta('a', { title: 'Roadmap' }), meta('b', { title: 'Roadmap (copy)' }), meta('c', { title: 'Budget' })];

  it('returns everything for a blank query', () => {
    expect(filterDiagrams(diagrams, '')).toBe(diagrams);
    expect(filterDiagrams(diagrams, '   ')).toBe(diagrams);
  });

  it('matches titles case-insensitively, anywhere in the title', () => {
    expect(filterDiagrams(diagrams, 'ROADMAP').map((d) => d.id)).toEqual(['a', 'b']);
    expect(filterDiagrams(diagrams, 'copy').map((d) => d.id)).toEqual(['b']);
    expect(filterDiagrams(diagrams, 'dge').map((d) => d.id)).toEqual(['c']);
  });

  it('ignores the whitespace around a query', () => {
    expect(filterDiagrams(diagrams, '  budget ').map((d) => d.id)).toEqual(['c']);
  });

  it('matches nothing when nothing matches', () => {
    expect(filterDiagrams(diagrams, 'zzz')).toEqual([]);
  });
});

describe('sortDiagrams', () => {
  const older = '2026-01-01T00:00:00.000Z';
  const newer = '2026-06-01T00:00:00.000Z';

  it('orders by last edited, newest first', () => {
    const diagrams = [meta('old', { updatedAt: older }), meta('new', { updatedAt: newer })];
    expect(sortDiagrams(diagrams, 'updated').map((d) => d.id)).toEqual(['new', 'old']);
  });

  it('orders by creation date, newest first', () => {
    const diagrams = [
      meta('first', { createdAt: older, updatedAt: newer }),
      meta('second', { createdAt: newer, updatedAt: older }),
    ];
    expect(sortDiagrams(diagrams, 'created').map((d) => d.id)).toEqual(['second', 'first']);
  });

  it('orders by title without regard to case', () => {
    const diagrams = [meta('c', { title: 'cherry' }), meta('a', { title: 'Apple' }), meta('b', { title: 'banana' })];
    expect(sortDiagrams(diagrams, 'title').map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('pins starred diagrams first whatever the sort', () => {
    const diagrams = [
      meta('plain-new', { title: 'Aaa', updatedAt: newer }),
      meta('starred-old', { title: 'Zzz', updatedAt: older, starred: true }),
    ];
    for (const sort of ['updated', 'title', 'created'] as const) {
      expect(sortDiagrams(diagrams, sort)[0].id).toBe('starred-old');
    }
  });

  it('still sorts within the starred group', () => {
    const diagrams = [
      meta('starred-old', { updatedAt: older, starred: true }),
      meta('plain', { updatedAt: newer }),
      meta('starred-new', { updatedAt: newer, starred: true }),
    ];
    expect(sortDiagrams(diagrams, 'updated').map((d) => d.id)).toEqual(['starred-new', 'starred-old', 'plain']);
  });

  it('leaves the input array alone', () => {
    const diagrams = [meta('old', { updatedAt: older }), meta('new', { updatedAt: newer })];
    sortDiagrams(diagrams, 'updated');
    expect(diagrams.map((d) => d.id)).toEqual(['old', 'new']);
  });
});
