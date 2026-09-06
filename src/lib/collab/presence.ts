/**
 * The collaboration connection: who else has this diagram open, where their
 * pointer is, what they have selected — and, from phase 2, the document their
 * edits and yours travel in.
 *
 * Presence rides Yjs **awareness**, which is the part of the CRDT that is
 * deliberately not the document: it is not persisted, it is dropped the moment
 * a client goes away, and it never enters the undo history. The diagram itself
 * rides the `Y.Doc` this exposes as `document`; `src/lib/collab/binding.ts` is
 * what ties that to the store, and it is tied only once `onSynced` has fired —
 * the document is the source of truth, and binding to one that is still empty
 * because the first message has not arrived would empty the canvas.
 *
 * Everything here except `connectPresence` is pure, because that is where the
 * decisions are: what colour someone gets, who counts as a peer, and how often a
 * moving pointer is allowed to speak.
 */
import { HocuspocusProvider } from '@hocuspocus/provider';
import type * as Y from 'yjs';

/** A pointer position, in flow coordinates — never screen pixels. */
export interface PresenceCursor {
  x: number;
  y: number;
}

/**
 * One client's awareness state, exactly as it goes on the wire.
 *
 * `userId` and `name` are what the *client* says it is; the server knows better
 * (it authenticated the socket) but does not rewrite the state, so nothing
 * security-relevant may be decided from these. They label a cursor, no more.
 */
export interface PresenceState {
  userId: string;
  name: string;
  color: string;
  /** `null` while the pointer is off the canvas — the cursor is not drawn. */
  cursor: PresenceCursor | null;
  /** Ids of the nodes this client has selected. */
  selection: string[];
}

/** A peer is someone else's state, plus the Yjs client id that identifies it. */
export interface Peer extends PresenceState {
  clientId: number;
}

/** The connection's own state, as the "who's here" strip reports it. */
export type PresenceStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * The cursor colours, in the order they are handed out.
 *
 * Diagram colours are the user's own and never themed; these are chrome, and
 * they are picked to read against both the light and the dark canvas — a peer's
 * cursor has to be findable on either. Eight is enough that a collision is
 * unlikely in a room small enough to see everyone in.
 */
export const PEER_COLORS = [
  '#2563EB', // blue
  '#DB2777', // pink
  '#16A34A', // green
  '#EA580C', // orange
  '#7C3AED', // violet
  '#0891B2', // cyan
  '#CA8A04', // amber
  '#DC2626', // red
] as const;

/**
 * The colour that belongs to `userId`, everywhere and forever.
 *
 * Deterministic rather than assigned on arrival, so the same person is the same
 * colour in everybody's window and stays that colour across a reconnect — an
 * index handed out in join order would renumber everyone when someone leaves.
 */
export function peerColor(userId: string): string {
  // djb2, taken unsigned. Any stable hash would do; this one is short enough to
  // read and spreads short ids (which is all a cuid or nanoid ever is).
  let hash = 5381;
  for (let i = 0; i < userId.length; i += 1) {
    hash = ((hash << 5) + hash + userId.charCodeAt(i)) >>> 0;
  }
  return PEER_COLORS[hash % PEER_COLORS.length];
}

/**
 * One or two letters standing for a name, for the avatar in the top bar.
 *
 * First and last initial of a full name, two letters of a single one. `?` for a
 * name that is nothing but space: the circle is drawn either way, and an empty
 * one says less than a question mark does.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** The document a diagram's presence lives on. Mirrored by the server's parser. */
export function presenceDocumentName(diagramId: string): string {
  return `diagram:${diagramId}`;
}

/**
 * Where the collaboration socket is, given the page's own origin.
 *
 * Same origin as the API, so the browser sends the session cookie with the
 * upgrade — which is the whole of the client's half of authentication. The
 * scheme has to be swapped by hand: `ws:` for a page served over HTTP, `wss:`
 * for one served over HTTPS, or a page on `https://` would try to open an
 * insecure socket and be blocked as mixed content.
 */
