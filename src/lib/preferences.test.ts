import { afterEach, describe, expect, it } from 'vitest';
import { getPreference, setPreference } from './preferences';

/**
 * Vitest runs in the node environment, where there is no `localStorage` at all —
 * which is also the first case the module has to survive. Every test installs
 * the storage it wants to exercise.
 */
function useStorage(value: unknown) {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true });
}

function useThrowingStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    get() {
      throw new Error('The operation is insecure.');
    },
    configurable: true,
  });
}

/** A `localStorage` stand-in whose contents the test can read back. */
function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    entries: () => Object.fromEntries(map),
  };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('getPreference', () => {
  it('returns the default when there is no storage', () => {
    expect(getPreference('minimap', false)).toBe(false);
    expect(getPreference('gridSnap', true)).toBe(true);
  });

  it('reads back what setPreference wrote', () => {
    useStorage(memoryStorage());
    setPreference('minimap', true);
    expect(getPreference('minimap', false)).toBe(true);
  });

  it('namespaces its keys so it cannot collide with another app on the origin', () => {
    const store = memoryStorage();
    useStorage(store);
    setPreference('gridSnap', true);
    expect(store.entries()).toEqual({ 'flowsketch:gridSnap': 'true' });
  });

  it('falls back when the stored value is not the type the caller asked for', () => {
    useStorage(memoryStorage({ 'flowsketch:minimap': '"yes"' }));
    expect(getPreference('minimap', false)).toBe(false);
  });

  it('falls back when the stored value is not JSON at all', () => {
    useStorage(memoryStorage({ 'flowsketch:minimap': 'undefined' }));
    expect(getPreference('minimap', false)).toBe(false);
  });

  it('falls back when reading the store throws', () => {
    useThrowingStorage();
    expect(getPreference('minimap', true)).toBe(true);
  });

  it('falls back when getItem itself throws', () => {
    useStorage({
      getItem: () => {
        throw new Error('nope');
      },
    });
    expect(getPreference('minimap', false)).toBe(false);
  });
});

describe('setPreference', () => {
  it('does not throw when there is no storage', () => {
    expect(() => setPreference('minimap', true)).not.toThrow();
  });

  it('does not throw when the store refuses the write', () => {
    useStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => setPreference('minimap', true)).not.toThrow();
  });

  it('does not throw when reaching the store throws', () => {
    useThrowingStorage();
    expect(() => setPreference('gridSnap', true)).not.toThrow();
  });
});
