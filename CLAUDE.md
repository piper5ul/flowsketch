# FlowSketch (repo name on GitHub: piper5ul/flowsketch; local dir ~/whimsy)

Whimsical-style diagramming app. Single-user today; sharing and realtime are on the roadmap.

## Commands

- `npm run dev` — Vite on **5199** (not 5173) + Express on 3001 via `concurrently`
- `npm run check` — lint + typecheck + unit tests. Must be green before any commit (pre-commit hook runs it)
- `npm test` / `npm run test:watch` — Vitest (no DB needed)
- `npm run test:e2e` — Playwright; reuses a running dev server locally, starts its own in CI
- `npm run build` — `tsc -b && vite build`; `npm run build:server` compiles the API to `dist-server/`
- `docker compose up -d` — Postgres + MailDev for local dev
- Install with `npm install --legacy-peer-deps` (npm 10.9 arborist bug with vitest's peer set)

## Architecture (read this instead of re-reading the files)

- `src/store/useDiagramStore.ts` — single Zustand store: nodes, edges, tool, defaults, undo/redo. **Undo history is module-level (`past`/`future`), snapshot-based, and only pushed by actions that call `pushHistory`** — kept out of the store so it is never serialized; `canUndo`/`canRedo` mirror it for the UI. Discrete edits (`updateNodeData`, `updateEdgeData`) push, but skip no-op patches. A pointer drag pushes once via `beginInteraction()` and then uses a transient action (`updateEdgeDataTransient`, `moveNodesTransient`, `reconnectEdgeEndpoint`). `nudgeSelected` coalesces entries within 500 ms. `loadDiagram` resets history.
- `src/commands/` — the command registry. `commands.ts` is the one list of everything the app can do; `registry.ts` matches a `KeyboardEvent` against it (⌘ and Ctrl are one `meta` flag; `event.code` is the fallback when ⌥ or a non-US layout rewrites `event.key`) and formats a binding per platform. A command's `when` gate is what lets two share a keystroke — and what lets ⌘V fall through to the browser's paste listener when our clipboard is empty, so image paste keeps working. The keyboard handler, the `?` cheat sheet (`ShortcutSheet.tsx`) and the right-click menus (`ContextMenu.tsx`, driven by each command's `contextMenu` tag) are all generated from it: add a shortcut in one place, not four.
- `src/components/Canvas.tsx` — React Flow wrapper. Its keyboard `useEffect` is now three lines: skip typing targets, ask the registry for a command, `preventDefault` and run it. The command context (store, viewport, both clipboards, hold-to-pan, the sheet) is built there with `useMemo`; the copy/paste and copy-style clipboards are refs, since neither belongs in a saved diagram. The right mouse button opens the context menu, so `panOnDrag` is the middle button only.
- `src/lib/arrange.ts` — pure geometry for align / distribute / match size, over plain `{id,x,y,w,h}` rects. The store's `alignSelected` / `distributeSelected` / `matchSizeSelected` map the selection onto it and commit the result through one shared path that skips locked nodes (they still count towards the geometry, so a locked node is the anchor) and pushes **no** history entry when nothing would move. Distribute equalises gaps between *edges*, and match size uses the largest node as its reference — selection order is not tracked anywhere. Their shortcuts are not bound in the registry yet.
- Text formatting lives in one presentational `src/components/TextFormatControls.tsx` (value + onChange), rendered both by `TextFormatBar` (one label being edited; translates patches onto a connector's `label*` keys) and by `FloatingToolbar` (the whole selection, via `updateSelectedNodesData`, which skips `shape: 'image'` nodes).
- `src/nodes/ShapeNode.tsx` — one component renders all 9 shape kinds. Diamond/triangle/hexagon/cylinder are inline SVG; others are CSS. Text editing is a `contentEditable` div committed on blur.
- **Floating arrows are a hack:** an edge whose source and target are both 1×1 nodes with `fill: 'transparent', stroke: 'transparent'`. `isAnchor` checks in ShapeNode/Canvas detect these. Don't "fix" transparent fills without checking this.
- `src/edges/ConnectorEdge.tsx` — elbow routing via `src/lib/manhattanRouter.ts` (extracted from JointJS, MPL-2.0). Only ONE `waypoint` per edge today. `cleanPath` absorbs sub-8px kinks from grid snapping.
- Arrowheads are top-level edge fields (`markerStart`/`markerEnd`), regenerated from `data` by `computeMarkers` (`src/lib/edgeMarkers.ts`, re-exported from the store). Persisted JSON stores both. `updateEdgeData` / `updateSelectedEdgesStyle` regenerate them whenever a patch touches `stroke`, `startArrow` or `endArrow`.
- `server/` — Express 5. `router.ts` is the diagram CRUD (all routes scoped by `userId`); `auth.ts` is BetterAuth with Prisma adapter; `middleware.ts` puts `req.user`/`req.session` on the request, typed in `types.ts` by declaration-merging `Express.Request` with `auth.$Infer.Session` — routes read it through `authedUser(req)`, never a cast. `validation.ts` holds the zod body schemas (POST/PUT `/api/diagrams`); `rateLimit.ts` the limiter factories (600/15 min on `/api`, 60/15 min on `POST /api/images`, both skipped when `NODE_ENV=test`). `GET /api/health` is DB-free; `?deep=1` also pings Postgres and 503s if it is down.
- `prisma/schema.prisma` — BetterAuth tables + `Diagram { data: Json, thumbnail (never written), starred }`. Schema is applied with `prisma db push`; no migrations yet.
- Persistence: `CanvasPage.tsx` subscribes to the store and autosaves with a 2 s debounce through `src/lib/autosave.ts`; unmount flushes a pending save and `pagehide` fires a keepalive save. Saved JSON is versioned — `serializeDiagram` stamps `version: CURRENT_DIAGRAM_VERSION`, and `loadDiagram` runs everything through `migrateDiagramData` (`src/lib/diagramMigrations.ts`), which upgrades unversioned v0 rows and throws on a payload from a newer build (CanvasPage shows that instead of loading, leaving autosave unarmed). Changing the shape of a diagram means a new migration step, not a silent read of the old one.
- Images: `server/images.ts` (`/api/images`, raw `image/*` up to 10 MB) writes bytes to `UPLOAD_DIR/<userId>/<id>.<ext>` and rows the metadata in `Image`; `server/imageTypes.ts` sniffs magic bytes (never the Content-Type); deleting a diagram drops the images only it referenced (`server/imageRefs.ts`). JSON body limit is 5 MB, which is why a diagram stores the `/api/images/<id>` URL and never the bytes. Client side: paste, drop and the rail's picker all go through `src/lib/useImageInsert.ts` → `src/lib/imageUpload.ts` (downscale to 2000 px, upload, then swap the URL into the "Uploading…" placeholder node). Nodes of `shape: 'image'` render as the bare `<img>`; **rectangles carrying a base64 `data.imageSrc` are the pre-upload format and must keep rendering** — old diagrams still hold them.

## Conventions

- Every store action that mutates nodes/edges must `pushHistory` first.
- `src/lib/defaults.ts` owns the default edge style: `DEFAULT_EDGE_STROKE` and `makeEdgeData(connectorType)`. Build a new connector's `data` with the factory; never re-inline the hex (it is spelled out in exactly one place).
- Tests: pure logic next to the file (`*.test.ts`), store tests drive `getState()`, API tests mock `./db.js` and `./middleware.js` with `vi.mock`, user flows in `e2e/`. Bug fixes start with a failing test; `it.fails` marks a documented known bug.
- Don't loosen a test to make it pass. If a router/geometry assertion fails, the tolerance is documented in the test — investigate before changing it.

## Deployment (see memory / DEPLOYMENT.md once written)

Production is `whimsical.vedalogy.com` → cloudflared tunnel (currently running on the dev Mac) → Proxmox LXC 235 at 192.168.68.251 → `systemd whimsy.service` → `/opt/whimsy` (a manual rsync copy, no git) → Postgres 192.168.68.242. There is no CI deploy; nothing merged reaches prod without a manual copy + `systemctl restart whimsy`.

## Roadmap

Tracked on the FlowSketch Roadmap artifact (78 items, 11 tracks). Agreed order: fix-first bugs → deploy path → images → align/distribute → command registry → dashboard/data → open-source push → big arcs. One roadmap item per branch/PR.
