import { describe, expect, it } from 'vitest';
import { CURRENT_DIAGRAM_VERSION, migrateDiagramData } from './diagramMigrations';

/** A v0 payload: no `version`, no `type` fields, no markers — what old rows hold. */
const v0 = {
  nodes: [{ id: 'n1', position: { x: 0, y: 0 } }],
  edges: [{ id: 'e1', source: 'n1', target: 'n2', data: { stroke: '#123456', startArrow: false, endArrow: true } }],
};

describe('migrateDiagramData', () => {
  it('turns a missing or non-object payload into an empty current-version diagram', () => {
    for (const raw of [undefined, null, 'nope', 42, []]) {
      expect(migrateDiagramData(raw)).toEqual({ version: CURRENT_DIAGRAM_VERSION, nodes: [], edges: [] });
    }
  });

  it('fills in node/edge types and data bags when upgrading v0', () => {
    const migrated = migrateDiagramData(v0);
    expect(migrated.version).toBe(1);
    expect(migrated.nodes[0]).toMatchObject({ id: 'n1', type: 'shape', data: {} });
    expect(migrated.edges[0]).toMatchObject({ id: 'e1', type: 'connector' });
  });

  it('recomputes v0 arrowhead markers from edge data', () => {
    const edge = migrateDiagramData(v0).edges[0];
    expect(edge.markerEnd).toMatchObject({ color: '#123456' });
    expect(edge.markerStart).toBeUndefined();
  });

  it('treats version 0 the same as a missing version', () => {
    expect(migrateDiagramData({ ...v0, version: 0 })).toEqual(migrateDiagramData(v0));
  });

  it('keeps unknown keys so a downgrade does not lose data', () => {
    const migrated = migrateDiagramData({ ...v0, viewport: { x: 1, y: 2, zoom: 3 } }) as unknown as Record<string, unknown>;
    expect(migrated.viewport).toEqual({ x: 1, y: 2, zoom: 3 });
  });

  it('passes a current-version diagram through untouched', () => {
    const v1 = {
      version: 1,
      nodes: [{ id: 'n1', type: 'shape', position: { x: 0, y: 0 }, data: { label: 'hi' } }],
      edges: [
        {
          id: 'e1', source: 'n1', target: 'n2', type: 'connector',
          markerEnd: { type: 'arrowclosed', color: '#999999' },
          data: { stroke: '#123456', startArrow: false, endArrow: true },
        },
      ],
    };
    // The stored marker survives — a v1 writer always persists markers alongside data.
    expect(migrateDiagramData(v1)).toEqual(v1);
  });

  it('is idempotent — migrating twice equals migrating once', () => {
    const once = migrateDiagramData(v0);
    expect(migrateDiagramData(once)).toEqual(once);
  });

  it('drops entries that are not objects', () => {
    const migrated = migrateDiagramData({ nodes: ['nope', null, { id: 'n1' }], edges: 'not an array' });
    expect(migrated.nodes).toHaveLength(1);
    expect(migrated.edges).toEqual([]);
  });

  it('throws a descriptive error for a diagram from a newer version', () => {
    expect(() => migrateDiagramData({ version: CURRENT_DIAGRAM_VERSION + 1, nodes: [], edges: [] }))
      .toThrow(/newer version/i);
  });
});
