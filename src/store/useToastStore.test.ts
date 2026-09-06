import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from './useToastStore';

const store = () => useToastStore.getState();

beforeEach(() => {
  vi.useFakeTimers();
  store().clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('push', () => {
  it('appends a toast with its kind and message', () => {
    store().push('error', 'Save failed');
    expect(store().toasts).toMatchObject([{ kind: 'error', message: 'Save failed' }]);
  });

  it('gives every toast a distinct id and keeps them in order', () => {
    store().push('info', 'first');
    store().push('error', 'second');
    const [a, b] = store().toasts;
    expect(a.id).not.toBe(b.id);
    expect(store().toasts.map((t) => t.message)).toEqual(['first', 'second']);
  });

  it('returns the id of the toast it created', () => {
    const id = store().push('info', 'hello');
    expect(store().toasts[0].id).toBe(id);
  });
});

describe('expiry', () => {
  it('drops a toast once its default ttl elapses', () => {
    store().push('info', 'transient');
    vi.advanceTimersByTime(4999);
    expect(store().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store().toasts).toHaveLength(0);
  });

  it('honours an explicit ttl', () => {
    store().push('info', 'quick', { ttlMs: 100 });
    vi.advanceTimersByTime(100);
    expect(store().toasts).toHaveLength(0);
  });

  it('keeps a toast forever when the ttl is not positive', () => {
    store().push('error', 'sticky', { ttlMs: 0 });
    vi.advanceTimersByTime(60_000);
    expect(store().toasts).toHaveLength(1);
  });

  it('expires each toast on its own clock', () => {
    store().push('info', 'short', { ttlMs: 100 });
    store().push('info', 'long', { ttlMs: 1000 });
    vi.advanceTimersByTime(100);
    expect(store().toasts.map((t) => t.message)).toEqual(['long']);
    vi.advanceTimersByTime(900);
    expect(store().toasts).toHaveLength(0);
  });
});

describe('dismiss', () => {
  it('removes only the named toast', () => {
    const first = store().push('info', 'first');
    store().push('info', 'second');
    store().dismiss(first);
    expect(store().toasts.map((t) => t.message)).toEqual(['second']);
  });

  it('is a no-op for an id that is already gone', () => {
    const id = store().push('info', 'gone');
    store().dismiss(id);
    store().dismiss(id);
    expect(store().toasts).toHaveLength(0);
  });

  it('cancels the pending expiry, so a later toast reusing the slot survives', () => {
    const id = store().push('info', 'dismissed early', { ttlMs: 1000 });
    store().dismiss(id);
    store().push('info', 'still here', { ttlMs: 5000 });
    vi.advanceTimersByTime(1000);
    expect(store().toasts.map((t) => t.message)).toEqual(['still here']);
  });
});
