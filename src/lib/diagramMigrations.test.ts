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
    expect(migrated.version).toBe(CURRENT_DIAGRAM_VERSION);
    expect(migrated.nodes[0]).toMatchObject({ id: 'n1', type: 'shape', data: {} });
    expect(migrated.edges[0]).toMatchObject({ id: 'e1', type: 'connector' });
  });

  it('recomputes v0 arrowhead markers from edge data', () => {
    const edge = migrateDiagramData(v0).edges[0];
    expect(edge.markerEnd).toContain('123456');
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
    const current = {
      version: CURRENT_DIAGRAM_VERSION,
      nodes: [{ id: 'n1', type: 'shape', position: { x: 0, y: 0 }, data: { label: 'hi' } }],
      edges: [
        {
          id: 'e1', source: 'n1', target: 'n2', type: 'connector',
          markerEnd: 'whatever-this-build-wrote',
          data: { stroke: '#123456', startArrowStyle: 'none', endArrowStyle: 'circle' },
        },
      ],
    };
    // The stored marker survives — a writer always persists markers alongside data.
    expect(migrateDiagramData(current)).toEqual(current);
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

  describe('v1 -> v2: arrowhead booleans become styles', () => {
    /** A v1 edge, with `data` overridden by `patch`. */
    function v1Edge(patch: Record<string, unknown>) {
      return {
        version: 1,
        nodes: [],
        edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'connector', data: { stroke: '#123456', ...patch } }],
      };
    }

    it('turns a shown arrow into the plain arrowhead and a hidden one into none', () => {
      const { data } = migrateDiagramData(v1Edge({ startArrow: true, endArrow: false })).edges[0]!;
      expect(data).toMatchObject({ startArrowStyle: 'arrow', endArrowStyle: 'none' });
    });

    it('reads the app defaults for a v1 edge that never wrote the flags', () => {
      const { data } = migrateDiagramData(v1Edge({})).edges[0]!;
      expect(data).toMatchObject({ startArrowStyle: 'none', endArrowStyle: 'arrow' });
    });

    it('drops the booleans it replaced, so nothing can read them again', () => {
      const { data } = migrateDiagramData(v1Edge({ startArrow: true, endArrow: true })).edges[0]!;
      expect(data).not.toHaveProperty('startArrow');
      expect(data).not.toHaveProperty('endArrow');
    });

    it('repoints the markers at the styles it just wrote', () => {
      const edge = migrateDiagramData(v1Edge({ startArrow: true, endArrow: false })).edges[0]!;
      expect(edge.markerStart).toContain('arrow');
      expect(edge.markerStart).toContain('123456');
      expect(edge.markerEnd).toBeUndefined();
    });

    it('leaves the rest of an edge alone', () => {
      const { data } = migrateDiagramData(v1Edge({ label: 'yes', connectorType: 'curved' })).edges[0]!;
      expect(data).toMatchObject({ label: 'yes', connectorType: 'curved', stroke: '#123456' });
    });

    it('is idempotent — migrating twice equals migrating once', () => {
      const once = migrateDiagramData(v1Edge({ startArrow: true, endArrow: false }));
      expect(migrateDiagramData(once)).toEqual(once);
    });
  });

  it('leaves a payload that has no viewport without one', () => {
    // Every diagram written before the viewport was stored, which is all of
    // them: the canvas has to fall back to framing the content itself.
    expect(migrateDiagramData(v0).viewport).toBeUndefined();
  });

  it('carries a stored viewport through untouched', () => {
    const viewport = { x: -40, y: 12, zoom: 1.25 };
    expect(migrateDiagramData({ ...v0, viewport }).viewport).toEqual(viewport);
  });

  it('drops a viewport that is not three finite numbers', () => {
    // `data` is a free-form JSON column, and this value is handed straight to
    // React Flow as its `defaultViewport`.
    const broken = ['nope', null, 42, { x: 1, y: 2 }, { x: 1, y: 2, zoom: '3' }, { x: NaN, y: 0, zoom: 1 }];
    for (const viewport of broken) {
      expect(migrateDiagramData({ ...v0, viewport }).viewport, JSON.stringify(viewport)).toBeUndefined();
    }
  });

  it('throws a descriptive error for a diagram from a newer version', () => {
    expect(() => migrateDiagramData({ version: CURRENT_DIAGRAM_VERSION + 1, nodes: [], edges: [] }))
      .toThrow(/newer version/i);
  });
});
