import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  THEME_ATTRIBUTE,
  isThemePreference,
  nextTheme,
  pinLightTheme,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
} from './theme';

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

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('resolveTheme', () => {
  it('takes an explicit choice at its word, whatever the OS says', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
  });

  it('follows the OS while the preference is "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('nextTheme', () => {
  it('cycles system → light → dark → system', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });

  it('comes back where it started after three steps', () => {
    expect(nextTheme(nextTheme(nextTheme('system')))).toBe('system');
  });
});

describe('isThemePreference', () => {
  it('accepts the three states and nothing else', () => {
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('purple')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(1)).toBe(false);
  });
});

describe('readThemePreference', () => {
  it('defaults to following the system when nothing is stored', () => {
    useStorage(memoryStorage());
    expect(readThemePreference()).toBe('system');
    expect(DEFAULT_THEME).toBe('system');
  });

  it('reads back what was written', () => {
    useStorage(memoryStorage());
    writeThemePreference('dark');
    expect(readThemePreference()).toBe('dark');
  });

  it('stores the preference under its own namespaced key', () => {
    const store = memoryStorage();
    useStorage(store);
    writeThemePreference('light');
    expect(store.entries()).toEqual({ 'flowsketch:theme': '"light"' });
  });

  it('falls back to the default when the stored value is not a theme', () => {
    useStorage(memoryStorage({ 'flowsketch:theme': '"solarized"' }));
    expect(readThemePreference()).toBe('system');
  });

  it('falls back to the default when there is no storage at all', () => {
    expect(readThemePreference()).toBe('system');
  });
});

/** The slice of an element `pinLightTheme` touches, with the writes recorded. */
function fakeHost(initial: string | null = null) {
  let value = initial;
  return {
    getAttribute: () => value,
    setAttribute: (_name: string, next: string) => {
      value = next;
    },
    removeAttribute: () => {
      value = null;
    },
    get current() {
      return value;
    },
  };
}

describe('pinLightTheme', () => {
  it('forces the light theme for the duration of a capture', () => {
    const host = fakeHost('dark');
    pinLightTheme(host);
    expect(host.current).toBe('light');
  });

  it('puts an explicit preference back afterwards', () => {
    const host = fakeHost('dark');
    pinLightTheme(host)();
    expect(host.current).toBe('dark');
  });

  it('leaves a "system" preference unattributed rather than pinning it to light', () => {
    // The bug this guards: restoring by writing "light" back would silently
    // hard-code a system-following user to the light theme on first export.
    const host = fakeHost(null);
    pinLightTheme(host)();
    expect(host.current).toBeNull();
  });

  it('uses the same attribute applyTheme writes', () => {
    expect(THEME_ATTRIBUTE).toBe('data-theme');
  });
});
