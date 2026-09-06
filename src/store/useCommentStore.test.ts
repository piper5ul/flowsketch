import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommentStore } from './useCommentStore';
import { useToastStore } from './useToastStore';
import type { CommentThreadInfo } from '../../shared/types';

vi.mock('../lib/api', () => ({
  api: {
    listThreads: vi.fn(),
    createThread: vi.fn(),
    addComment: vi.fn(),
    setThreadResolved: vi.fn(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
    deleteThread: vi.fn(),
  },
}));

const { api } = await import('../lib/api');
const mocked = vi.mocked(api);

const store = () => useCommentStore.getState();

function thread(over: Partial<CommentThreadInfo> = {}): CommentThreadInfo {
  return {
    id: 't1',
    nodeId: 'n1',
    x: null,
    y: null,
    resolved: false,
    createdAt: '2026-09-01T10:00:00.000Z',
    createdBy: { id: 'u1', name: 'Ada' },
    comments: [
      {
        id: 'c1',
        body: 'Looks off',
        createdAt: '2026-09-01T10:00:00.000Z',
        editedAt: null,
        author: { id: 'u1', name: 'Ada' },
      },
    ],
    ...over,
  };
}

/** The messages the store put in front of the user this test. */
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.getState().clear();
  store().reset();
  mocked.listThreads.mockResolvedValue([]);
});

describe('load', () => {
  it('fetches every thread, not just the open ones the tab shows', async () => {
    mocked.listThreads.mockResolvedValue([thread()]);
    await store().load('d1');

    // `all`, because the badge and the canvas pins have to see resolved
    // threads the current filter is hiding.
    expect(mocked.listThreads).toHaveBeenCalledWith('d1', 'all');
    expect(store().threads).toHaveLength(1);
    expect(store().loaded).toBe(true);
  });

  it('drops the previous diagram’s conversation before loading another', async () => {
    mocked.listThreads.mockResolvedValue([thread()]);
    await store().load('d1');
    store().setActiveThread('t1');

    mocked.listThreads.mockResolvedValue([]);
    await store().load('d2');

    expect(store().diagramId).toBe('d2');
    expect(store().threads).toEqual([]);
    expect(store().activeThreadId).toBeNull();
  });

  it('collapses a thread that has gone since it was expanded', async () => {
    mocked.listThreads.mockResolvedValue([thread()]);
    await store().load('d1');
    store().setActiveThread('t1');

    mocked.listThreads.mockResolvedValue([]);
    await store().load('d1');

    expect(store().activeThreadId).toBeNull();
  });

  it('toasts and keeps the list it already had when the fetch fails', async () => {
    mocked.listThreads.mockResolvedValue([thread()]);
    await store().load('d1');

    mocked.listThreads.mockRejectedValue(new Error('offline'));
    await store().load('d1');

    expect(store().threads).toHaveLength(1);
    expect(toasts()).toEqual(['Could not load comments.']);
  });
});

describe('filter', () => {
  it('narrows what the panel shows without refetching', async () => {
    mocked.listThreads.mockResolvedValue([thread(), thread({ id: 't2', resolved: true })]);
    await store().load('d1');
    expect(mocked.listThreads).toHaveBeenCalledTimes(1);

    store().setFilter('resolved');

    expect(store().filter).toBe('resolved');
    expect(store().threads).toHaveLength(2);
    expect(mocked.listThreads).toHaveBeenCalledTimes(1);
  });

  it('collapses a thread the new tab does not show', async () => {
    mocked.listThreads.mockResolvedValue([thread()]);
    await store().load('d1');
    store().setActiveThread('t1');

    store().setFilter('resolved');

    expect(store().activeThreadId).toBeNull();
  });
});

describe('create', () => {
  it('posts the anchor and the first comment, then refetches', async () => {
    await store().load('d1');
    mocked.createThread.mockResolvedValue(thread());
    mocked.listThreads.mockResolvedValue([thread()]);

    const ok = await store().create({ nodeId: 'n1', body: 'Looks off' });

    expect(ok).toBe(true);
    expect(mocked.createThread).toHaveBeenCalledWith('d1', { nodeId: 'n1' }, 'Looks off');
    // Refetched rather than spliced in — one source of truth for the list.
    expect(mocked.listThreads).toHaveBeenCalledTimes(2);
    expect(store().threads).toHaveLength(1);
  });

  it('sends a positioned anchor as a bare point', async () => {
    await store().load('d1');
    mocked.createThread.mockResolvedValue(thread({ nodeId: null, x: 40, y: 90 }));

    await store().create({ x: 40, y: 90, body: 'Here' });

    expect(mocked.createThread).toHaveBeenCalledWith('d1', { x: 40, y: 90 }, 'Here');
  });

  it('opens the panel on the new thread and closes the composer', async () => {
    await store().load('d1');
    store().beginCompose({ nodeId: 'n1' });
    mocked.createThread.mockResolvedValue(thread());
    mocked.listThreads.mockResolvedValue([thread()]);

    await store().create({ nodeId: 'n1', body: 'Looks off' });

    expect(store().composing).toBeNull();
    expect(store().panelOpen).toBe(true);
    expect(store().activeThreadId).toBe('t1');
  });

  it('toasts and keeps the draft when the post fails', async () => {
    await store().load('d1');
    store().beginCompose({ nodeId: 'n1' });
    mocked.createThread.mockRejectedValue(new Error('boom'));

    const ok = await store().create({ nodeId: 'n1', body: 'Looks off' });

    expect(ok).toBe(false);
    expect(store().composing).toEqual({ nodeId: 'n1' });
    expect(toasts()).toEqual(['Could not post that comment.']);
  });
});

