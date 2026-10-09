/**
 * JSON with object keys in a stable order. Objects are treated as immutable:
 * diagram values are replaced, rather than edited in place, when they change.
 *
 * `cacheKey` lets a caller cache a serialized projection (for example, a
 * React Flow node without its local selection fields) by the source object's
 * reference. When the input is another object, both references share the
 * resulting string. This is useful for Yjs values and their store counterpart.
 */
const canonicalJsonByReference = new WeakMap<object, string>();

function isObject(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

export function stableJson(value: unknown, cacheKey?: object): string | undefined {
  const valueKey = isObject(value) ? value : undefined;
  const cached = (cacheKey && canonicalJsonByReference.get(cacheKey)) ??
    (valueKey && canonicalJsonByReference.get(valueKey));
  if (cached !== undefined) {
    if (valueKey) canonicalJsonByReference.set(valueKey, cached);
    if (cacheKey) canonicalJsonByReference.set(cacheKey, cached);
    return cached;
  }

  const ordered = (item: unknown, key = ''): unknown => {
    if (isObject(item)) {
      const toJSON = (item as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === 'function') item = toJSON.call(item, key);
    }
    if (Array.isArray(item)) return item.map((entry, index) => ordered(entry, String(index)));
    if (item !== null && typeof item === 'object') {
      // Visit in JSON.stringify's property order so toJSON side effects retain
      // their usual order, then sort the resulting values for canonical output.
      const entries = Object.keys(item).map((propertyKey) => [
        propertyKey,
        ordered((item as Record<string, unknown>)[propertyKey], propertyKey),
      ] as const);
      return Object.fromEntries(
        entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
      );
    }
    return item;
  };
  const result = JSON.stringify(ordered(value));
  if (result !== undefined) {
    if (valueKey) canonicalJsonByReference.set(valueKey, result);
    if (cacheKey) canonicalJsonByReference.set(cacheKey, result);
  }
  return result;
}

/**
 * Canonicalize a projection of a source object, evaluating the projection only
 * when that source has not been canonicalized before.
 */
export function stableJsonFor(source: object, project: () => unknown): string | undefined {
  const cached = canonicalJsonByReference.get(source);
  if (cached !== undefined) return cached;
  return stableJson(project(), source);
}

/** Reuse a known canonical string when a store clone changes only local fields. */
export function reuseStableJson(source: object, target: object): boolean {
  const value = canonicalJsonByReference.get(source);
  if (value === undefined) return false;
  canonicalJsonByReference.set(target, value);
  return true;
}
