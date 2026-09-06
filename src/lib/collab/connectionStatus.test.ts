import { describe, expect, it } from 'vitest';
import { connectionDisplay } from './connectionStatus';
import type { PresenceStatus } from './presence';

describe('connectionDisplay', () => {
  it('reads the three states the provider can be in', () => {
    expect(connectionDisplay('connected')).toEqual({ label: 'Live', tone: 'live' });
    expect(connectionDisplay('connecting')).toEqual({
      label: 'Reconnecting…',
      tone: 'reconnecting',
    });
    expect(connectionDisplay('disconnected')).toEqual({
      label: 'Offline — changes will sync when you’re back',
      tone: 'offline',
    });
  });

  it('says what happens next when the connection is gone, rather than only that it is', () => {
    // A CRDT really does keep the edits made offline and merge them on the way
    // back, so this is a promise the document can keep — and the difference
    // between a warning and a reason to reload and lose the work.
    expect(connectionDisplay('disconnected').label).toContain('sync when you');
  });

  it('answers for every status, so a new one cannot leave the bar blank', () => {
    const statuses: PresenceStatus[] = ['connecting', 'connected', 'disconnected'];
    for (const status of statuses) {
      expect(connectionDisplay(status).label).not.toBe('');
    }
  });
});
