import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CURSOR_INTERVAL_MS,
  PEER_COLORS,
  collabUrl,
  peerColor,
  peersFrom,
  presenceDocumentName,
  selectionOwners,
  throttle,
  type PresenceState,
} from './presence';

function state(overrides: Partial<PresenceState> = {}): PresenceState {
  return {
    userId: 'u1',
    name: 'User One',
    color: '#2563EB',
    cursor: { x: 10, y: 20 },
    selection: [],
    ...overrides,
  };
}

describe('peerColor', () => {
  it('gives the same user the same colour every time', () => {
    expect(peerColor('user-abc')).toBe(peerColor('user-abc'));
  });

  it('only ever returns a colour from the palette', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(PEER_COLORS).toContain(peerColor(`user-${i}`));
    }
  });

  it('spreads users across the whole palette', () => {
    const used = new Set(Array.from({ length: 200 }, (_, i) => peerColor(`user-${i}`)));
    expect(used.size).toBe(PEER_COLORS.length);
  });

  it('separates ids that differ only in their last character', () => {
    // The failure this guards is a hash that ignores position or overflows to a
    // constant: sequential ids are exactly what a room of collaborators has.
    const colors = ['a', 'b', 'c', 'd'].map((suffix) => peerColor(`user-${suffix}`));
    expect(new Set(colors).size).toBeGreaterThan(1);
  });

  it('has a colour for the empty id rather than undefined', () => {
    expect(PEER_COLORS).toContain(peerColor(''));
  });
});

describe('presenceDocumentName', () => {
  it('names the document the server parses', () => {
    expect(presenceDocumentName('d1')).toBe('diagram:d1');
  });
});

describe('collabUrl', () => {
  it('opens an insecure socket from an insecure page', () => {
    expect(collabUrl('http://localhost:5199')).toBe('ws://localhost:5199/collab');
  });

  it('opens a secure socket from a secure page, or it would be blocked', () => {
    expect(collabUrl('https://whimsical.example.com')).toBe('wss://whimsical.example.com/collab');
  });

  it('ignores any path the origin came with', () => {
    expect(collabUrl('http://localhost:5199/d/abc')).toBe('ws://localhost:5199/collab');
  });
});

describe('peersFrom', () => {
  it('leaves this client out', () => {
    const states = new Map<number, unknown>([
      [1, state({ userId: 'me' })],
      [2, state({ userId: 'them' })],
    ]);
    expect(peersFrom(states, 1).map((peer) => peer.userId)).toEqual(['them']);
  });

  it('carries the client id alongside the state', () => {
    const states = new Map<number, unknown>([[7, state({ userId: 'them' })]]);
    expect(peersFrom(states, 1)).toEqual([{ ...state({ userId: 'them' }), clientId: 7 }]);
  });

  it('orders by client id, not by arrival', () => {
    const states = new Map<number, unknown>([
      [9, state({ userId: 'c' })],
      [3, state({ userId: 'a' })],
      [5, state({ userId: 'b' })],
    ]);
    expect(peersFrom(states, 1).map((peer) => peer.userId)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a peer whose pointer has left the canvas', () => {
    const states = new Map<number, unknown>([[2, state({ cursor: null })]]);
    expect(peersFrom(states, 1)).toHaveLength(1);
  });

  it('drops states it does not recognise rather than rendering them', () => {
    // Another browser writes these, and it may be running a different build.
    const states = new Map<number, unknown>([
      [2, null],
      [3, {}],
      [4, 'nonsense'],
      [5, { ...state(), selection: 'n1' }],
      [6, { ...state(), cursor: { x: 1 } }],
      [7, { ...state(), name: 42 }],
      [8, state({ userId: 'good' })],
    ]);
    expect(peersFrom(states, 1).map((peer) => peer.userId)).toEqual(['good']);
  });

  it('is empty when nobody else is here', () => {
    expect(peersFrom(new Map([[1, state()]]), 1)).toEqual([]);
  });
});

describe('selectionOwners', () => {
  it('indexes each selected node by the peer holding it', () => {
    const ada = { ...state({ userId: 'ada', selection: ['n1', 'n2'] }), clientId: 2 };
    const grace = { ...state({ userId: 'grace', selection: ['n3'] }), clientId: 3 };
    const owners = selectionOwners([ada, grace]);
    expect(owners.get('n1')).toBe(ada);
    expect(owners.get('n2')).toBe(ada);
    expect(owners.get('n3')).toBe(grace);
  });

  it('has nothing for a node nobody has selected', () => {
    const ada = { ...state({ selection: ['n1'] }), clientId: 2 };
    expect(selectionOwners([ada]).get('n9')).toBeUndefined();
  });

  it('gives a contested node to the first peer, since an outline has one colour', () => {
    const ada = { ...state({ userId: 'ada', selection: ['n1'] }), clientId: 2 };
    const grace = { ...state({ userId: 'grace', selection: ['n1'] }), clientId: 3 };
    expect(selectionOwners([ada, grace]).get('n1')).toBe(ada);
  });

  it('is empty when nobody is here', () => {
    expect(selectionOwners([]).size).toBe(0);
  });
});

describe('throttle', () => {
  afterEach(() => vi.useRealTimers());

  it('lets the first call straight through', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    throttle(fn, 100)('a');
    expect(fn).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('collapses a burst into one leading and one trailing call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('a');
    throttled('b');
    throttled('c');
    expect(fn.mock.calls).toEqual([['a']]);

    // The trailing call carries the newest arguments: a cursor cares where it
    // is now, not about every point it passed through.
    vi.advanceTimersByTime(100);
    expect(fn.mock.calls).toEqual([['a'], ['c']]);
  });

  it('lets a call through again once the window has passed', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('a');
    vi.advanceTimersByTime(150);
    throttled('b');
    expect(fn.mock.calls).toEqual([['a'], ['b']]);
  });

  it('drops a trailing call that has not fired when cancelled', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('a');
    throttled('b');
    throttled.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn.mock.calls).toEqual([['a']]);
  });

  it('reports a moving pointer about thirty times a second', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, CURSOR_INTERVAL_MS);

    // One `pointermove` per millisecond for a second — roughly what a fast drag
    // on a 120 Hz trackpad produces, and far more than the wire should carry.
    for (let ms = 0; ms < 1000; ms += 1) {
      throttled({ x: ms, y: 0 });
      vi.advanceTimersByTime(1);
    }
    expect(fn.mock.calls.length).toBeLessThanOrEqual(1000 / CURSOR_INTERVAL_MS + 1);
    expect(fn.mock.calls.length).toBeGreaterThan(20);
  });
});
