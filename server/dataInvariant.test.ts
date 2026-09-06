/**
 * The phase-2 invariant from `docs/realtime.md`: **anything that writes diagram
 * content writes the `Y.Doc`, never `Diagram.data` directly.** The JSON column
 * is output.
 *
 * The risk the design names is dual-write drift — while the document and the
 * snapshot coexist, a path that writes JSON behind the document's back
 * desynchronizes the two, and the next `store` renders the document straight
 * back over it, so the write is lost as well as wrong. Two tests guard it:
 *
 * - a source scan, so a *new* module cannot start writing the `Diagram` table
 *   without this list being reconsidered;
 * - the rule itself, on the one route that still takes a whole copy of a board
 *   — `PUT /api/diagrams/:id`, which is what a diagram nobody has ever opened
 *   collaboratively is still saved by.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import type { AuthUser } from './types.js';
import { serveForFile } from './testServer.js';

/**
 * The modules allowed to write **`Diagram.data`**, and why.
 *
 * `collab.ts` is the snapshot renderer — the only place a document becomes
 * JSON. `router.ts` holds the create/import, the duplicate and the guarded
 * `PUT`. `versions.ts` holds the restore, which writes JSON server-side and is
 * re-seeded into the document by the client that asked for it. Adding a fourth
 * name here is a decision about the invariant, which is exactly why it has to
 * be made in this file.
 */
const MAY_WRITE_DIAGRAM_DATA = ['collab.ts', 'router.ts', 'versions.ts'];

/**
 * …and the modules allowed to write the `Diagram` row at all. Broader on
 * purpose: it catches a new module writing the table in some shape the scan
 * below does not recognise. `sharing.ts` is here and not above because a share
 * token is a column of its own, which the document has no opinion about.
 */
const MAY_WRITE_DIAGRAMS = [...MAY_WRITE_DIAGRAM_DATA, 'sharing.ts'];

/** Any Prisma call that could put something in the `Diagram` table. */
const WRITES_DIAGRAM = /prisma\.diagram\.(?:create|update|updateMany|upsert)\s*\(/g;

function serverSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return serverSources(full);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    return [full];
  });
}

/**
 * The balanced span starting at `open` (which must be the bracket itself).
 *
 * A regex cannot find the end of a Prisma call argument, and the difference
 * between "this write carries a board" and "this write carries a title" is
 * exactly one level of nesting — so the scan reads the brackets rather than
 * guessing at them. Strings are not modelled: no payload in this codebase puts
 * a bracket in one.
 */
function balanced(source: string, open: number): string {
  const closing = source[open] === '(' ? ')' : '}';
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === source[open]) depth += 1;
    else if (source[i] === closing) {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced source');
}

/** True when some `prisma.diagram.*` write in `source` sets the `data` column. */
function writesDiagramData(source: string): boolean {
  for (const match of source.matchAll(WRITES_DIAGRAM)) {
    const args = balanced(source, match.index + match[0].length - 1);
    // The Prisma payload: `{ where: …, data: { <columns> } }`.
    const payload = args.indexOf('data:');
    if (payload === -1) continue;
    const columns = balanced(args, args.indexOf('{', payload));
    // A `data` column, whether written long-hand or as a shorthand property.
    if (/(?:^|[{,\s])data\s*[,:}]/.test(columns)) return true;
  }
  return false;
}

describe('the JSON snapshot is written from one place', () => {
  it('is written by no server module but the three that are allowed to', () => {
    const root = path.join(import.meta.dirname);
    const writers = serverSources(root)
      .filter((file) => writesDiagramData(readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file))
      .sort();

    expect(writers).toEqual([...MAY_WRITE_DIAGRAM_DATA].sort());
  });

  it('leaves the `Diagram` row itself to those three and to sharing', () => {
    const root = path.join(import.meta.dirname);
    const writers = serverSources(root)
      // A fresh matcher per file: `WRITES_DIAGRAM` is global, and `test` on a
      // global regex resumes from where the last call left off.
      .filter((file) => new RegExp(WRITES_DIAGRAM.source).test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file))
      .sort();

    expect(writers).toEqual([...MAY_WRITE_DIAGRAMS].sort());
  });

  it('is rendered from the document by the collaboration server, not sent by a client', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'collab.ts'), 'utf8');
    // The one `Diagram` write in that file takes what `docToDiagramData`
    // produced; nothing in it reads a body.
    expect(source).toContain('const data = docToDiagramData(document);');
    expect(source).toContain('data: { data: data as object }');
  });
});

