/**
 * The lifecycle `useCollabStore` owns: when the shared document becomes the
 * diagram, and what happens to the copy cached in this browser when the server
 * stops letting this user have it.
 *
 * Both halves of the connection are stubbed — a real provider wants a socket
 * and `IndexeddbPersistence` wants a browser — because what is under test here
 * is neither of those. It is the order the two are allowed to arrive in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { writeDiagramIntoDoc } from '../../shared/collabDoc';
import { COLLAB_FORBIDDEN, COLLAB_UNAUTHORIZED } from '../../shared/collabAuth';
import type { ConnectPresenceOptions, PresenceConnection } from '../lib/collab/presence';
import { useCollabStore } from './useCollabStore';
import { useDiagramStore } from './useDiagramStore';

/** The last connection `connect` opened, and the callbacks it was given. */
let opened: { options: ConnectPresenceOptions; document: Y.Doc } | null = null;

vi.mock('../lib/collab/presence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/collab/presence')>()),
  connectPresence: vi.fn((options: ConnectPresenceOptions): PresenceConnection => {
    const document = new Y.Doc();
    opened = { options, document };
    return {
      document,
      flush: async () => true,
      setCursor: () => {},
      setSelection: () => {},
      destroy: () => {},
    };
  }),
}));

/** The offline cache, down to the two things the store does with it. */
const cache = vi.hoisted(() => ({
  clear: vi.fn(async () => {}),
  destroy: vi.fn(async () => {}),
  /** Replays what IndexedDB had stored, the way `whenSynced` does. */
  load: null as null | (() => void),
  /** Set to `false` for a browser that will not have IndexedDB at all. */
  available: true,
}));

vi.mock('../lib/collab/offline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/collab/offline')>()),
  openOfflineDoc: vi.fn((_id: string, _doc: Y.Doc, onLoaded: () => void) => {
    if (!cache.available) return null;
    cache.load = onLoaded;
    return { clear: cache.clear, destroy: cache.destroy };
  }),
}));

const user = { id: 'u1', name: 'Ada Lovelace' };

/** A diagram, as a page that has loaded one over HTTP holds it. */
const diagramJson = {
  version: 3,
  nodes: [{ id: 'shared', type: 'shape', position: { x: 0, y: 0 }, data: { label: 'Shared' } }],
  edges: [],
};

function connect(diagramId = 'd1', options?: { readOnly?: boolean }) {
  useDiagramStore.getState().loadDiagram(diagramId, 'Test', false, diagramJson);
  useCollabStore.getState().connect(diagramId, user, 'http://localhost:5199', options);
}

beforeEach(() => {
  opened = null;
  cache.load = null;
  cache.available = true;
  cache.clear.mockClear();
  cache.destroy.mockClear();
});

afterEach(() => {
  useCollabStore.getState().disconnect();
});

describe('binding the document', () => {
  it('binds off the cached copy, before the provider has synced anything', () => {
    connect();
    expect(useCollabStore.getState().bound).toBe(false);

    // What `y-indexeddb` replays into the document on an open.
    writeDiagramIntoDoc(opened!.document, diagramJson, 'cache');
    cache.load!();

    // The board is live off the cache alone: no round trip has happened, and
    // the diagram is already the document rather than a JSON autosave.
    expect(useCollabStore.getState().bound).toBe(true);
  });

  it('waits for the server when the cache is empty', () => {
    connect();
    // A diagram opened on this machine for the first time: IndexedDB answers,
    // and has nothing. Binding to that document would draw an empty canvas
    // over the board the page has already loaded.
    cache.load!();
    expect(useCollabStore.getState().bound).toBe(false);

    opened!.options.onSynced?.();
    expect(useCollabStore.getState().bound).toBe(true);
  });

  it('binds exactly once, whichever of the two arrives first', () => {
    connect();
    writeDiagramIntoDoc(opened!.document, diagramJson, 'cache');
    cache.load!();
    const bound = useDiagramStore.getState().nodes;

    // `onSynced` fires again on every reconnect, so it has to be idempotent —
    // a second binding would double every write this browser makes.
    opened!.options.onSynced?.();
    opened!.options.onSynced?.();
    expect(useCollabStore.getState().bound).toBe(true);
    expect(useDiagramStore.getState().nodes).toBe(bound);
  });

  it('still binds where there is no IndexedDB to cache in', () => {
    cache.available = false;
    connect();
    expect(useCollabStore.getState().bound).toBe(false);

    opened!.options.onSynced?.();
    expect(useCollabStore.getState().bound).toBe(true);
  });
});

describe('a refused connection', () => {
  it('drops the cached copy when the diagram is no longer this user’s', () => {
    connect();
    opened!.options.onAuthFailure?.('no-access');
    expect(cache.clear).toHaveBeenCalled();
  });

  it('keeps the cached copy when it is only the session that expired', () => {
    connect();
    opened!.options.onAuthFailure?.('no-session');
    // The whole point of the cache: those edits are still unsent, and signing
    // back in is what will deliver them.
    expect(cache.clear).not.toHaveBeenCalled();
  });

  it('keeps the cached copy for a refusal it cannot read', () => {
    connect();
    opened!.options.onAuthFailure?.('unknown');
    expect(cache.clear).not.toHaveBeenCalled();
  });

  it('leaves what is stored where it is when the diagram is simply closed', () => {
    connect();
    useCollabStore.getState().disconnect();
    expect(cache.destroy).toHaveBeenCalled();
    expect(cache.clear).not.toHaveBeenCalled();
  });
});

describe('the reasons the server gives', () => {
  it('are the two the browser knows how to act on', () => {
    // Belt and braces on the wire format: these strings are written by
    // `server/collab.ts` and read by `src/lib/collab/authFailure.ts`, and a
    // rename on one side alone would silently turn every refusal into a
    // connection that quietly stays down.
    expect(COLLAB_UNAUTHORIZED).toBe('unauthorized');
    expect(COLLAB_FORBIDDEN).toBe('forbidden');
  });
});
