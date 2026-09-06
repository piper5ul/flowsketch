import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A `localStorage` stand-in — vitest runs in node, where there is none. */
function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    entries: () => Object.fromEntries(map),
  };
}

function useStorage(value: unknown) {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true });
}

/**
 * The store reads its preferences once, at module load, so a test that cares
 * about what was stored has to import it after installing the storage.
 */
async function freshStore() {
  vi.resetModules();
  return (await import('./useViewPreferences')).useViewPreferences;
}

beforeEach(() => {
  useStorage(memoryStorage());
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('useViewPreferences', () => {
  it('starts with both toggles off when nothing has been stored', async () => {
    const store = await freshStore();
    expect(store.getState().minimap).toBe(false);
    expect(store.getState().gridSnap).toBe(false);
  });

  it('honours what a previous session stored', async () => {
    useStorage(memoryStorage({ 'flowsketch:minimap': 'true', 'flowsketch:gridSnap': 'true' }));
    const store = await freshStore();
    expect(store.getState().minimap).toBe(true);
    expect(store.getState().gridSnap).toBe(true);
  });

  it('writes each toggle through to storage as it flips', async () => {
    const written = memoryStorage();
    useStorage(written);
    const store = await freshStore();

    store.getState().toggleMinimap();
    expect(store.getState().minimap).toBe(true);
    expect(written.entries()['flowsketch:minimap']).toBe('true');

    store.getState().toggleMinimap();
    expect(store.getState().minimap).toBe(false);
    expect(written.entries()['flowsketch:minimap']).toBe('false');
  });

  it('keeps the two toggles independent', async () => {
    const store = await freshStore();
    store.getState().toggleGridSnap();
    expect(store.getState().gridSnap).toBe(true);
    expect(store.getState().minimap).toBe(false);
  });

  it('still toggles when there is no storage to remember it in', async () => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    const store = await freshStore();
    expect(() => store.getState().toggleMinimap()).not.toThrow();
    expect(store.getState().minimap).toBe(true);
  });
});
