# FlowSketch

A full-featured diagramming app inspired by Whimsical, built with React Flow, Zustand, and Tailwind CSS. Create flowcharts, mind maps, and diagrams with a clean, intuitive interface.

![FlowSketch Demo](docs/screenshot.png)

## Features

### Shapes
- **9 shape types** — Rectangle, Pill, Diamond, Hexagon, Cylinder, Ellipse, Triangle, Sticky Note, Text
- Drag-and-drop from the left toolbar to add shapes
- Resize any shape by dragging selection handles
- Smart alignment guides that snap to neighboring shapes while dragging

### Connectors
- **Elbow (Manhattan) routing** with automatic obstacle avoidance
- **Straight connectors** for direct point-to-point lines
- **Curved connectors** that leave each shape square to the side they attach to
- Three line styles: solid, dashed, dotted
- Three line thicknesses: thin, regular, bold — arrowheads scale to match
- Five arrowhead styles per end: none, arrow, open, circle, diamond
- Editable connector labels (double-click a connector, use the toolbar's Add label button, or press Enter)
- Draggable bend-point handles, and a Reset route button to undo one
- Free-standing arrows that can be placed and dragged anywhere

### Text & Formatting
- Double-click any shape to edit text inline
- Multi-line text support
- **Bold**, *italic*, and font size controls (small / medium / large)
- Text alignment (left, center, right) and vertical alignment (top, middle, bottom)
- Auto-contrast text color on dark backgrounds

### Colors
- 28-color palette with quick-access swatches
- Independent fill and stroke color for each shape
- Works across all shape types including SVG-based shapes

### Canvas
- Infinite pan and zoom canvas
- Undo / redo history
- Export to PNG
- Copy, cut, paste, and duplicate selected shapes and connectors (`⌘C` / `⌘X` / `⌘V` / `⌘D`, or `⌥`-drag to duplicate)
- Lock / unlock shapes (`⌘⇧L`)
- Z-order controls: bring forward / backward, bring to front / send to back
- Copy / paste style between shapes and save a shape's fill & stroke as the default style for new shapes (`⌘⌥C`, `⌘⌥V`, `⌘⇧D`)
- Paste images from the clipboard as image shapes (`⌘V` with an image on the clipboard)
- Add hyperlinks to shapes from the floating toolbar
- Nudge selected shapes with the arrow keys (1 px, 10 px with Shift)
- Quick-add neighbor buttons on hover that create a connected shape in any direction
- Drag connector endpoints to reconnect them to other shapes
- Drag connector labels along the path to reposition them
- Right-click a shape, a connector or the canvas for a context menu of the actions that apply
- Press `?` for a cheat sheet of every keyboard shortcut, generated from the command registry
- Auto-save to server (diagrams persist across sessions)

### Collaboration-Ready Backend
- User authentication with email/password (BetterAuth)
- Email verification via configurable SMTP
- Per-user diagram dashboard
- RESTful API for diagram CRUD

## Keyboard shortcuts

On Windows and Linux use Ctrl for ⌘ and Alt for ⌥.

### Tools

| Shortcut | Tool |
|----------|------|
| `V` | Select |
| `H` | Pan |
| `R` | Rectangle |
| `O` | Ellipse |
| `D` | Diamond |
| `U` | Pill |
| `G` | Triangle |
| `X` | Hexagon |
| `Y` | Cylinder |
| `S` / `N` | Sticky note |
| `T` | Text |
| `A` / `L` | Connector |

Pressing a tool key switches to that tool; clicking or dragging on the canvas then places the shape.

### Editing

| Shortcut | Action |
|----------|--------|
| `Enter` | Edit the selected shape's text (or the selected connector's label) |
| `Escape` | Cancel / deselect and return to the Select tool |
| Double-click a shape | Edit its text inline |
| Double-click a connector label | Edit the label |
| Double-click empty canvas | Add a text shape and edit it |
| Right-click | Open the context menu for the shape, connector or canvas under the pointer |
| `Backspace` / `Delete` | Delete the selection |

### Selection & arrangement

| Shortcut | Action |
|----------|--------|
| `⌘A` | Select all shapes and connectors (locked shapes stay unselected) |
| `←` `↑` `→` `↓` | Nudge selection by 1 px |
| `⇧` + arrows | Nudge selection by 10 px |
| `]` | Bring selection to front |
| `[` | Send selection to back |
| `⌘]` | Bring selection forward |
| `⌘[` | Send selection backward |
| `⌘⇧L` | Lock / unlock selection |

### Clipboard & style

