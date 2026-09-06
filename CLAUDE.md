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
- `src/components/Canvas.tsx` — React Flow wrapper plus a ~300-line keyboard-shortcut `if` chain in one `useEffect` (roadmap: replace with a command registry). Clipboard for copy/paste is a closure variable there.
- `src/nodes/ShapeNode.tsx` — one component renders all 9 shape kinds. Diamond/triangle/hexagon/cylinder are inline SVG; others are CSS. Text editing is a `contentEditable` div committed on blur.
- **Floating arrows are a hack:** an edge whose source and target are both 1×1 nodes with `fill: 'transparent', stroke: 'transparent'`. `isAnchor` checks in ShapeNode/Canvas detect these. Don't "fix" transparent fills without checking this.
- `src/edges/ConnectorEdge.tsx` — elbow routing via `src/lib/manhattanRouter.ts` (extracted from JointJS, MPL-2.0). Only ONE `waypoint` per edge today. `cleanPath` absorbs sub-8px kinks from grid snapping.
- Arrowheads are top-level edge fields (`markerStart`/`markerEnd`), regenerated from `data` by `computeMarkers`. Persisted JSON stores both.
- `server/` — Express 5. `router.ts` is the diagram CRUD (all routes scoped by `userId`); `auth.ts` is BetterAuth with Prisma adapter; `middleware.ts` puts `req.user`/`req.session` on the request, typed in `types.ts` by declaration-merging `Express.Request` with `auth.$Infer.Session` — routes read it through `authedUser(req)`, never a cast. `validation.ts` holds the zod body schemas (POST/PUT `/api/diagrams`); `rateLimit.ts` the limiter factories (600/15 min on `/api`, 60/15 min on `POST /api/images`, both skipped when `NODE_ENV=test`). `GET /api/health` is DB-free; `?deep=1` also pings Postgres and 503s if it is down.
- `prisma/schema.prisma` — BetterAuth tables + `Diagram { data: Json, thumbnail (never written), starred }`. Schema is applied with `prisma db push`; no migrations yet.
- Persistence: `CanvasPage.tsx` subscribes to the store and autosaves with a 2 s debounce. **The debounce timer is cleared on unmount without flushing** (roadmap `flush-save`).
- Images: the server side is done — `server/images.ts` (`/api/images`, raw `image/*` up to 10 MB) writes bytes to `UPLOAD_DIR/<userId>/<id>.<ext>` and rows the metadata in `Image`; `server/imageTypes.ts` sniffs magic bytes (never the Content-Type); deleting a diagram drops the images only it referenced (`server/imageRefs.ts`). **The client still pastes base64 into `data.imageSrc`** — wiring `Canvas.tsx` to POST and store the returned URL is still open. JSON body limit is 5 MB.

## Conventions

- Every store action that mutates nodes/edges must `pushHistory` first.
- Default edge stroke `#6B7080` is duplicated in 7 places; if touching it, extract a constant.
- Tests: pure logic next to the file (`*.test.ts`), store tests drive `getState()`, API tests mock `./db.js` and `./middleware.js` with `vi.mock`, user flows in `e2e/`. Bug fixes start with a failing test; `it.fails` marks a documented known bug.
- Don't loosen a test to make it pass. If a router/geometry assertion fails, the tolerance is documented in the test — investigate before changing it.

## Deployment (see memory / DEPLOYMENT.md once written)

Production is `whimsical.vedalogy.com` → cloudflared tunnel (currently running on the dev Mac) → Proxmox LXC 235 at 192.168.68.251 → `systemd whimsy.service` → `/opt/whimsy` (a manual rsync copy, no git) → Postgres 192.168.68.242. There is no CI deploy; nothing merged reaches prod without a manual copy + `systemctl restart whimsy`.

## Roadmap

Tracked on the FlowSketch Roadmap artifact (78 items, 11 tracks). Agreed order: fix-first bugs → deploy path → images → align/distribute → command registry → dashboard/data → open-source push → big arcs. One roadmap item per branch/PR.
