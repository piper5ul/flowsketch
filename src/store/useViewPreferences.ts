import { create } from 'zustand';
import { getPreference, setPreference } from '../lib/preferences';

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
  toggleMinimap: () => void;
  toggleGridSnap: () => void;
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

export const useViewPreferences = create<ViewPreferences>(() => ({
  minimap: getPreference('minimap', false),
  gridSnap: getPreference('gridSnap', false),
  toggleMinimap: toggle('minimap'),
  toggleGridSnap: toggle('gridSnap'),
}));
