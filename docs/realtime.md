# Real-time collaboration

Status: **design accepted 2026-09-06; phases 1, 2 and 3 shipped.** Tracked on the FlowSketch Roadmap as `realtime-p1` … `realtime-p4`.

## Why

Sharing (members, roles, read-only) makes two people able to open the same diagram, but editing is still turn-based: each browser edits its own copy, autosaves every 2 s, and a stale save is refused with the "changed in another tab" banner (409). There are no cursors and no live updates. Real-time collaboration means: you see who else is here and where they are, and edits merge as they happen.

## Approach

**Yjs** (a CRDT — concurrent edits from different people merge without conflicts, offline included) holds the diagram as a shared document; **Hocuspocus** (`@hocuspocus/server`) is the WebSocket server that fans updates out and persists them. Both are self-hosted inside the existing Express process.

Considered and rejected: Server-Sent Events + POST for presence only (cheap, but gets thrown away when real sync arrives); hosted services (Liveblocks, PartyKit, Ably — least code, monthly cost, diagram data leaves the box); Socket.IO (transport only, all merge logic would be ours).

### Data model

- `Y.Doc` per diagram, document name `diagram:<id>`, containing `nodes: Y.Map<id, node>` and `edges: Y.Map<id, edge>` (one entry per element, so two people editing different shapes never touch the same key). Node/edge values are plain JSON objects of today's `SerializedNode` / `SerializedEdge`; a change to one field rewrites that element's entry (elements are small; per-field CRDT granularity is not worth the complexity).
- `Diagram.data` (JSON) **stays** as a *derived snapshot*, re-rendered from the doc on a debounce. Everything that reads JSON — the dashboard, thumbnails, PNG/SVG/JSON export, versions, the public `/s/:token` page, comments' anchors, image reference index — keeps working unchanged.
- New table `DiagramDoc { diagramId (pk), state bytea, updatedAt }` holds the encoded Yjs state (`Y.encodeStateAsUpdate`). Additive migration.
- **Lazy upgrade:** the first collaborative open of a diagram whose `DiagramDoc` row is missing seeds the doc from `Diagram.data` (after `migrateDiagramData`). Nothing is bulk-migrated.
- Invariant: **anything that writes diagram content writes the Y.Doc**, never `Diagram.data` directly (import, restore, image backfill). The JSON snapshot is output only. Version restore = replace the doc's maps from the version's JSON in one transaction.

### Server

- Hocuspocus is attached to the existing HTTP server: `httpServer.on('upgrade')` → `ws` `WebSocketServer({ noServer: true })` → `hocuspocus.handleConnection(ws, req)`. One process, port 3001, works through the Cloudflare tunnel unchanged.
- `onAuthenticate`: read the BetterAuth session from the cookie (`auth.api.getSession` with the upgrade request headers, exactly as `requireAuth` does), resolve the diagram role with `getDiagramAccess`; no access → reject; `viewer` → `connection.readOnly = true`; `owner`/`editor` → read-write. Public share visitors are **not** connected in this design (they keep the JSON page).
- Persistence: `@hocuspocus/extension-database` with `fetch` (load `DiagramDoc.state`, else seed from JSON) and `store` (debounced by Hocuspocus; write `DiagramDoc.state`, then render the doc to JSON and `UPDATE Diagram SET data, updatedAt`, then `syncDiagramImages`). The render is the single place JSON is produced from a doc (`server/collab/render.ts`), unit-tested against `migrateDiagramData` round-trips.
- Presence rides Yjs **awareness** (no persistence): `{ userId, name, color, cursor: {x, y} | null, selection: string[] }`.

### Client

- `@hocuspocus/provider` `HocuspocusProvider` per open diagram (cookie auth, so no token); `src/lib/collab/binding.ts` is the two-way binding between the Y.Doc and the Zustand store:
  - doc → store: `observe` on both maps → `setState` (no undo entry, marked as remote so the autosave path ignores it).
  - store → doc: the ~15 mutating actions call into the binding inside one `doc.transact(…, origin)` per action; transient drags stay local and commit on release (one transaction).
