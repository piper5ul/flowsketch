/**
 * The document ↔ JSON conversion, which is the whole of what keeps the derived
 * snapshot honest. Everything here is pure: a `Y.Doc` in memory and a plain
 * object, no socket and no database.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DiagramData } from '../../shared/types.js';
import {
  docMeta,
  edgeEntries,
  isSeeded,
  nodeEntries,
  VIEWPORT_KEY,
} from '../../shared/collabDoc.js';
import { CURRENT_DIAGRAM_VERSION } from '../../src/lib/diagramMigrations.js';
import { docToDiagramData, seedDocFromDiagramData } from './render.js';

function node(id: string, x = 0, y = 0) {
  return {
    id,
    type: 'shape',
    position: { x, y },
    width: 180,
    height: 100,
    data: { label: id, shape: 'rectangle', fill: '#fff', stroke: '#000' },
  };
}

function edge(id: string, source: string, target: string) {
  return {
    id,
    source,
    target,
    type: 'connector',
    data: { connectorType: 'elbow', stroke: '#6B7080', startArrowStyle: 'none', endArrowStyle: 'arrow' },
  };
}

/** A diagram at the current version, so a round trip has to return it unchanged. */
function diagram(overrides: Partial<DiagramData> = {}): DiagramData {
  return {
    version: CURRENT_DIAGRAM_VERSION,
    nodes: [node('a', 10, 20), node('b', 300, 40)] as unknown as DiagramData['nodes'],
    edges: [edge('e1', 'a', 'b')] as unknown as DiagramData['edges'],
    ...overrides,
  };
}

describe('docToDiagramData', () => {
  it('renders an empty document as an empty diagram at this version', () => {
    expect(docToDiagramData(new Y.Doc())).toEqual({
      version: CURRENT_DIAGRAM_VERSION,
      nodes: [],
      edges: [],
    });
  });

  it('round-trips a diagram that is already at the current version', () => {
    const doc = new Y.Doc();
    const data = diagram();
    seedDocFromDiagramData(doc, data);
    expect(docToDiagramData(doc)).toEqual(data);
  });

  it('keeps the viewport when there is one and omits the key when there is not', () => {
    const withCamera = new Y.Doc();
    seedDocFromDiagramData(withCamera, diagram({ viewport: { x: -40, y: 12, zoom: 1.5 } }));
    expect(docToDiagramData(withCamera).viewport).toEqual({ x: -40, y: 12, zoom: 1.5 });

    const without = new Y.Doc();
    seedDocFromDiagramData(without, diagram());
    expect('viewport' in docToDiagramData(without)).toBe(false);
  });

  it('reads elements back in array order rather than in map order', () => {
    const doc = new Y.Doc();
    // Written back to front, which is what a z-order command produces: the
    // entry's `order` is the array position, not the order it was set in.
    const nodes = nodeEntries(doc);
    nodes.set('b', { order: 1, value: node('b') as never });
    nodes.set('a', { order: 0, value: node('a') as never });
    expect(docToDiagramData(doc).nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('breaks a tie on order by id, so every window draws the same board', () => {
    const doc = new Y.Doc();
    const nodes = nodeEntries(doc);
    nodes.set('z', { order: 0, value: node('z') as never });
    nodes.set('a', { order: 0, value: node('a') as never });
    expect(docToDiagramData(doc).nodes.map((n) => n.id)).toEqual(['a', 'z']);
  });

  it('drops an entry written by something that does not speak this format', () => {
    const doc = new Y.Doc();
    const nodes = nodeEntries(doc);
    nodes.set('a', { order: 0, value: node('a') as never });
    // No `order`, so not one of ours — a build that stored the node bare.
    nodes.set('junk', node('junk') as never);
    expect(docToDiagramData(doc).nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('ignores a viewport the document holds in a shape React Flow could not use', () => {
    const doc = new Y.Doc();
    docMeta(doc).set(VIEWPORT_KEY, { x: 1, y: 2 });
    expect('viewport' in docToDiagramData(doc)).toBe(false);
  });
});

describe('seedDocFromDiagramData', () => {
  it('migrates a legacy row on the way in rather than stamping it as current', () => {
    const doc = new Y.Doc();
    // v0: no version, no `type` discriminators, no data bag.
    seedDocFromDiagramData(doc, {
      nodes: [{ id: 'a', position: { x: 0, y: 0 } }],
      edges: [{ id: 'e1', source: 'a', target: 'a', data: { endArrow: false } }],
    });

    const rendered = docToDiagramData(doc);
    expect(rendered.version).toBe(CURRENT_DIAGRAM_VERSION);
    expect(rendered.nodes[0]).toMatchObject({ id: 'a', type: 'shape', data: {} });
    // v1 -> v2 turns the booleans into styles and recomputes the arrowheads.
    expect(rendered.edges[0].data).toMatchObject({ startArrowStyle: 'none', endArrowStyle: 'none' });
    expect(rendered.edges[0]).not.toHaveProperty('markerEnd');
  });

  it('marks the document seeded, so an empty diagram is not seeded twice', () => {
    const doc = new Y.Doc();
    expect(isSeeded(doc)).toBe(false);
    seedDocFromDiagramData(doc, { version: CURRENT_DIAGRAM_VERSION, nodes: [], edges: [] });
    expect(isSeeded(doc)).toBe(true);
  });

  it('replaces what the document held rather than merging into it', () => {
    const doc = new Y.Doc();
    seedDocFromDiagramData(doc, diagram());
    seedDocFromDiagramData(doc, {
      version: CURRENT_DIAGRAM_VERSION,
      nodes: [node('c', 5, 5)],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 2 },
    });

    const rendered = docToDiagramData(doc);
    expect(rendered.nodes.map((n) => n.id)).toEqual(['c']);
    expect(rendered.edges).toEqual([]);
    expect(nodeEntries(doc).size).toBe(1);
    expect(edgeEntries(doc).size).toBe(0);
    expect(rendered.viewport).toEqual({ x: 0, y: 0, zoom: 2 });
  });

  it('is one transaction, so a peer never sees the old board half-dismantled', () => {
    const doc = new Y.Doc();
    seedDocFromDiagramData(doc, diagram());

    let transactions = 0;
    doc.on('afterTransaction', () => { transactions += 1; });
    seedDocFromDiagramData(doc, { version: CURRENT_DIAGRAM_VERSION, nodes: [node('c')], edges: [] });
    expect(transactions).toBe(1);
  });

  it('refuses a row from a newer build rather than seeding a document from it', () => {
    expect(() =>
      seedDocFromDiagramData(new Y.Doc(), { version: CURRENT_DIAGRAM_VERSION + 1, nodes: [], edges: [] }),
    ).toThrow(/newer version/);
  });

  it('carries the origin it was given, so the writer can tell its own change apart', () => {
    const doc = new Y.Doc();
    const origin = Symbol('restore');
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: Y.Transaction) => origins.push(transaction.origin));
    seedDocFromDiagramData(doc, diagram(), origin);
    expect(origins).toEqual([origin]);
  });
});