export function collabUrl(origin: string): string {
  const url = new URL('/collab', origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/** True for a value that is a usable peer state; anything else is ignored. */
function isPresenceState(value: unknown): value is PresenceState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Partial<PresenceState>;
  return (
    typeof state.userId === 'string' &&
    typeof state.name === 'string' &&
    typeof state.color === 'string' &&
    Array.isArray(state.selection) &&
    (state.cursor === null ||
      (typeof state.cursor === 'object' &&
        state.cursor !== null &&
        typeof state.cursor.x === 'number' &&
        typeof state.cursor.y === 'number'))
  );
}

/**
 * Everyone in `states` except this client, in a stable order.
 *
 * A state can be anything at all — it is written by another browser, which may
 * be running a different build — so a half-populated or unrecognisable entry is
 * dropped rather than rendered. Sorted by client id so the avatar strip does not
 * reshuffle itself every time somebody moves their mouse; `Map` iteration order
 * follows insertion, which differs per window.
 */
export function peersFrom(states: Map<number, unknown>, selfClientId: number): Peer[] {
  const peers: Peer[] = [];
  for (const [clientId, state] of states) {
    if (clientId === selfClientId) continue;
    if (!isPresenceState(state)) continue;
    peers.push({ ...state, clientId });
  }
  return peers.sort((a, b) => a.clientId - b.clientId);
}

/**
 * Which peer, if any, is holding each selected node.
 *
 * Built once per peer update rather than searched per node: a peer list is
 * replaced tens of times a second while somebody moves their mouse, and every
 * shape on the board is watching it. A map turns that into one lookup each.
 *
 * The first peer wins when two have the same shape selected — one outline can
 * only be one colour, and what it says is "somebody else has this".
 */
export function selectionOwners(peers: Peer[]): ReadonlyMap<string, Peer> {
  const owners = new Map<string, Peer>();
  for (const peer of peers) {
    for (const nodeId of peer.selection) {
      if (!owners.has(nodeId)) owners.set(nodeId, peer);
    }
  }
  return owners;
}

/** How often a moving pointer is put on the wire: ~30 reports a second. */
export const CURSOR_INTERVAL_MS = 33;

export interface Throttled<A extends unknown[]> {
  (...args: A): void;
  /** Drops a trailing call that has not fired yet. For teardown. */
  cancel: () => void;
}

/**
 * `fn`, called at most once per `intervalMs`.
 *
 * Leading *and* trailing: the first move of a gesture is reported immediately,
 * so a cursor never lags a whole interval behind at the start, and the last one
 * is reported too — dropping it would leave every peer's cursor frozen a few
 * pixels short of where the pointer actually stopped.
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number,
): Throttled<A> {
  let lastCallAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const run = (args: A) => {
    lastCallAt = Date.now();
    fn(...args);
  };

  const throttled = (...args: A) => {
    const wait = intervalMs - (Date.now() - lastCallAt);
    if (wait <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        pending = null;
      }
      run(args);
      return;
    }
    // Inside the window: keep the newest arguments and let the timer already
    // running deliver them. A cursor cares about where it is now, not about
    // every point it passed through.
    pending = args;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const queued = pending;
      pending = null;
      if (queued) run(queued);
    }, wait);
  };

  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return throttled;
}

export interface PresenceUser {
  id: string;
  name: string;
}

export interface ConnectPresenceOptions {
  diagramId: string;
  user: PresenceUser;
  /** The page's origin. Injected so the connection is not tied to `window`. */
  origin: string;
  /** Called with the peer list whenever anybody's awareness changes. */
  onPeers: (peers: Peer[]) => void;
  onStatus: (status: PresenceStatus) => void;
  /**
   * Called whenever the answer to "is everything written here on the server?"
   * changes — `false` while an update is still in the browser.
   *
   * The provider is the only thing that knows, and from phase 3 the connection
   * is what the UI reports instead of a save status, so somebody has to ask.
   */
  onPending?: (pending: boolean) => void;
  /**
   * Called once the server's first document message has been applied — the
   * moment the `Y.Doc` really holds this diagram and may be bound to the store.
   * Fires again after a reconnect, so the callback has to be idempotent.
   */
  onSynced?: () => void;
}

export interface PresenceConnection {
  /** The shared document. Empty until `onSynced` has fired. */
  document: Y.Doc;
  /** Report the pointer, in flow coordinates, or `null` when it leaves. */
  setCursor: (cursor: PresenceCursor | null) => void;
  /** Report which nodes are selected. */
  setSelection: (nodeIds: string[]) => void;
  /**
   * Resolves `true` once everything written locally has reached the server, or
   * `false` if that has not happened within `FLUSH_TIMEOUT_MS`.
   *
   * This is what "saved" means for a collaborative diagram: the document is the
   * save, so there is nothing to `PUT` — but the autosave loop still wants to
   * know whether the edit has actually left the browser.
   */
  flush: () => Promise<boolean>;
  /** Close the socket and stop reporting. */
  destroy: () => void;
}

