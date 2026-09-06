import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serveForFile } from './testServer.js';
import {
  MAX_ELEMENTS,
  MAX_EMAIL_CHARS,
  MAX_TITLE_CHARS,
  addMemberBody,
  copyTitle,
  createDiagramBody,
  diagramData,
  updateDiagramBody,
  validateBody,
} from './validation.js';
import { MAX_THUMBNAIL_CHARS, THUMBNAIL_DATA_URL_PREFIX } from '../shared/types.js';

/** The shape the client actually serializes (see `serializeNodes` in the store). */
const node = { id: 'n1', type: 'shape', position: { x: 1, y: 2 }, width: 120, height: 60, data: { label: 'Hi' } };
const edge = { id: 'e1', source: 'n1', target: 'n2', type: 'connector', sourceHandle: null, targetHandle: null };

describe('diagramData', () => {
  it('accepts a serialized diagram', () => {
    expect(diagramData.safeParse({ nodes: [node], edges: [edge] }).success).toBe(true);
  });

  it('keeps unknown keys instead of silently dropping them', () => {
    const parsed = diagramData.parse({
      nodes: [{ ...node, data: { label: 'Hi', futureField: 7 } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(parsed).toMatchObject({
      nodes: [{ data: { futureField: 7 } }],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
  });

  it('accepts and keeps the format version the client stamps on the payload', () => {
    const parsed = diagramData.parse({ version: 1, nodes: [node], edges: [edge] });
    expect(parsed).toMatchObject({ version: 1 });
  });

  it('rejects nodes that are not an array', () => {
    expect(diagramData.safeParse({ nodes: 'nope', edges: [] }).success).toBe(false);
  });

  it('rejects a node without an id', () => {
    const { id: _id, ...idless } = node;
    expect(diagramData.safeParse({ nodes: [idless], edges: [] }).success).toBe(false);
  });

  it('rejects a node id longer than 64 characters', () => {
    expect(diagramData.safeParse({ nodes: [{ ...node, id: 'x'.repeat(65) }], edges: [] }).success).toBe(false);
  });

  it('rejects a node whose position is not numeric', () => {
    expect(diagramData.safeParse({ nodes: [{ ...node, position: { x: '1', y: 2 } }], edges: [] }).success).toBe(false);
  });

  it(`rejects more than ${MAX_ELEMENTS} nodes`, () => {
    const nodes = Array.from({ length: MAX_ELEMENTS + 1 }, (_, i) => ({ ...node, id: `n${i}` }));
    expect(diagramData.safeParse({ nodes, edges: [] }).success).toBe(false);
    expect(diagramData.safeParse({ nodes: nodes.slice(0, MAX_ELEMENTS), edges: [] }).success).toBe(true);
  });

  it(`rejects more than ${MAX_ELEMENTS} edges`, () => {
    const edges = Array.from({ length: MAX_ELEMENTS + 1 }, (_, i) => ({ ...edge, id: `e${i}` }));
    expect(diagramData.safeParse({ nodes: [], edges }).success).toBe(false);
  });
});

describe('createDiagramBody', () => {
  it('accepts an empty body, a title alone, and a title with data', () => {
    expect(createDiagramBody.safeParse({}).success).toBe(true);
    expect(createDiagramBody.safeParse({ title: 'Plan' }).success).toBe(true);
    expect(createDiagramBody.safeParse({ title: 'Plan', data: { nodes: [node], edges: [] } }).success).toBe(true);
  });

  it('trims the title', () => {
    expect(createDiagramBody.parse({ title: '  Plan  ' })).toEqual({ title: 'Plan' });
  });

  it(`rejects a title longer than ${MAX_TITLE_CHARS} characters`, () => {
    expect(createDiagramBody.safeParse({ title: 'x'.repeat(MAX_TITLE_CHARS + 1) }).success).toBe(false);
    expect(createDiagramBody.safeParse({ title: 'x'.repeat(MAX_TITLE_CHARS) }).success).toBe(true);
  });

  it('rejects a title that is empty once trimmed', () => {
    expect(createDiagramBody.safeParse({ title: '   ' }).success).toBe(false);
    expect(createDiagramBody.safeParse({ title: '' }).success).toBe(false);
  });

  it('rejects a non-string title and non-object data', () => {
    expect(createDiagramBody.safeParse({ title: 7 }).success).toBe(false);
    expect(createDiagramBody.safeParse({ data: 'nodes' }).success).toBe(false);
  });
});

describe('updateDiagramBody', () => {
  it('accepts any single known key', () => {
    expect(updateDiagramBody.safeParse({ title: 'Plan' }).success).toBe(true);
    expect(updateDiagramBody.safeParse({ data: { nodes: [], edges: [] } }).success).toBe(true);
    expect(updateDiagramBody.safeParse({ starred: true }).success).toBe(true);
  });

  it('rejects a body with no known key', () => {
    expect(updateDiagramBody.safeParse({}).success).toBe(false);
    expect(updateDiagramBody.safeParse({ nope: 1 }).success).toBe(false);
  });

  it('rejects a non-boolean starred', () => {
    expect(updateDiagramBody.safeParse({ starred: 'yes' }).success).toBe(false);
  });
});

describe('updateDiagramBody — thumbnail', () => {
  const png = `${THUMBNAIL_DATA_URL_PREFIX}iVBORw0KGgo=`;

  it('accepts a PNG data URL', () => {
    expect(updateDiagramBody.safeParse({ thumbnail: png }).success).toBe(true);
  });

  it('accepts null, which clears the stored thumbnail', () => {
    expect(updateDiagramBody.safeParse({ thumbnail: null }).success).toBe(true);
  });

  it('rejects anything that is not a base64 PNG data URL', () => {
    for (const thumbnail of [
      'data:image/jpeg;base64,/9j/4AAQ',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'https://example.test/thumb.png',
      'iVBORw0KGgo=',
      7,
    ]) {
      expect(updateDiagramBody.safeParse({ thumbnail }).success).toBe(false);
    }
  });

  it(`rejects a thumbnail longer than ${MAX_THUMBNAIL_CHARS} characters`, () => {
    const pad = MAX_THUMBNAIL_CHARS - THUMBNAIL_DATA_URL_PREFIX.length;
    const atLimit = THUMBNAIL_DATA_URL_PREFIX + 'A'.repeat(pad);
    expect(updateDiagramBody.safeParse({ thumbnail: atLimit }).success).toBe(true);
    expect(updateDiagramBody.safeParse({ thumbnail: `${atLimit}A` }).success).toBe(false);
  });
});

describe('copyTitle', () => {
  it('suffixes the original title', () => {
    expect(copyTitle('Roadmap')).toBe('Roadmap (copy)');
  });

  it('suffixes a copy again rather than collapsing the chain', () => {
    expect(copyTitle('Roadmap (copy)')).toBe('Roadmap (copy) (copy)');
  });

  it('trims the original so the copy still fits the title limit', () => {
    const copy = copyTitle('x'.repeat(MAX_TITLE_CHARS));
    expect(copy).toHaveLength(MAX_TITLE_CHARS);
    expect(copy.endsWith(' (copy)')).toBe(true);
    // And the result is a title the API would accept back.
    expect(createDiagramBody.safeParse({ title: copy }).success).toBe(true);
  });
});

describe('validateBody', () => {
  const app = express();
  app.use(express.json());
  app.post('/t', validateBody(updateDiagramBody), (req, res) => {
    res.json({ body: req.body });
  });
  // One port for this suite — see `testServer.ts`.
  const server = serveForFile(app);

  it('passes a valid body through, parsed', async () => {
    const res = await request(server).post('/t').send({ title: '  Plan  ' }).expect(200);
    expect(res.body).toEqual({ body: { title: 'Plan' } });
  });

  it('answers 400 with the offending issues', async () => {
    const res = await request(server).post('/t').send({ starred: 'yes' }).expect(400);
    expect(res.body.error).toBe('Invalid body');
    expect(res.body.issues).toEqual([expect.objectContaining({ path: 'starred' })]);
    expect(res.body.issues[0].message).toEqual(expect.any(String));
  });

  it('reports the path of a nested issue', async () => {
    const res = await request(server)
      .post('/t')
      .send({ data: { nodes: [{ id: 'n1', position: { x: 'nope', y: 0 } }], edges: [] } })
      .expect(400);
    expect(res.body.issues[0].path).toBe('data.nodes.0.position.x');
  });
});

describe('addMemberBody', () => {
  it('normalises the address the way accounts store it', () => {
    const parsed = addMemberBody.parse({ email: '  U2@Example.Test ', role: 'editor' });
    expect(parsed).toEqual({ email: 'u2@example.test', role: 'editor' });
  });

  it('rejects an address that is not one, or is longer than the RFC allows', () => {
    expect(addMemberBody.safeParse({ email: 'not-an-email', role: 'viewer' }).success).toBe(false);
    const long = `${'a'.repeat(MAX_EMAIL_CHARS)}@example.test`;
    expect(addMemberBody.safeParse({ email: long, role: 'viewer' }).success).toBe(false);
  });

  it('accepts only the roles an invitation can grant', () => {
    expect(addMemberBody.safeParse({ email: 'a@b.test', role: 'editor' }).success).toBe(true);
    expect(addMemberBody.safeParse({ email: 'a@b.test', role: 'viewer' }).success).toBe(true);
    // Ownership is not transferable, so it is not something to invite someone as.
    expect(addMemberBody.safeParse({ email: 'a@b.test', role: 'owner' }).success).toBe(false);
  });

  it('requires both fields, and refuses any extra one', () => {
    expect(addMemberBody.safeParse({ email: 'a@b.test' }).success).toBe(false);
    expect(addMemberBody.safeParse({ role: 'viewer' }).success).toBe(false);
    expect(addMemberBody.safeParse({ email: 'a@b.test', role: 'viewer', diagramId: 'x' }).success).toBe(false);
  });
});
