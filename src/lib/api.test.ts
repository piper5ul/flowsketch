import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, UnauthorizedError, api, setUnauthorizedHandler } from './api';

/** A `fetch` that answers every call with one response. */
function respondWith(status: number, body?: unknown) {
  const fetchMock = vi.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  setUnauthorizedHandler(null);
});

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

describe('a 401 answer', () => {
  it('rejects with a typed error rather than navigating away from unsaved work', async () => {
    respondWith(401, { error: 'Unauthorized' });
    await expect(api.listDiagrams()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('runs the installed handler instead of the default redirect', async () => {
    respondWith(401, { error: 'Unauthorized' });
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    await expect(api.listDiagrams()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stops running a handler that has been taken back off', async () => {
    respondWith(401, { error: 'Unauthorized' });
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await expect(api.listDiagrams()).rejects.toBeInstanceOf(UnauthorizedError);

    setUnauthorizedHandler(null);
    await expect(api.listDiagrams()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('a 409 answer', () => {
  it('rejects with the conflict and where the row actually is', async () => {
    const updatedAt = '2026-09-05T10:05:00.000Z';
    respondWith(409, { error: 'Conflict', updatedAt });

    const error = await api
      .saveDiagram('d1', { title: 'Mine', ifUnmodifiedSince: '2026-09-05T10:00:00.000Z' })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).updatedAt).toBe(updatedAt);
  });

  it('still rejects as a conflict when the body says nothing useful', async () => {
    respondWith(409, { error: 'Conflict' });
    const error = await api.saveDiagram('d1', { title: 'Mine' }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).updatedAt).toBe('');
  });
});

describe('other failures', () => {
  it('rejects with the status, untyped — nothing downstream special-cases them', async () => {
    respondWith(500, { error: 'Boom' });
    await expect(api.listDiagrams()).rejects.toThrow('API error: 500');
  });
});