- **Undo** becomes `Y.UndoManager` scoped to this client's transaction origin: undo reverts *your* edits only, never a collaborator's. The snapshot history (`past`/`future`, `beginInteraction`) is removed for collaborative diagrams. *(Shipped in phase 3, with the boundaries still decided by the store — see "What phase 3 did differently".)*
- Autosave, retry, `ifUnmodifiedSince` and the conflict banner are unnecessary once the doc is the source of truth (Hocuspocus persistence *is* the save); the JSON snapshot writer replaces them. Save status becomes connection status ("Live", "Reconnecting…", "Offline — changes will sync").
- Cursors and selections of others render through `ViewportPortal` (like comment pins); a "who's here" avatar strip lives in the TopBar.

## Phases (each shippable alone, one PR each, test-first)

1. ✅ **`realtime-p1` Infra + presence.** Hocuspocus attached to Express with cookie auth and role checks; awareness-based cursors, selections and "who's here"; no document sync yet (the doc is connected but empty — nothing reads it). Deliverable: two users see each other live. *No data-model change.*
2. ✅ **`realtime-p2` Document sync.** `DiagramDoc` table + migration, database extension with lazy upgrade, the client binding, JSON snapshot rendering, `syncDiagramImages` on store; simultaneous editing works; the conflict banner and `ifUnmodifiedSince` are bypassed for collaborative diagrams. Import/restore/backfill write through the doc.
3. ✅ **`realtime-p3` Undo + cleanup.** `Y.UndoManager` scoped to this client's origin; the autosave loop, its retry backoff, `ifUnmodifiedSince` and the conflict banner stop running for a bound diagram; the save indicator becomes a connection indicator; docs.
4. **`realtime-p4` Offline (optional).** `y-indexeddb` so a dropped connection keeps working and merges on reconnect.

## What phase 2 did differently

Three departures from the plan above, all made while building it:

- **store → doc is one diffing subscription, not a call in each of the ~25 mutating actions.** Every action ends in one synchronous `set`, so a single store subscription is still exactly one `doc.transact` per action — and because what it compares is the *serialized* diagram, a change that leaves the saved JSON identical (a selection, a measured size) writes nothing, which a per-action hook would have had to know about action by action. An action added tomorrow is covered without being told to be.
- **A gesture is committed on a trailing flush (150 ms), not on a release event.** The design says transient drags "commit on release"; there is no release for all of them — a text shape's height follows what is being typed and never commits — so the store marks per-frame writes with a `transientSeq` and the binding holds them until they stop, rather than dropping them and waiting for a commit that may not come.
- **The save indicator still says "Saved".** Rewording it as connection status is listed under phase 3 here, and doing it in phase 2 would have changed what a dozen end-to-end tests wait on for no gain. For a collaborative diagram "Saved" now means "the provider reports this browser's edits have reached the server", which is the same claim it always made.

One thing the design left open: the **viewport** is written into the document's `meta` (the snapshot needs it, so a diagram reopens where it was left) but is deliberately never read back out, because a peer scrolling their own window must not move yours.

Two limitations phase 2 shipped with, both listed against later phases:

- **Undo is still the snapshot stack**, so ⌘Z can walk back over a collaborator's edit. That is phase 3's `Y.UndoManager` — done, below.
- **A diagram whose socket will not open cannot be edited.** The document is the save, so a browser that reaches `/api` but not `/collab` (a proxy that will not upgrade, say) falls back to the JSON `PUT`, which the server refuses with `409` once the diagram has a document — the conflict banner's "Reload" is the way out, and the edits made in the meantime are lost. Making that survivable is phase 4's `y-indexeddb`.

## What phase 3 did differently

**Undo boundaries come from the store, not from a clock.** The plan's
`captureTimeout` is infinite instead. Yjs merges transactions into one stack
item while they arrive inside that window, which would have made a drag the user
paused in the middle of two undo steps and would have coalesced arrow-key nudges
on a 150 ms rule where `nudgeSelected` has always used 500 ms. So the boundary is
the one the app already knew: `pushHistory` — the call every mutating action
makes and the thing the snapshot stack pushed on — now passes a `beginEntry()`
through to `UndoManager.stopCapturing()` for a bound diagram, and the binding
opens one more at the first frame of a gesture (the store cannot, because a drag
pushes history on the *release*). Every existing `pushHistory` call site was
therefore already in the right place, and the two models split a session into the
same steps.

