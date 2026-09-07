/**
 * The copy of a diagram's document this browser keeps for itself.
 *
 * Phase 4 of `docs/realtime.md`. `y-indexeddb` mirrors the `Y.Doc` into
 * IndexedDB and replays it on the next open, which buys two things the socket
 * cannot: a board that draws itself before — or without — the server answering,
 * and edits made with no connection at all that are still there after a reload.
 * Merging them back is the CRDT's job and needs no code here; an update from
 * the cache and an update from the server are the same kind of thing to Yjs,
 * and it does not care which arrives first.
 *
 * **It is a cache, never the record.** The server's document is still the
 * source of truth and `Diagram.data` is still rendered from it. Nothing here
 * decides what a diagram *is*; it only decides how quickly this window can
 * start showing one.
 *
 * The public `/s/:token` page reaches none of this — it never opens a
 * collaboration connection, having no session to name a reader by — so an
 * anonymous visitor leaves nothing behind in the browser they read it on.
 */
import { IndexeddbPersistence } from 'y-indexeddb';
import type * as Y from 'yjs';

/**
 * The IndexedDB database one diagram's cached document lives in.
 *
 * Namespaced, because the origin is shared with everything else this app and
 * this browser store, and one database per diagram so that dropping one
 * diagram's cache cannot touch another's. Pure, and the only part of this
 * module that can be tested without a browser.
 */
export function offlineDocKey(diagramId: string): string {
  return `flowsketch:diagram:${diagramId}`;
}

/** The handle `useCollabStore` keeps while a diagram is open. */
export interface OfflineDoc {
  /**
   * Forget this diagram entirely, and stop caching it.
   *
   * For the one case where the cache is not the user's to keep: the server has
   * refused the socket because they are no longer a member, or the diagram is
   * gone. Nothing will ever sync that copy again, so it should not outlive the
   * access it was made under.
   */
  clear: () => Promise<void>;
  /** Stop mirroring, leaving what is stored where it is. For teardown. */
  destroy: () => Promise<void>;
}

/**
 * Start mirroring `doc` into IndexedDB, calling `onLoaded` once whatever was
 * stored has been applied to it.
 *
 * `null` when the browser will not have it — IndexedDB is absent (a test
 * environment, an unusual embedding) or refuses to open (Firefox's private
 * windows throw on the attempt). Both are a reason to go on without a cache and
 * none at all to fail an open, so the caller gets nothing rather than an error:
 * a diagram with no offline copy is exactly the diagram phase 3 shipped.
 */
export function openOfflineDoc(
  diagramId: string,
  doc: Y.Doc,
  onLoaded: () => void,
): OfflineDoc | null {
  if (typeof indexedDB === 'undefined' || indexedDB === null) return null;

  let persistence: IndexeddbPersistence;
  try {
    persistence = new IndexeddbPersistence(offlineDocKey(diagramId), doc);
  } catch {
    return null;
  }

  // Resolved once the stored updates are in the document. A rejection means
  // the store could not be read, which is the same situation as an empty one.
  void persistence.whenSynced.then(onLoaded).catch(() => {});

  /** `clearData` destroys the instance too; a second teardown must not run. */
  let closed = false;
  const close = <T>(run: () => Promise<T>) => {
    if (closed) return Promise.resolve();
    closed = true;
    // Best effort throughout: a cache that could not be written, read or
    // dropped is a cache, not a diagram, and never a reason to raise.
    return run().then(() => undefined).catch(() => undefined);
  };

  return {
    clear: () => close(() => persistence.clearData()),
    destroy: () => close(() => persistence.destroy()),
  };
}
