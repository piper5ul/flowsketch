# FlowSketch

A full-featured diagramming app inspired by Whimsical, built with React Flow, Zustand, and Tailwind CSS. Create flowcharts, mind maps, and diagrams with a clean, intuitive interface.

**Live Demo:** [whimsical.vedalogy.com](https://whimsical.vedalogy.com)

## Features

### Shapes
- **9 shape types** — Rectangle, Pill, Diamond, Hexagon, Cylinder, Ellipse, Triangle, Sticky Note, Text
- Drag-and-drop from the left toolbar to add shapes
- Resize any shape by dragging selection handles
- Smart alignment guides with snap-to-grid while dragging

### Connectors
- **Elbow (Manhattan) routing** with automatic obstacle avoidance
- **Straight connectors** for direct point-to-point lines
- Three line styles: solid, dashed, dotted
- Editable connector labels (click the midpoint to add a label)
- Draggable bend-point handles on elbow connectors
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
- Auto-save to server (diagrams persist across sessions)

### Collaboration-Ready Backend
- User authentication with email/password (BetterAuth)
- Email verification via configurable SMTP
- Per-user diagram dashboard
- RESTful API for diagram CRUD

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
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your database credentials:
   ```
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/flowsketch
   BETTER_AUTH_SECRET=your-random-secret-here
   BETTER_AUTH_URL=http://localhost:5173
   SMTP_HOST=localhost
   SMTP_PORT=1025
   PORT=3001
   ```

3. **Set up the database**
   ```bash
   npx prisma db push
   ```

4. **Start the dev server**
   ```bash
   npm run dev
   ```
   This starts both the Vite frontend (port 5173) and the Express API server (port 3001) concurrently.

5. **Open** [http://localhost:5173](http://localhost:5173)

### Optional: Email with MailDev

For local email verification during development:
```bash
npx maildev
```
Then open [http://localhost:1080](http://localhost:1080) to view sent emails.

## Project Structure

```
flowsketch/
├── src/
│   ├── components/      # Canvas, toolbars, color palette, alignment guides
│   ├── edges/           # Custom connector edge with Manhattan routing
│   ├── lib/             # Edge geometry, Manhattan router, color utilities
│   ├── nodes/           # Custom shape node with 9 shape types
│   ├── pages/           # Dashboard, canvas, login, signup pages
│   ├── store/           # Zustand diagram store
│   └── types.ts         # Shared TypeScript types
├── server/              # Express API server + BetterAuth
├── prisma/              # Database schema
├── shared/              # Types shared between client and server
└── public/              # Static assets
```

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

## License

MIT
