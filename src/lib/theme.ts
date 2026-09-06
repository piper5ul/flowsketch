import { getPreference, setPreference } from './preferences';

/**
 * The three states the theme control cycles through.
 *
 * `'system'` is not a fourth colour — it is the absence of a choice, and the
 * one the app ships with. It follows `prefers-color-scheme` for as long as the
 * user never says otherwise, including while they change it mid-session.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

/** What a preference resolves to once the OS has had its say. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const DEFAULT_THEME: ThemePreference = 'system';

/** The media query the `'system'` preference defers to. */
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The attribute an explicit choice is stamped on `<html>` as. */
export const THEME_ATTRIBUTE = 'data-theme';

/** The narrow slice of an element this module needs, so it can be faked in a test. */
interface AttributeHost {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * Forces `host` into the light theme and hands back the undo.
 *
 * Image and SVG exports go through this: a diagram is a document, not a
 * screenshot of an editor, so what leaves the app looks the same whichever
 * theme the person who exported it happens to be using. Pinning the attribute
 * — rather than passing a background colour — also catches the chrome that is
 * captured *with* the diagram, like a connector's label plate.
 *
 * The restore puts back exactly what was there, `'system'`'s absent attribute
 * included: writing `data-theme="light"` back over a system preference would
 * quietly pin the whole app to light on the first export.
 */
export function pinLightTheme(host: AttributeHost): () => void {
  const previous = host.getAttribute(THEME_ATTRIBUTE);
  host.setAttribute(THEME_ATTRIBUTE, 'light');
  return () => {
    if (previous === null) host.removeAttribute(THEME_ATTRIBUTE);
    else host.setAttribute(THEME_ATTRIBUTE, previous);
  };
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * The colour the app should be wearing.
 *
 * The whole decision, and the only part worth testing: an explicit preference
 * wins outright, and `'system'` hands the answer to the OS. Kept apart from the
 * DOM so it can be exercised without one — vitest runs in node.
 */
export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemDark ? 'dark' : 'light';
}

/** The next preference in the cycle: system → light → dark → system. */
export function nextTheme(preference: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCES.indexOf(preference);
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length];
}

/** The stored preference, or the default when nothing usable is stored. */
export function readThemePreference(): ThemePreference {
  const stored = getPreference<string>('theme', DEFAULT_THEME);
  // A value written by an older build — or by hand — is not a theme.
  return isThemePreference(stored) ? stored : DEFAULT_THEME;
}

export function writeThemePreference(preference: ThemePreference): void {
  setPreference('theme', preference);
}

/** True when the OS is currently asking for a dark interface. */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/**
 * Puts `preference` on the document.
 *
 * An explicit choice is stamped as `data-theme` on `<html>`, which the token
 * blocks in `index.css` key off. `'system'` **removes** the attribute rather
 * than writing the colour it currently resolves to — that is what leaves the
 * `prefers-color-scheme` media query in charge, so the app follows the OS live
 * without anything having to listen for it.
 *
 * Deliberately the only part of this module that touches the DOM, and the only
 * part left untested: everything it decides lives in `resolveTheme`.
 */
export function applyTheme(preference: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute(THEME_ATTRIBUTE);
  else root.setAttribute(THEME_ATTRIBUTE, preference);
}

/**
 * Calls `onChange` whenever the OS flips, and returns the unsubscribe.
 *
 * Only interesting while the preference is `'system'`, and even then only for
 * the parts of the app that have to *know* the resolved theme — the canvas
 * reads its dot colour from a variable, so the CSS alone is enough for it.
 */
export function watchSystemTheme(onChange: (systemDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(DARK_QUERY);
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
