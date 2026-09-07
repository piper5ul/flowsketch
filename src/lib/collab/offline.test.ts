import { describe, expect, it } from 'vitest';
import { offlineDocKey } from './offline';

describe('offlineDocKey', () => {
  it('namespaces the diagram id', () => {
    // The origin is shared with everything else this browser stores for the
    // app, so the key says which app and which kind of thing it is.
    expect(offlineDocKey('d1')).toBe('flowsketch:diagram:d1');
  });

  it('gives every diagram a database of its own', () => {
    // One database per diagram is what makes dropping one diagram's cache
    // (`OfflineDoc.clear`, when access to it is revoked) leave the rest alone.
    expect(offlineDocKey('a')).not.toBe(offlineDocKey('b'));
  });
});
