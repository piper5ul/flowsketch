# Real-time collaboration

Status: **design accepted 2026-09-06; phase 1 in progress.** Tracked on the FlowSketch Roadmap as `realtime-p1` … `realtime-p4`.

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
- **Undo** becomes `Y.UndoManager` scoped to this client's transaction origin: undo reverts *your* edits only, never a collaborator's. The snapshot history (`past`/`future`, `beginInteraction`) is removed for collaborative diagrams.
- Autosave, retry, `ifUnmodifiedSince` and the conflict banner are unnecessary once the doc is the source of truth (Hocuspocus persistence *is* the save); the JSON snapshot writer replaces them. Save status becomes connection status ("Live", "Reconnecting…", "Offline — changes will sync").
- Cursors and selections of others render through `ViewportPortal` (like comment pins); a "who's here" avatar strip lives in the TopBar.

## Phases (each shippable alone, one PR each, test-first)

1. **`realtime-p1` Infra + presence.** Hocuspocus attached to Express with cookie auth and role checks; awareness-based cursors, selections and "who's here"; no document sync yet (the doc is connected but empty — nothing reads it). Deliverable: two users see each other live. *No data-model change.*
2. **`realtime-p2` Document sync.** `DiagramDoc` table + migration, database extension with lazy upgrade, the client binding, JSON snapshot rendering, `syncDiagramImages` on store; simultaneous editing works; the conflict banner and `ifUnmodifiedSince` are bypassed for collaborative diagrams. Import/restore/backfill write through the doc.
3. **`realtime-p3` Undo + cleanup.** `Y.UndoManager`, removal of the now-dead autosave/retry/conflict code paths and their tests, connection-status indicator, docs (README, CLAUDE.md, DEPLOYMENT.md: nothing to deploy beyond the app, but note the WebSocket upgrade path if a reverse proxy is ever put in front).
4. **`realtime-p4` Offline (optional).** `y-indexeddb` so a dropped connection keeps working and merges on reconnect.

## Risks

- **Undo semantics change** (phase 3): per-user CRDT undo behaves differently from snapshot undo; every undo-related test from PR #4 onward is revisited.
- **Dual-write drift** (phase 2): while the doc and the JSON snapshot coexist, any path that writes JSON directly desynchronizes them. The invariant above is enforced by tests that assert `Diagram.data` is only ever written by the snapshot renderer.
- **Single process.** Hocuspocus keeps open docs in memory; that is fine for one `whimsy.service`. A second process would need the Redis extension.

## Testing

- Unit: binding round-trips (store ↔ doc), concurrent edits on different keys merge, same-key last-writer, `render` ↔ `migrateDiagramData` round-trip, awareness state shape, auth hook decisions (no access / viewer read-only / editor).
- Integration: Hocuspocus started in-process on `127.0.0.1` (via `server/testServer.ts`), two `HocuspocusProvider`s in Node (`ws` polyfill), edit on one, observe on the other; persistence extension writes the snapshot.
- E2E: two browser contexts on one diagram — cursors visible both ways (phase 1); both drag different shapes at once and both pages end equal, one page reloads and sees the same (phase 2); undo reverts only your own move (phase 3).

## Versions (2026-09-06)

`yjs 13.6.32`, `@hocuspocus/server 4.6.0`, `@hocuspocus/provider 4.6.0`, `@hocuspocus/extension-database 4.6.0`, `y-protocols 1.0.7`, `ws 8.21.3`, `y-indexeddb 9.0.12`.
