import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  MAX_ELEMENTS,
  MAX_TITLE_CHARS,
  createDiagramBody,
  diagramData,
  updateDiagramBody,
  validateBody,
} from './validation.js';

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

describe('validateBody', () => {
  const app = express();
  app.use(express.json());
  app.post('/t', validateBody(updateDiagramBody), (req, res) => {
    res.json({ body: req.body });
  });

  it('passes a valid body through, parsed', async () => {
    const res = await request(app).post('/t').send({ title: '  Plan  ' }).expect(200);
    expect(res.body).toEqual({ body: { title: 'Plan' } });
  });

  it('answers 400 with the offending issues', async () => {
    const res = await request(app).post('/t').send({ starred: 'yes' }).expect(400);
    expect(res.body.error).toBe('Invalid body');
    expect(res.body.issues).toEqual([expect.objectContaining({ path: 'starred' })]);
    expect(res.body.issues[0].message).toEqual(expect.any(String));
  });

  it('reports the path of a nested issue', async () => {
    const res = await request(app)
      .post('/t')
      .send({ data: { nodes: [{ id: 'n1', position: { x: 'nope', y: 0 } }], edges: [] } })
      .expect(400);
    expect(res.body.issues[0].path).toBe('data.nodes.0.position.x');
  });
});
