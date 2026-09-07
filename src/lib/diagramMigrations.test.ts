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

  it('leaves a container node its own type rather than calling it a shape', () => {
    // The v0 step fills in a missing `type`; it must not overwrite one that is
    // there, or every group and frame in an unversioned row would come back as
    // a rectangle-shaped node with no renderer.
    const migrated = migrateDiagramData({
      nodes: [
        { id: 'g', type: 'group', position: { x: 0, y: 0 } },
        { id: 'f', type: 'frame', position: { x: 0, y: 0 }, data: { label: 'Frame' } },
      ],
      edges: [],
    });
    expect(migrated.nodes.map((n) => n.type)).toEqual(['group', 'frame']);
  });

  it('carries parentId and extent through every step', () => {
    for (const version of [undefined, 1, 2, CURRENT_DIAGRAM_VERSION]) {
      const migrated = migrateDiagramData({
        ...(version === undefined ? {} : { version }),
        nodes: [
          { id: 'g', type: 'group', position: { x: 0, y: 0 } },
          { id: 'c', type: 'shape', position: { x: 5, y: 5 }, parentId: 'g', extent: 'parent', data: {} },
        ],
        edges: [],
      });
      expect(migrated.nodes[1]).toMatchObject({ parentId: 'g', extent: 'parent' });
    }
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
    // Everything passes through except the marker ids, which are derived from
    // the data on every load so a stored id can never be stale.
    const out = migrateDiagramData(current);
    const { markerEnd, ...edge } = out.edges[0];
    expect({ ...out, edges: [edge] }).toEqual({ ...current, edges: [{ ...current.edges[0], markerEnd: undefined }] });
    expect(markerEnd).toContain('fs-circle-123456');
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

  describe('v2 -> v3: the one bend becomes a list of them', () => {
    /** A v2 edge, with `data` overridden by `patch`. */
    function v2Edge(patch: Record<string, unknown>) {
      return {
        version: 2,
        nodes: [],
        edges: [{
          id: 'e1', source: 'n1', target: 'n2', type: 'connector',
          data: { stroke: '#123456', startArrowStyle: 'none', endArrowStyle: 'arrow', ...patch },
        }],
      };
    }

    it('carries a dragged bend over as the one entry of the list', () => {
      const { data } = migrateDiagramData(v2Edge({ waypoint: { x: 40, y: 90 } })).edges[0]!;
      expect(data).toMatchObject({ waypoints: [{ x: 40, y: 90 }] });
    });

    it('drops the key it replaced, so nothing can read the old bend again', () => {
      const { data } = migrateDiagramData(v2Edge({ waypoint: { x: 40, y: 90 } })).edges[0]!;
      expect(data).not.toHaveProperty('waypoint');
    });

    it('leaves a connector nobody has bent without a list at all', () => {
      for (const patch of [{ waypoint: null }, {}]) {
        const { data } = migrateDiagramData(v2Edge(patch)).edges[0]!;
        expect(data, JSON.stringify(patch)).not.toHaveProperty('waypoints');
        expect(data).not.toHaveProperty('waypoint');
      }
    });

    it('drops a bend that is not a pair of finite numbers', () => {
      // `data` is a free-form JSON column; a half-written point would be fed
      // to the router as a vertex.
      for (const waypoint of ['nope', 42, [], { x: 1 }, { x: 1, y: '2' }, { x: NaN, y: 0 }]) {
        const { data } = migrateDiagramData(v2Edge({ waypoint })).edges[0]!;
        expect(data, JSON.stringify(waypoint)).not.toHaveProperty('waypoints');
      }
    });

    it('leaves the rest of an edge alone', () => {
      const edge = migrateDiagramData(v2Edge({ waypoint: { x: 1, y: 2 }, label: 'yes' })).edges[0]!;
      expect(edge).toMatchObject({ id: 'e1', source: 'n1', target: 'n2', type: 'connector' });
      expect(edge.data).toMatchObject({ label: 'yes', stroke: '#123456', endArrowStyle: 'arrow' });
    });

    it('is idempotent — migrating twice equals migrating once', () => {
      const once = migrateDiagramData(v2Edge({ waypoint: { x: 40, y: 90 } }));
      expect(migrateDiagramData(once)).toEqual(once);
    });

    it('carries a v0 bend all the way through to the list', () => {
      const { data } = migrateDiagramData({
        nodes: [],
        edges: [{ id: 'e1', source: 'n1', target: 'n2', data: { stroke: '#123456', waypoint: { x: 7, y: 8 } } }],
      }).edges[0]!;
      expect(data).toMatchObject({ waypoints: [{ x: 7, y: 8 }], endArrowStyle: 'arrow' });
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

  it('leaves a payload that has no board defaults without any', () => {
    // Every diagram written before ⌘⇧D existed: absent means "no board
    // defaults", which is why this needed no version of its own.
    expect('defaults' in migrateDiagramData(v0)).toBe(false);
  });

  it('carries stored board defaults through, narrowed to style', () => {
    const migrated = migrateDiagramData({
      ...v0,
      defaults: {
        shape: { fill: '#FF0000', label: 'no', locked: true, imageSrc: '/api/images/abc' },
        connector: { strokeWidth: 3, waypoints: [{ x: 1, y: 2 }] },
      },
    });
    expect(migrated.defaults).toEqual({ shape: { fill: '#FF0000' }, connector: { strokeWidth: 3 } });
  });

  it('drops a defaults value nothing could act on', () => {
    for (const defaults of ['nope', null, 42, [], { shape: 'red' }, { shape: { label: 'no' } }]) {
      expect('defaults' in migrateDiagramData({ ...v0, defaults }), JSON.stringify(defaults)).toBe(false);
    }
  });

  it('throws a descriptive error for a diagram from a newer version', () => {
    expect(() => migrateDiagramData({ version: CURRENT_DIAGRAM_VERSION + 1, nodes: [], edges: [] }))
      .toThrow(/newer version/i);
  });
});

describe('marker ids are recomputed on every load', () => {
  const edge = (over: Record<string, unknown>) => ({
    id: 'e', source: 'a', target: 'b', type: 'connector',
    data: { connectorType: 'elbow', stroke: '#ABCDEF', strokeStyle: 'solid', label: '', startArrowStyle: 'none', endArrowStyle: 'arrow' },
    ...over,
  });
  const load = (e: Record<string, unknown>) => migrateDiagramData({ version: CURRENT_DIAGRAM_VERSION, nodes: [], edges: [e] }).edges[0];

  it('gives a current-format edge saved without ids the arrowheads its data asks for', () => {
    const out = load(edge({}));
    expect(out.markerEnd).toContain('fs-arrow-ABCDEF');
    expect(out.markerStart).toBeUndefined();
  });

  it('repoints an id from an older build at this build’s defs', () => {
    const out = load(edge({ markerEnd: 'fs-arrow-ABCDEF-10' }));
    expect(out.markerEnd).toContain('fs-arrow-ABCDEF');
    expect(out.markerEnd).not.toBe('fs-arrow-ABCDEF-10');
  });

  it('drops an id the data no longer wants', () => {
    const out = load(edge({ markerEnd: 'fs-arrow-ABCDEF-10', data: { connectorType: 'elbow', stroke: '#ABCDEF', strokeStyle: 'solid', label: '', startArrowStyle: 'none', endArrowStyle: 'none' } }));
    expect(out.markerEnd).toBeUndefined();
  });
});