describe('reply', () => {
  it('posts to the thread and refetches', async () => {
    await store().load('d1');
    mocked.addComment.mockResolvedValue({
      id: 'c2',
      body: 'Fixed',
      createdAt: '2026-09-01T11:00:00.000Z',
      editedAt: null,
      author: { id: 'u2', name: 'Bo' },
    });

    expect(await store().reply('t1', 'Fixed')).toBe(true);
    expect(mocked.addComment).toHaveBeenCalledWith('d1', 't1', 'Fixed');
    expect(mocked.listThreads).toHaveBeenCalledTimes(2);
  });

  it('toasts on failure', async () => {
    await store().load('d1');
    mocked.addComment.mockRejectedValue(new Error('boom'));

    expect(await store().reply('t1', 'Fixed')).toBe(false);
    expect(toasts()).toEqual(['Could not post that reply.']);
  });
});

describe('setResolved', () => {
  it('resolves and reopens through the same route', async () => {
    await store().load('d1');
    mocked.setThreadResolved.mockResolvedValue(thread({ resolved: true }));

    await store().setResolved('t1', true);
    expect(mocked.setThreadResolved).toHaveBeenCalledWith('d1', 't1', true);

    await store().setResolved('t1', false);
    expect(mocked.setThreadResolved).toHaveBeenLastCalledWith('d1', 't1', false);
  });

  it('drops the resolved thread out of the open tab it was expanded in', async () => {
    mocked.listThreads.mockResolvedValue([thread()]);
    await store().load('d1');
    store().setActiveThread('t1');

    mocked.setThreadResolved.mockResolvedValue(thread({ resolved: true }));
    // Resolved threads are still fetched; the `open` filter is what hides them.
    mocked.listThreads.mockResolvedValue([thread({ resolved: true })]);
    await store().setResolved('t1', true);

    expect(store().threads[0].resolved).toBe(true);
  });

  it('names which way it failed', async () => {
    await store().load('d1');
    mocked.setThreadResolved.mockRejectedValue(new Error('403'));

    await store().setResolved('t1', true);
    await store().setResolved('t1', false);

    expect(toasts()).toEqual([
      'Could not resolve that thread.',
      'Could not reopen that thread.',
    ]);
  });
});

describe('edit and delete', () => {
  it('rewrites a comment and refetches', async () => {
    await store().load('d1');
    mocked.editComment.mockResolvedValue({
      id: 'c1',
      body: 'Looks fine',
      createdAt: '2026-09-01T10:00:00.000Z',
      editedAt: '2026-09-01T12:00:00.000Z',
      author: { id: 'u1', name: 'Ada' },
    });

    expect(await store().edit('t1', 'c1', 'Looks fine')).toBe(true);
    expect(mocked.editComment).toHaveBeenCalledWith('d1', 't1', 'c1', 'Looks fine');
    expect(mocked.listThreads).toHaveBeenCalledTimes(2);
  });

  it('refetches after deleting a comment, because the thread may have gone too', async () => {
    mocked.listThreads.mockResolvedValue([thread()]);
    await store().load('d1');
    store().setActiveThread('t1');
    mocked.deleteComment.mockResolvedValue(undefined);
    mocked.listThreads.mockResolvedValue([]);

    expect(await store().remove('t1', 'c1')).toBe(true);
    expect(store().threads).toEqual([]);
    expect(store().activeThreadId).toBeNull();
  });

  it('deletes a whole thread', async () => {
    await store().load('d1');
    mocked.deleteThread.mockResolvedValue(undefined);

    expect(await store().removeThread('t1')).toBe(true);
    expect(mocked.deleteThread).toHaveBeenCalledWith('d1', 't1');
  });

  it('toasts each failure', async () => {
    await store().load('d1');
    mocked.editComment.mockRejectedValue(new Error('403'));
    mocked.deleteComment.mockRejectedValue(new Error('403'));
    mocked.deleteThread.mockRejectedValue(new Error('403'));

    expect(await store().edit('t1', 'c1', 'x')).toBe(false);
    expect(await store().remove('t1', 'c1')).toBe(false);
    expect(await store().removeThread('t1')).toBe(false);

    expect(toasts()).toEqual([
      'Could not save that edit.',
      'Could not delete that comment.',
      'Could not delete that thread.',
    ]);
  });
});

describe('panel state', () => {
  it('opens on a given thread and closes any composer with it', () => {
    store().beginCompose({ x: 1, y: 2 });
    store().openPanel('t1');

    expect(store().panelOpen).toBe(true);
    expect(store().activeThreadId).toBe('t1');
    expect(store().composing).toBeNull();
  });

  it('keeps the expanded thread when reopened with no argument', () => {
    store().openPanel('t1');
    store().closePanel();
    store().openPanel();

    expect(store().activeThreadId).toBe('t1');
  });

  it('composing collapses whatever was expanded', () => {
    store().openPanel('t1');
    store().beginCompose({ nodeId: 'n1' });

    expect(store().activeThreadId).toBeNull();
    expect(store().composing).toEqual({ nodeId: 'n1' });
  });

  it('refuses a write before any diagram has been loaded', async () => {
    expect(await store().reply('t1', 'hi')).toBe(false);
    expect(mocked.addComment).not.toHaveBeenCalled();
  });
});
