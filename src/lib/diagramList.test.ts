import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyFolderSelection,
  countByFolder,
  filterDiagrams,
  loadDiagrams,
  loadFolders,
  sortDiagrams,
  splitByOwnership,
} from './diagramList';
import { api } from './api';
import { useToastStore } from '../store/useToastStore';
import type { DiagramMeta } from '../../shared/types';

vi.mock('./api', () => ({ api: { listDiagrams: vi.fn(), listFolders: vi.fn() } }));

const listDiagrams = vi.mocked(api.listDiagrams);
const listFolders = vi.mocked(api.listFolders);

function meta(id: string, overrides: Partial<DiagramMeta> = {}): DiagramMeta {
  return {
    id,
    title: id,
    starred: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    thumbnail: null,
    role: 'owner',
    folderId: null,
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

describe('splitByOwnership', () => {
  it('separates the user\'s own diagrams from the ones shared with them', () => {
    const mine = meta('mine');
    const asEditor = meta('e', { role: 'editor', ownerName: 'Ada' });
    const asViewer = meta('v', { role: 'viewer', ownerName: 'Grace' });

    expect(splitByOwnership([mine, asEditor, asViewer])).toEqual({
      owned: [mine],
      shared: [asEditor, asViewer],
    });
  });

  it('keeps the order the API sent within each section', () => {
    const list = [meta('a'), meta('b', { role: 'viewer' }), meta('c'), meta('d', { role: 'editor' })];
    const { owned, shared } = splitByOwnership(list);
    expect(owned.map((d) => d.id)).toEqual(['a', 'c']);
    expect(shared.map((d) => d.id)).toEqual(['b', 'd']);
  });

  it('gives both sections back empty for an empty list', () => {
    expect(splitByOwnership([])).toEqual({ owned: [], shared: [] });
  });
});

describe('loadFolders', () => {
  it('returns the folders the API handed back', async () => {
    const folders = [{ id: 'f1', name: 'Client work', createdAt: '2026-01-01T00:00:00.000Z', diagramCount: 2 }];
    listFolders.mockResolvedValue(folders);
    await expect(loadFolders()).resolves.toEqual(folders);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('falls back to no folders rather than rejecting: the grid still works without a sidebar', async () => {
    listFolders.mockRejectedValue(new Error('API error: 500'));
    await expect(loadFolders()).resolves.toEqual([]);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});

describe('applyFolderSelection', () => {
  const filed = meta('filed', { folderId: 'f1' });
  const elsewhere = meta('elsewhere', { folderId: 'f2' });
  const loose = meta('loose');
  const starred = meta('starred', { starred: true, folderId: 'f1' });
  const theirs = meta('theirs', { role: 'editor', ownerName: 'Ada' });
  const sections = { owned: [filed, elsewhere, loose, starred], shared: [theirs] };

  it('shows the whole dashboard for "all diagrams", shared section included', () => {
    expect(applyFolderSelection(sections, { kind: 'all' })).toEqual(sections);
  });

  it('narrows to one folder and drops the shared section', () => {
    const result = applyFolderSelection(sections, { kind: 'folder', id: 'f1' });
    expect(result.owned.map((d) => d.id)).toEqual(['filed', 'starred']);
    expect(result.shared).toEqual([]);
  });

  it('gives an empty owned list for a folder holding nothing', () => {
    expect(applyFolderSelection(sections, { kind: 'folder', id: 'empty' })).toEqual({ owned: [], shared: [] });
  });

  it('narrows to the starred diagrams, wherever they are filed', () => {
    const result = applyFolderSelection(sections, { kind: 'starred' });
    expect(result.owned.map((d) => d.id)).toEqual(['starred']);
    expect(result.shared).toEqual([]);
  });

  it('shows only the shared section for "shared with me"', () => {
    expect(applyFolderSelection(sections, { kind: 'shared' })).toEqual({ owned: [], shared: [theirs] });
  });

  it('never files somebody else\'s diagram into a folder', () => {
    // The server sends `folderId: null` on a shared diagram, so no selection
    // but "all" and "shared with me" can reach it.
    const result = applyFolderSelection(sections, { kind: 'folder', id: 'f1' });
    expect(result.owned).not.toContain(theirs);
  });
});

describe('countByFolder', () => {
  it('counts the diagrams in each folder', () => {
    const counts = countByFolder([
      meta('a', { folderId: 'f1' }),
      meta('b', { folderId: 'f1' }),
      meta('c', { folderId: 'f2' }),
      meta('d'),
    ]);
    expect(counts.get('f1')).toBe(2);
    expect(counts.get('f2')).toBe(1);
  });

  it('leaves a folder holding nothing out of the map', () => {
    expect(countByFolder([meta('a')]).has('f1')).toBe(false);
    expect(countByFolder([]).size).toBe(0);
  });
});