| Shortcut | Action |
|----------|--------|
| `⌘C` | Copy the selection |
| `⌘X` | Cut the selection |
| `⌘V` | Paste the selection |
| `⌘D` | Duplicate the selection (offset +30) |
| `⌥`-drag | Duplicate a shape in place while dragging |
| `⌘⌥C` | Copy the selected shape's style |
| `⌘⌥V` | Paste style onto the selection |
| `⌘⇧D` | Save the selected shape's fill/stroke as the default style for new shapes |
| `⌘⌥=` | Increase font size of the selection |
| `⌘⌥-` | Decrease font size of the selection |
| `⌘⇧C` | Copy the canvas as an image to the clipboard |

### View

| Shortcut | Action |
|----------|--------|
| `⌘Z` | Undo |
| `⌘⇧Z` | Redo |
| `⌘=` / `⌘+` | Zoom in |
| `⌘-` | Zoom out |
| `=` / `+` | Zoom in |
| `-` | Zoom out |
| `0` | Reset zoom to 100% |
| `1` | Fit all shapes in view |
| `2` | Zoom to the selection |
| `⌘0` | Fit all shapes in view |
| `Space` (hold) | Temporarily pan; releases back to the previous tool |
| `?` | Show the keyboard shortcut cheat sheet |

Every shortcut above is a single entry in the command registry (`src/commands/`), which also
generates the cheat sheet and the right-click menus — so this table, the tooltips and the app
cannot drift apart.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | React 19, TypeScript |
| Diagram Engine | React Flow (@xyflow/react) |
| State Management | Zustand |
| Styling | Tailwind CSS v4 |
| Backend | Express 5, Node.js |
| Database | PostgreSQL + Prisma ORM |
| Authentication | BetterAuth |
| Build Tool | Vite 8 |

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- (Optional) MailDev or any SMTP server for email verification

### Setup

1. **Clone and install**
   ```bash
   git clone https://github.com/piper5ul/flowsketch.git
   cd flowsketch
   npm install --legacy-peer-deps
   ```
   (`--legacy-peer-deps` works around an npm 10.9 resolver crash with this dependency set.)

2. **Start Postgres and MailDev**
   ```bash
   docker compose up -d
   ```
   Or point `.env` at your own Postgres 15+ and any SMTP server.

3. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   The defaults match `docker-compose.yml`. Set `BETTER_AUTH_SECRET` to a random string:
   ```
   DATABASE_URL=postgresql://postgres@localhost:5432/flowsketch
   BETTER_AUTH_SECRET=your-random-secret-here
   BETTER_AUTH_URL=http://localhost:5199
   SMTP_HOST=localhost
   SMTP_PORT=1025
   PORT=3001
   ```

4. **Set up the database**
   ```bash
   npx prisma db push
   ```

5. **Start the dev server**
   ```bash
   npm run dev
   ```
   This starts both the Vite frontend (port 5199) and the Express API server (port 3001) concurrently.

6. **Open** [http://localhost:5199](http://localhost:5199)

Verification and password-reset emails land in MailDev at [http://localhost:1080](http://localhost:1080). Email verification is not required to sign in.

## Testing

```bash
npm run check      # lint + typecheck + unit tests (also runs as a pre-commit hook)
npm test           # Vitest: geometry, router, store, API routes — no database needed
npm run test:e2e   # Playwright against the running app: sign-up, draw, edit, autosave, reload
```

CI runs all of the above on every pull request, with Playwright against a fresh Postgres. See [CONTRIBUTING.md](CONTRIBUTING.md) for where to put new tests and the branch/PR workflow.

## Project Structure

```
flowsketch/
├── src/
│   ├── components/      # Canvas, toolbars, color palette, alignment guides
│   ├── edges/           # Custom connector edge + its arrowhead marker defs
│   ├── lib/             # Edge geometry, Manhattan router, color utilities
│   ├── nodes/           # Custom shape node with 9 shape types
│   ├── pages/           # Dashboard, canvas, login, signup pages
│   ├── store/           # Zustand diagram store
│   └── types.ts         # Shared TypeScript types
├── server/              # Express API server + BetterAuth (+ router.test.ts)
├── e2e/                 # Playwright end-to-end tests
├── prisma/              # Database schema
├── shared/              # Types shared between client and server
└── public/              # Static assets
```

Unit tests live next to the code they cover (`src/lib/*.test.ts`, `src/store/*.test.ts`).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend + backend concurrently |
| `npm run dev:client` | Start Vite dev server only |
| `npm run dev:server` | Start Express server only |
| `npm run build` | Type-check and build for production |
| `npm run db:push` | Push Prisma schema to database |
| `npm run db:studio` | Open Prisma Studio GUI |
| `npm run lint` | Run oxlint |
| `npm run typecheck` | `tsc -b` across app, server, and tests |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright) |
| `npm run check` | Lint + typecheck + unit tests |

## License

MIT
