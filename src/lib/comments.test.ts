import { describe, expect, it } from 'vitest';
import {
  anchorLabel,
  canDeleteComment,
  canDeleteThread,
  canEditComment,
  canResolveThread,
  openThreadCount,
  pinPosition,
  threadNumbers,
  visibleThreads,
} from './comments';
import type { CommentInfo, CommentThreadInfo } from '../../shared/types';

function comment(over: Partial<CommentInfo> = {}): CommentInfo {
  return {
    id: 'c1',
    body: 'Looks off',
    createdAt: '2026-09-01T10:00:00.000Z',
    editedAt: null,
    author: { id: 'u1', name: 'Ada' },
    ...over,
  };
}

function thread(over: Partial<CommentThreadInfo> = {}): CommentThreadInfo {
  return {
    id: 't1',
    nodeId: null,
    x: 10,
    y: 20,
    resolved: false,
    createdAt: '2026-09-01T10:00:00.000Z',
    createdBy: { id: 'u1', name: 'Ada' },
    comments: [comment()],
    ...over,
  };
}

describe('visibleThreads', () => {
  const open = thread({ id: 'open' });
  const done = thread({ id: 'done', resolved: true });

  it('shows only open threads under the open filter', () => {
    expect(visibleThreads([open, done], 'open')).toEqual([open]);
  });

  it('shows only resolved threads under the resolved filter', () => {
    expect(visibleThreads([open, done], 'resolved')).toEqual([done]);
  });

  it('shows everything under the all filter, in the order given', () => {
    expect(visibleThreads([open, done], 'all')).toEqual([open, done]);
  });
});

describe('openThreadCount', () => {
  it('counts the unresolved threads only', () => {
    expect(openThreadCount([thread({ id: 'a' }), thread({ id: 'b', resolved: true })])).toBe(1);
  });

  it('is zero for an empty board', () => {
    expect(openThreadCount([])).toBe(0);
  });
});

describe('threadNumbers', () => {
  it('numbers oldest first, whatever order the list arrives in', () => {
    const older = thread({ id: 'older', createdAt: '2026-09-01T10:00:00.000Z' });
    const newer = thread({ id: 'newer', createdAt: '2026-09-02T10:00:00.000Z' });
    // The API answers newest first; the numbering must not follow it.
    const numbers = threadNumbers([newer, older]);
    expect(numbers.get('older')).toBe(1);
    expect(numbers.get('newer')).toBe(2);
  });

  it('keeps a thread on its number when a newer one appears', () => {
    const first = thread({ id: 'first', createdAt: '2026-09-01T10:00:00.000Z' });
    const second = thread({ id: 'second', createdAt: '2026-09-03T10:00:00.000Z' });
    expect(threadNumbers([first]).get('first')).toBe(1);
    expect(threadNumbers([second, first]).get('first')).toBe(1);
  });

  it('breaks a same-millisecond tie by id, the way the server does', () => {
    const a = thread({ id: 'a', createdAt: '2026-09-01T10:00:00.000Z' });
    const b = thread({ id: 'b', createdAt: '2026-09-01T10:00:00.000Z' });
    expect(threadNumbers([b, a]).get('a')).toBe(1);
  });
});

describe('anchorLabel', () => {
  const nodes = [
    { id: 'n1', data: { label: '  Checkout  ' } },
    { id: 'n2', data: {} },
  ];

  it('names a positioned thread after the canvas', () => {
    expect(anchorLabel(thread(), nodes)).toBe('Canvas');
  });

  it('uses the shape’s trimmed label', () => {
    expect(anchorLabel(thread({ nodeId: 'n1' }), nodes)).toBe('Checkout');
  });

  it('falls back to a generic name for an unlabelled shape', () => {
    expect(anchorLabel(thread({ nodeId: 'n2' }), nodes)).toBe('Shape');
  });

  it('says so when the shape has been deleted out from under the pin', () => {
    expect(anchorLabel(thread({ nodeId: 'gone' }), nodes)).toBe('Deleted shape');
  });
});

describe('permissions', () => {
  const opened = thread({ createdBy: { id: 'author', name: 'Ada' } });
  const mine = comment({ author: { id: 'me', name: 'Me' } });
  const theirs = comment({ id: 'c2', author: { id: 'other', name: 'Other' } });

  it('lets an editor resolve somebody else’s thread', () => {
    expect(canResolveThread(opened, 'editor', 'me')).toBe(true);
  });

  it('lets a viewer resolve only the thread they opened', () => {
    expect(canResolveThread(opened, 'viewer', 'me')).toBe(false);
    expect(canResolveThread(opened, 'viewer', 'author')).toBe(true);
  });

  it('lets only the author rewrite a comment', () => {
    expect(canEditComment(mine, 'me')).toBe(true);
    expect(canEditComment(theirs, 'me')).toBe(false);
  });

  it('lets the author, the thread’s opener and the owner delete a comment', () => {
    expect(canDeleteComment(theirs, opened, 'viewer', 'other')).toBe(true);
    expect(canDeleteComment(theirs, opened, 'viewer', 'author')).toBe(true);
    expect(canDeleteComment(theirs, opened, 'owner', 'nobody')).toBe(true);
    expect(canDeleteComment(theirs, opened, 'editor', 'me')).toBe(false);
  });

  it('lets the owner or the opener delete a whole thread', () => {
    expect(canDeleteThread(opened, 'owner', 'me')).toBe(true);
    expect(canDeleteThread(opened, 'viewer', 'author')).toBe(true);
    expect(canDeleteThread(opened, 'editor', 'me')).toBe(false);
  });

  it('grants nothing personal to a reader with no session yet', () => {
    expect(canEditComment(mine, null)).toBe(false);
    expect(canDeleteComment(mine, opened, 'viewer', null)).toBe(false);
    expect(canDeleteThread(opened, 'viewer', null)).toBe(false);
  });
});

describe('pinPosition', () => {
  const frame = { id: 'frame', position: { x: 60, y: 60 }, width: 900 };
  const child = { id: 'child', parentId: 'frame', position: { x: 300, y: 70 }, width: 190 };
  const loose = { id: 'loose', position: { x: 1000, y: 200 }, width: 130 };
  const nodes = [frame, child, loose];

  it('draws a free-floating thread where it was placed', () => {
    expect(pinPosition(thread({ nodeId: null, x: 10, y: 20 }), nodes)).toEqual({ x: 10, y: 20 });
    expect(pinPosition(thread({ nodeId: null, x: null, y: null }), nodes)).toBeNull();
  });

  it('draws an anchored thread at the top-right corner of its shape', () => {
    expect(pinPosition(thread({ nodeId: 'loose' }), nodes)).toEqual({ x: 1130, y: 200 });
  });

  it('folds in the frame offset for a shape inside a frame', () => {
    expect(pinPosition(thread({ nodeId: 'child' }), nodes)).toEqual({ x: 60 + 300 + 190, y: 60 + 70 });
  });

  it('falls back to the measured width and draws nothing for a deleted shape', () => {
    const measured = [{ id: 'm', position: { x: 5, y: 5 }, measured: { width: 40 } }];
    expect(pinPosition(thread({ nodeId: 'm' }), measured)).toEqual({ x: 45, y: 5 });
    expect(pinPosition(thread({ nodeId: 'gone' }), nodes)).toBeNull();
  });
});
