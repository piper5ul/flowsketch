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
 * A `window` with just enough `matchMedia` for the theme to have an OS to
 * follow. Returns the recorded listeners so a test can drive an OS flip.
 */
function useSystemColorScheme(dark: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const query = {
    matches: dark,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
      void listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
      void listeners.delete(listener),
  };
  Object.defineProperty(globalThis, 'window', {
    value: { matchMedia: () => query },
    configurable: true,
  });
  return {
    flip(next: boolean) {
      query.matches = next;
      for (const listener of listeners) listener({ matches: next });
    },
  };
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
  Reflect.deleteProperty(globalThis, 'window');
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

describe('useViewPreferences theme', () => {
  it('follows the system until the user says otherwise', async () => {
    useSystemColorScheme(true);
    const store = await freshStore();
    expect(store.getState().theme).toBe('system');
    expect(store.getState().resolvedTheme).toBe('dark');
  });

  it('resolves "system" to light on a light machine', async () => {
    useSystemColorScheme(false);
    const store = await freshStore();
    expect(store.getState().resolvedTheme).toBe('light');
  });

  it('cycles system → light → dark → system', async () => {
    useSystemColorScheme(true);
    const store = await freshStore();

    store.getState().cycleTheme();
    expect(store.getState().theme).toBe('light');
    // An explicit choice outranks the dark machine underneath.
    expect(store.getState().resolvedTheme).toBe('light');

    store.getState().cycleTheme();
    expect(store.getState().theme).toBe('dark');

    store.getState().cycleTheme();
    expect(store.getState().theme).toBe('system');
    expect(store.getState().resolvedTheme).toBe('dark');
  });

  it('writes the choice through to storage as it changes', async () => {
    const written = memoryStorage();
    useStorage(written);
    const store = await freshStore();

    store.getState().setTheme('dark');
    expect(written.entries()['flowsketch:theme']).toBe('"dark"');
  });

  it('honours what a previous session chose', async () => {
    useStorage(memoryStorage({ 'flowsketch:theme': '"light"' }));
    useSystemColorScheme(true);
    const store = await freshStore();
    expect(store.getState().theme).toBe('light');
    expect(store.getState().resolvedTheme).toBe('light');
  });

  it('ignores a stored value that is not one of the three states', async () => {
    useStorage(memoryStorage({ 'flowsketch:theme': '"midnight"' }));
    const store = await freshStore();
    expect(store.getState().theme).toBe('system');
  });

  it('keeps up with the OS flipping while the preference is "system"', async () => {
    const system = useSystemColorScheme(false);
    const store = await freshStore();
    expect(store.getState().resolvedTheme).toBe('light');

    system.flip(true);
    expect(store.getState().resolvedTheme).toBe('dark');
  });

  it('ignores the OS flipping once a theme has been chosen', async () => {
    const system = useSystemColorScheme(false);
    const store = await freshStore();
    store.getState().setTheme('light');

    system.flip(true);
    expect(store.getState().resolvedTheme).toBe('light');
  });

  it('leaves the other preferences alone', async () => {
    const store = await freshStore();
    store.getState().setTheme('dark');
    expect(store.getState().minimap).toBe(false);
    expect(store.getState().gridSnap).toBe(false);
  });
});