// ---------------------------------------------------------------------------
// The rule on the one route that still accepts a whole copy of a board.
// ---------------------------------------------------------------------------

const { prismaMock, authState } = vi.hoisted(() => ({
  prismaMock: {
    diagram: { findFirst: vi.fn(), update: vi.fn() },
    diagramDoc: { findUnique: vi.fn() },
    diagramVersion: { findFirst: vi.fn(), findMany: vi.fn() },
    diagramImage: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    image: { findMany: vi.fn() },
    folder: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  authState: { user: null as AuthUser | null },
}));

vi.mock('./db.js', () => ({ prisma: prismaMock }));
vi.mock('./middleware.js', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = authState.user!;
    next();
  },
}));

const { apiRouter } = await import('./router.js');

const app = express();
app.use('/api', express.json({ limit: '5mb' }));
app.use('/api', apiRouter);
const server = await serveForFile(app);

const OWNED = { id: 'd1', userId: 'u1', title: 'Mine', data: { nodes: [], edges: [] } };
const BOARD = { version: 3, nodes: [], edges: [] };

beforeEach(() => {
  vi.resetAllMocks();
  authState.user = { id: 'u1' } as AuthUser;
  prismaMock.diagram.findFirst.mockResolvedValue({ ...OWNED, updatedAt: new Date(0) });
  prismaMock.diagram.update.mockResolvedValue({ ...OWNED, updatedAt: new Date(1) });
  prismaMock.diagramVersion.findFirst.mockResolvedValue({ createdAt: new Date() });
  prismaMock.diagramVersion.findMany.mockResolvedValue([]);
  prismaMock.diagramImage.findMany.mockResolvedValue([]);
  prismaMock.image.findMany.mockResolvedValue([]);
  prismaMock.$transaction.mockImplementation(async (ops: unknown) => Promise.all(ops as unknown[]));
});

describe('PUT /api/diagrams/:id and the live document', () => {
  it('still saves a diagram nobody has opened collaboratively', async () => {
    prismaMock.diagramDoc.findUnique.mockResolvedValue(null);

    await request(server).put('/api/diagrams/d1').send({ data: BOARD }).expect(200);

    expect(prismaMock.diagram.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { data: BOARD },
    });
  });

  it('refuses a whole-copy write to a diagram that has a document', async () => {
    prismaMock.diagramDoc.findUnique.mockResolvedValue({ diagramId: 'd1' });

    const res = await request(server)
      .put('/api/diagrams/d1')
      .send({ title: 'Renamed', data: BOARD })
      .expect(409);

    // Nothing is written — not even the title that came with it. A body built
    // on a board this client no longer has is not half-applied.
    expect(res.body).toMatchObject({ error: 'Conflict' });
    expect(prismaMock.diagram.update).not.toHaveBeenCalled();
  });

  it('keeps taking the columns the document has no opinion about', async () => {
    prismaMock.diagramDoc.findUnique.mockResolvedValue({ diagramId: 'd1' });

    // The thumbnail is the one write `CanvasPage` still makes for a
    // collaborative diagram: it is a picture of the board, not the board.
    await request(server)
      .put('/api/diagrams/d1')
      .send({ title: 'Renamed', starred: true, thumbnail: null })
      .expect(200);

    expect(prismaMock.diagram.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { title: 'Renamed', starred: true, thumbnail: null },
    });
    // Not even looked up: the question is only asked of a write that carries a
    // board, so a rename costs a collaborative diagram nothing.
    expect(prismaMock.diagramDoc.findUnique).not.toHaveBeenCalled();
  });
});
