/**
 * What the UI reads about the people sharing this diagram.
 *
 * Deliberately *not* part of `useDiagramStore`: none of this is the diagram.
 * Peers arrive tens of times a second while somebody is moving their mouse, and
 * putting that in the diagram store would run its autosave subscription, its
 * history and every canvas selector on every frame of somebody else's gesture.
 *
 * The connection itself lives outside the store for the same reason a toast's
 * timer does — it is not state anything renders, and a re-render must never
 * have to diff it.
 */
import type { CSSProperties } from 'react';
import { create } from 'zustand';
import {
  connectPresence,
  selectionOwners,
  type Peer,
  type PresenceConnection,
  type PresenceCursor,
  type PresenceStatus,
  type PresenceUser,
} from '../lib/collab/presence';
import { bindDocToStore, type DocBinding } from '../lib/collab/binding';
import {
  serializeDiagram,
  setDocumentFlush,
  setDocumentHistory,
  useDiagramStore,
} from './useDiagramStore';

interface CollabState {
  /** Everyone here but you, in a stable order. Empty when not connected. */
  peers: Peer[];
  /**
   * `peers` indexed by the nodes they have selected. Derived, and kept in the
   * store rather than in each shape: every node on the board watches this, and
   * a peer list is replaced tens of times a second while somebody is moving
   * their mouse — one map build beats one search per shape per frame.
   */
  selectionOwners: ReadonlyMap<string, Peer>;
  status: PresenceStatus;
  /**
   * True once the open diagram *is* the shared document — the moment the
   * autosave loop, the conflict guard and the retry backoff stop being what
   * keeps it, and the connection becomes what the user is shown instead.
   *
   * False for a diagram whose socket never opened, which still saves itself
   * with a debounced `PUT` exactly as it always did.
   */
  bound: boolean;
  /**
   * True when everything written in this browser has reached the server.
   *
   * Two things have to be true for that: the provider has nothing left to send,
   * and the binding is not still holding the last frame of a gesture. It is not
   * a save status — a CRDT has no such thing, and the indicator says "Live"
   * either way — but it is what "your edit is out of this window" means, and
   * the end-to-end tests wait on it where they used to wait on "Saved".
   */
  synced: boolean;
  /** The diagram this connection is for, or `null` when there is none. */
  diagramId: string | null;
  /**
   * Opens the connection for `diagramId`: presence, and — once the server's
   * first document message has landed — the two-way binding between the shared
   * document and the diagram store.
   *
   * Safe to call again for the same diagram: React's StrictMode double-mounts
   * every effect, and a second socket would show the user their own ghost in
   * the "who's here" strip.
   */
  connect: (
    diagramId: string,
    user: PresenceUser,
    origin: string,
    options?: { readOnly?: boolean },
  ) => void;
  disconnect: () => void;
  /** Report the pointer in flow coordinates, or `null` when it leaves. */
  reportCursor: (cursor: PresenceCursor | null) => void;
}

/** The live connection. One at a time; see the note at the top of the file. */
let connection: PresenceConnection | null = null;
/** The store ↔ document binding, once the document has synced. */
let binding: DocBinding | null = null;
/** Unsubscribes the selection mirror below. */
let unsubscribeSelection: (() => void) | null = null;
/** The two halves of "is anything still in this browser?" — see `synced`. */
let providerPending = true;
let gesturePending = false;

/**
 * The transaction origin every edit this browser makes carries.
 *
 * A module constant rather than one per connection: it is only ever compared
 * with itself, to tell "I wrote this" from "somebody else did", and a symbol
 * that outlives a reconnect keeps that answer stable across one.
 */
const LOCAL_ORIGIN = Symbol('flowsketch:local');

/** The ids of the selected nodes, which is the whole of what peers are told. */
function selectedNodeIds(nodes: { id: string; selected?: boolean }[]): string[] {
  return nodes.filter((node) => node.selected).map((node) => node.id);
}

function teardown() {
  unsubscribeSelection?.();
  unsubscribeSelection = null;
  // Before the socket goes: the binding writes any gesture still in hand, and
  // it has to be able to send it.
  binding?.destroy();
  binding = null;
  // The diagram is not collaborative any more, so the JSON save is the only
  // thing that could write it — which is what an unbound store already does,
  // and ⌘Z goes back to the snapshot stack for the same reason.
  setDocumentFlush(null);
  setDocumentHistory(null);
  connection?.destroy();
  connection = null;
  providerPending = true;
  gesturePending = false;
}

