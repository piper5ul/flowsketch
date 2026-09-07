/**
 * View preferences: the small settings that belong to the person at this
 * browser rather than to the diagram — the minimap, grid snapping, the theme.
 * They are
 * deliberately *not* part of `DiagramData`, so opening the same board on
 * another machine does not drag someone else's chrome along with it.
 *
 * Every access is best-effort. Safari in private mode throws on the
 * `localStorage` property itself, a full store throws on write, and a value
 * written by an older build can be anything at all — none of which is worth
 * taking the canvas down for, so each path falls back to the caller's default.
 */

/** Namespaced so a value cannot collide with anything else on the origin. */
const PREFIX = 'flowsketch:';

export type PreferenceKey = 'minimap' | 'gridSnap' | 'theme' | 'commandRecents';

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    // Touching the property is itself what throws when storage is blocked,
    // which is why even the `typeof` guard sits inside the try.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The stored value for `key`, or `fallback` when there is not a usable one. */
export function getPreference<T>(key: PreferenceKey, fallback: T): T {
  try {
    const raw = storage()?.getItem(PREFIX + key);
    if (raw === null || raw === undefined) return fallback;
    const parsed: unknown = JSON.parse(raw);
    // A value of a different type is a leftover from a build that spelled this
    // preference differently, not something to hand back to the caller.
    return typeof parsed === typeof fallback ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Remembers `value` for the next visit. A store that refuses the write is not an error. */
export function setPreference<T>(key: PreferenceKey, value: T): void {
  try {
    storage()?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Nothing to do: the preference simply does not outlive this session.
  }
}