/**
 * How long `flush` waits for the socket before reporting the edit as still in
 * hand. Generous: a reconnect is worth waiting out, and the caller's answer to
 * "no" is to ask again on a backoff rather than to lose anything.
 */
export const FLUSH_TIMEOUT_MS = 8000;

/**
 * Opens the presence connection for one open diagram.
 *
 * No token: the socket is same-origin with the API, so the session cookie rides
 * the upgrade and the server decides from that. A refusal is not retried — the
 * page keeps working without presence, which is exactly the right failure for a
 * feature that is decoration on top of a diagram that loaded over HTTP.
 */
export function connectPresence({
  diagramId,
  user,
  origin,
  onPeers,
  onStatus,
  onSynced,
  onPending,
}: ConnectPresenceOptions): PresenceConnection {
  const provider = new HocuspocusProvider({
    url: collabUrl(origin),
    name: presenceDocumentName(diagramId),
    onStatus: ({ status }) => onStatus(status as PresenceStatus),
    // A rejected connection is silent by design: nothing on the page depends on
    // presence, and a viewer whose access was revoked mid-session is already
    // being told so by the next thing they try to do.
    onAuthenticationFailed: () => onStatus('disconnected'),
    // The document has arrived: from here it, and not the JSON the page loaded
    // over HTTP, is what this diagram is.
    onSynced: () => onSynced?.(),
  });

  const state: PresenceState = {
    userId: user.id,
    name: user.name,
    color: peerColor(user.id),
    cursor: null,
    selection: [],
  };
  provider.setAwarenessField('userId', state.userId);
  provider.setAwarenessField('name', state.name);
  provider.setAwarenessField('color', state.color);
  provider.setAwarenessField('cursor', state.cursor);
  provider.setAwarenessField('selection', state.selection);

  const publishPeers = () => {
    const awareness = provider.awareness;
    if (!awareness) return;
    onPeers(peersFrom(awareness.getStates(), provider.document.clientID));
  };
  provider.awareness?.on('change', publishPeers);
  publishPeers();

  const sendCursor = throttle((cursor: PresenceCursor | null) => {
    provider.setAwarenessField('cursor', cursor);
  }, CURSOR_INTERVAL_MS);

  /** True while something written in this browser has not reached the server. */
  const reportPending = () => onPending?.(!provider.isSynced || provider.hasUnsyncedChanges);
  provider.on('synced', reportPending);
  provider.on('unsyncedChanges', reportPending);
  reportPending();

  /** Resolves once the provider has nothing left to send, or gives up. */
  const flush = () =>
    new Promise<boolean>((resolve) => {
      const settled = () => provider.isSynced && !provider.hasUnsyncedChanges;
      if (settled()) {
        resolve(true);
        return;
      }
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (ok: boolean) => {
        if (timer) clearTimeout(timer);
        provider.off('synced', check);
        provider.off('unsyncedChanges', check);
        resolve(ok);
      };
      const check = () => { if (settled()) finish(true); };
      provider.on('synced', check);
      provider.on('unsyncedChanges', check);
      timer = setTimeout(() => finish(false), FLUSH_TIMEOUT_MS);
    });

  return {
    document: provider.document,
    flush,
    setCursor: (cursor) => {
      // Leaving the canvas is not a move: it takes effect at once, or a cursor
      // could be left hanging where the pointer last was until it comes back.
      if (cursor === null) {
        sendCursor.cancel();
        provider.setAwarenessField('cursor', null);
        return;
      }
      sendCursor(cursor);
    },
    setSelection: (nodeIds) => provider.setAwarenessField('selection', nodeIds),
    destroy: () => {
      sendCursor.cancel();
      provider.off('synced', reportPending);
      provider.off('unsyncedChanges', reportPending);
      provider.awareness?.off('change', publishPeers);
      // Removes this client's awareness state for everybody else on the way
      // out, rather than leaving a ghost cursor until the server times it out.
      provider.destroy();
      onPeers([]);
      onStatus('disconnected');
    },
  };
}