**`meta` is not tracked.** The design says the manager covers `nodes`, `edges`
and `meta`. `meta` holds the viewport, which is written for the snapshot's sake
and deliberately never read back out — so tracking it would have given the user
an undo entry for *panning* that changes nothing they can see. Nodes and edges
only. (A transaction touching only `meta` creates no stack item at all, which is
what makes that work.)

**Selection is restored after an undo.** It is not in the document, so without
this an undo would put a shape back somewhere off screen with nothing to say
where it went. The binding notes which element ids the undo's transaction
changed and selects them.

**The snapshot history is kept, not removed.** The design says it "is removed for
collaborative diagrams", and it is — for those. But a diagram whose socket was
refused is still a real state (no session, a proxy that will not upgrade, the
public page), and there the `past` / `future` stacks, the debounced `PUT`, its
retry backoff, `ifUnmodifiedSince` and the conflict banner are still the whole of
how that board is kept. Nothing was deleted; `CanvasPage` arms the autosave
effect only while the diagram is unbound, and `useDiagramStore` dispatches
`undo` / `redo` to whichever history is in force.

**"Live" needed a second signal for the tests.** The indicator reports the
connection, which is the right thing to show a user and *not* the same claim as
"everything you typed has arrived". The end-to-end tests need the second one
before they reload a page, so `useCollabStore.synced` answers it — the provider
has nothing left to send *and* the binding is not holding the last frame of a
gesture — and rides on the indicator as `data-collab-sync`, the way the presence
dot already carries `data-collab-status`.

One thing that came out of retiring the autosave: the two-second debounce was
accidentally covering the lag between the document and the JSON snapshot the
server renders from it. Without it, the public `/s/:token` page really can be a
second behind the board its owner is looking at, which is what the design always
said and is now what the test says too.

Two things phase 3 does **not** fix, both pre-existing:

- **A session that expires under a bound diagram is not offered the re-auth
  dialog.** That dialog is shown off `saveStatus === 'unauthorized'`, which only
  the JSON `PUT` can produce; the socket's answer to a dead session is a
  connection that will not open, so the bar says "Reconnecting…" and the user has
  to reload. Phase 2 made that true; phase 3 leaves it.
- **A diagram whose socket will not open** is still the phase-2 limitation above.

## Risks

- **Undo semantics change** (phase 3): per-user CRDT undo behaves differently from snapshot undo; every undo-related test from PR #4 onward is revisited.
- **Dual-write drift** (phase 2): while the doc and the JSON snapshot coexist, any path that writes JSON directly desynchronizes them. The invariant above is enforced by tests that assert `Diagram.data` is only ever written by the snapshot renderer.
- **Single process.** Hocuspocus keeps open docs in memory; that is fine for one `whimsy.service`. A second process would need the Redis extension.

## Testing

- Unit: binding round-trips (store ↔ doc), concurrent edits on different keys merge, same-key last-writer, `render` ↔ `migrateDiagramData` round-trip, awareness state shape, auth hook decisions (no access / viewer read-only / editor).
- Integration: Hocuspocus started in-process on `127.0.0.1` (via `server/testServer.ts`), two `HocuspocusProvider`s in Node (`ws` polyfill), edit on one, observe on the other; persistence extension writes the snapshot.
- E2E: two browser contexts on one diagram — cursors visible both ways (phase 1); both drag different shapes at once and both pages end equal, one page reloads and sees the same (phase 2); undo reverts only your own move, and a dropped socket says so and comes back with the edit made while it was gone (phase 3). Dropping the socket is `page.routeWebSocket`, not `context.setOffline`: Chromium's offline emulation refuses new connections and leaves an established WebSocket alone.

## Versions (2026-09-06)

`yjs 13.6.32`, `@hocuspocus/server 4.6.0`, `@hocuspocus/provider 4.6.0`, `@hocuspocus/extension-database 4.6.0`, `y-protocols 1.0.7`, `ws 8.21.3`, `y-indexeddb 9.0.12`.