export const useCollabStore = create<CollabState>((set, get) => ({
  peers: [],
  selectionOwners: new Map(),
  status: 'disconnected',
  bound: false,
  synced: false,
  diagramId: null,

  connect: (diagramId, user, origin, options) => {
    if (get().diagramId === diagramId && connection) return;
    teardown();
    set({
      diagramId,
      peers: [],
      selectionOwners: new Map(),
      status: 'connecting',
      bound: false,
      synced: false,
    });

    // Guarded on the diagram id like every other callback below: one of these
    // can land from a connection being torn down after the next has opened.
    const publishSynced = () => {
      if (get().diagramId !== diagramId) return;
      set({ synced: !providerPending && !gesturePending });
    };

    // The board as the page loaded it, kept until the document arrives. The
    // canvas is interactive the whole time the socket is opening, and the
    // binding needs to know which of the shapes on it are *this* browser's
    // work — see `BindDocOptions.baseline`.
    const { nodes, edges, viewport } = useDiagramStore.getState();
    const baseline = serializeDiagram(nodes, edges, viewport);

    connection = connectPresence({
      diagramId,
      user,
      origin,
      // Fires on the first sync and on every reconnect, so it has to be
      // idempotent: a binding that already exists is the right one.
      onSynced: () => {
        if (get().diagramId !== diagramId || !connection || binding) return;
        // The page can have moved on to another diagram while the socket was
        // opening. Binding then would push this board into that document.
        if (useDiagramStore.getState().diagramId !== diagramId) return;
        binding = bindDocToStore(connection.document, useDiagramStore, LOCAL_ORIGIN, {
          readOnly: options?.readOnly ?? false,
          baseline,
          onPendingWrite: (pending) => {
            gesturePending = pending;
            publishSynced();
          },
        });
        set({ bound: true });
        // From here the document is the save, the JSON `PUT` stops carrying
        // diagram data at all, and ⌘Z is the document's per-user undo rather
        // than the snapshot stack. A viewer gets neither: they write nothing,
        // so there is nothing of theirs to flush or to take back.
        if (!options?.readOnly) {
          setDocumentFlush(() => connection?.flush() ?? Promise.resolve(false));
          setDocumentHistory(binding.history);
        }
      },
      // Guarded on the diagram id: a callback from the connection being torn
      // down can still land after the next one has been opened, and it must not
      // wipe the new connection's peers.
      onPeers: (peers) => {
        if (get().diagramId !== diagramId) return;
        set({ peers, selectionOwners: selectionOwners(peers) });
      },
      onStatus: (status) => { if (get().diagramId === diagramId) set({ status }); },
      onPending: (pending) => {
        providerPending = pending;
        publishSynced();
      },
    });

    // Selection is mirrored rather than pushed by the actions that change it:
    // a dozen store actions can select something, and every one of them would
    // otherwise have to remember to say so.
    let lastSelection = '';
    unsubscribeSelection = useDiagramStore.subscribe((state) => {
      const ids = selectedNodeIds(state.nodes);
      // Any store change runs this — a drag reports a new `nodes` array on
      // every frame — so the socket only hears about it when it really moved.
      const key = ids.join(',');
      if (key === lastSelection) return;
      lastSelection = key;
      connection?.setSelection(ids);
    });
  },

  disconnect: () => {
    teardown();
    set({
      diagramId: null,
      peers: [],
      selectionOwners: new Map(),
      status: 'disconnected',
      bound: false,
      synced: false,
    });
  },

  reportCursor: (cursor) => connection?.setCursor(cursor),
}));

/**
 * The peer holding `nodeId`, if anyone is — what the outline drawn on a shape
 * somebody else has selected is read from, the way `useSearchHighlight` feeds
 * `data-search-hit`.
 */
export function usePeerSelection(nodeId: string): Peer | undefined {
  return useCollabStore((state) => state.selectionOwners.get(nodeId));
}

/**
 * The inline custom property the `[data-peer-selected]` outline takes its
 * colour from, or nothing at all when no peer holds the node.
 *
 * The cast is unavoidable and is kept here rather than at each call site:
 * `CSSProperties` has no room for a custom property, and the colour cannot come
 * from a class — it identifies a person, not a state.
 */
export function peerOutlineStyle(peer: Peer | undefined): CSSProperties | undefined {
  return peer ? ({ '--peer-color': peer.color } as CSSProperties) : undefined;
}
