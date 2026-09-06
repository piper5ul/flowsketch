# Contributing to FlowSketch

## Setup

```bash
git clone git@github.com:piper5ul/flowsketch.git
cd flowsketch
npm install --legacy-peer-deps   # npm 10.9 has an arborist bug with this peer set
cp .env.example .env
docker compose up -d             # Postgres on 5432, MailDev on 1080/1025
npx prisma db push
npm run dev                      # Vite on http://localhost:5199, API on :3001
```

Email verification is not required to sign in, so you can sign up and start drawing immediately. Verification and reset emails land in MailDev at http://localhost:1080.

## Workflow

1. Branch from `main` — one roadmap item or bug per branch (`fix/autosave-flush`, `feat/align-distribute`).
2. **Bug fixes start with a failing test.** Write the test that reproduces the bug, watch it fail, then fix it.
3. Run `npm run check` before pushing (the pre-commit hook does this for you).
4. Open a PR. CI runs lint, typecheck, unit tests, and Playwright against a fresh Postgres. It must be green before merge.
5. No direct pushes to `main`.

## Tests

| Command | What it runs | When |
|---|---|---|
| `npm test` | Vitest: pure logic (`src/lib`), the Zustand store, and the API router with Prisma mocked | every commit (fast, no DB) |
| `npm run test:watch` | same, in watch mode | while developing |
| `npm run test:e2e` | Playwright against the real app: sign-up, draw, edit, autosave, reload | before opening a PR; always in CI |
| `npm run check` | lint + typecheck + `npm test` | pre-commit |

`test:e2e` reuses your running `npm run dev` servers and, locally, drives your installed Google Chrome (CI uses Playwright's bundled Chromium). To use the bundled browser locally: `npx playwright install chromium` then `PW_CHANNEL=chromium npm run test:e2e`. Each run signs up a throwaway `e2e-…@example.test` user in whatever database `.env` points at.

Where to put a test:

- **Pure functions** (`src/lib/*.ts`) → `*.test.ts` next to the file. These are the cheapest tests and where routing/geometry bugs are caught.
- **Store behaviour** (`src/store/useDiagramStore.ts`) → `useDiagramStore.test.ts`. No DOM needed; drive it with `getState()` / `setState()`. Reset history between tests with `loadDiagram(...)`.
- **API routes** (`server/router.ts`) → `server/router.test.ts` using supertest with `prisma` and `requireAuth` mocked via `vi.mock`.
- **User-visible flows** → `e2e/*.spec.ts`. Prefer role/label locators; use `.react-flow__pane` / `.react-flow__node` for the canvas.

A test marked `it.fails(...)` documents a known bug from the roadmap. When you fix the bug, remove `.fails` so the test guards the fix.

## Visual check (manual)

Some things no assertion captures. Before merging a change to the canvas, toolbars, or connectors, open the app next to Whimsical and compare:

- Shape placement, resize handles, and selection ring
- Connector routing around obstacles, arrowheads, label placement
- Floating toolbar position above the selection; it must never cover the connector handles
- Alignment guides while dragging
- Keyboard shortcuts still work (V, H, R, O, D, S, T, A, X, ⌘Z, ⌘D, arrows), and `?` lists them all

## Code conventions

- TypeScript strict; `tsc -b` must pass with zero errors. No `any` — the request user is typed in `server/types.ts` and read with `authedUser(req)`.
- `oxlint` must report zero errors. Warnings are tolerated but should not grow.
- Store actions that change nodes or edges must call `pushHistory` so they are undoable.
- Edge arrowheads live on the top-level `markerStart` / `markerEnd`, not in `data` — always go through `computeMarkers`.
- A new keyboard shortcut, menu item or toolbar action is a `Command` in `src/commands/commands.ts`. The keyboard handler, the `?` cheat sheet and the right-click menus all read from that list; nothing else should hard-code a keystroke. Update the README's shortcut tables in the same commit.
- Tailwind for styling; palette tokens are in `src/index.css`.

## Roadmap

Work is tracked on the FlowSketch Roadmap (ask a maintainer for the link). Pick an unchecked item, mention it in your PR title.
