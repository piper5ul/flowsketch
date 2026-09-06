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
import { serializeDiagram, setDocumentFlush, useDiagramStore } from './useDiagramStore';

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
  // thing that could write it — which is what an unbound store already does.
  setDocumentFlush(null);
  connection?.destroy();
  connection = null;
}

export const useCollabStore = create<CollabState>((set, get) => ({
  peers: [],
  selectionOwners: new Map(),
  status: 'disconnected',
  diagramId: null,

  connect: (diagramId, user, origin, options) => {
    if (get().diagramId === diagramId && connection) return;
    teardown();
    set({ diagramId, peers: [], selectionOwners: new Map(), status: 'connecting' });

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
        });
        // From here "Saved" means "the document reached the server", and the
        // JSON `PUT` stops carrying diagram data at all.
        if (!options?.readOnly) setDocumentFlush(() => connection?.flush() ?? Promise.resolve(false));
      },
      // Guarded on the diagram id: a callback from the connection being torn
      // down can still land after the next one has been opened, and it must not
      // wipe the new connection's peers.
      onPeers: (peers) => {
        if (get().diagramId !== diagramId) return;
        set({ peers, selectionOwners: selectionOwners(peers) });
      },
      onStatus: (status) => { if (get().diagramId === diagramId) set({ status }); },
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
    set({ diagramId: null, peers: [], selectionOwners: new Map(), status: 'disconnected' });
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
