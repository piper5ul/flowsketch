import { create } from 'zustand';
import { getPreference, setPreference } from '../lib/preferences';
import {
  applyTheme,
  nextTheme,
  readThemePreference,
  resolveTheme,
  systemPrefersDark,
  watchSystemTheme,
  writeThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from '../lib/theme';

/**
 * The canvas chrome the user can turn on and off. Kept out of `useDiagramStore`
 * on purpose: none of it is part of a diagram, so none of it should reach a
 * save, an export or the undo history.
 *
 * Each toggle is read once at module load and written straight back through
 * `setPreference`, so the state in memory and the one on disk cannot drift.
 */
interface ViewPreferences {
  /** The React Flow minimap, above the zoom controls. */
  minimap: boolean;
  /** Snap dragged and resized shapes to the canvas grid. */
  gridSnap: boolean;
  /** What the user asked for. `'system'` is the absence of a choice. */
  theme: ThemePreference;
  /** What that currently means — `theme` with the OS's answer folded in. */
  resolvedTheme: ResolvedTheme;
  toggleMinimap: () => void;
  toggleGridSnap: () => void;
  /** Advances the theme one step: system → light → dark → system. */
  cycleTheme: () => void;
  /** Sets the theme outright. Used by tests and by anything that knows the answer. */
  setTheme: (preference: ThemePreference) => void;
}

type Toggle = 'minimap' | 'gridSnap';

function toggle(key: Toggle) {
  return () =>
    useViewPreferences.setState((state) => {
      const next = !state[key];
      setPreference(key, next);
      return { [key]: next } as Pick<ViewPreferences, Toggle>;
    });
}

const initialTheme = readThemePreference();

export const useViewPreferences = create<ViewPreferences>((set, get) => ({
  minimap: getPreference('minimap', false),
  gridSnap: getPreference('gridSnap', false),
  theme: initialTheme,
  resolvedTheme: resolveTheme(initialTheme, systemPrefersDark()),
  toggleMinimap: toggle('minimap'),
  toggleGridSnap: toggle('gridSnap'),
  setTheme: (preference) => {
    writeThemePreference(preference);
    applyTheme(preference);
    set({ theme: preference, resolvedTheme: resolveTheme(preference, systemPrefersDark()) });
  },
  cycleTheme: () => get().setTheme(nextTheme(get().theme)),
}));

// The attribute has to match the preference from the first paint, not from the
// first toggle — a returning dark-mode user should never see a light frame.
applyTheme(initialTheme);

// `'system'` follows the OS live. The CSS does that on its own through the
// media query; this only keeps `resolvedTheme` honest for the code that has to
// know which way round we are (the toggle's icon, the minimap's mask).
watchSystemTheme((systemDark) => {
  useViewPreferences.setState((state) => ({
    resolvedTheme: resolveTheme(state.theme, systemDark),
  }));
});
