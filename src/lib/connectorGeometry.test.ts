import { describe, expect, it } from 'vitest';
import { boardGeometry, connectorGeometry, type GeometryNode } from './connectorGeometry';
import { orthoRoute, type RouteMemo } from './orthoRouter';
import { makeEdgeData } from './defaults';

const shape = (id: string, x: number, y: number, extra: Partial<GeometryNode> = {}): GeometryNode => ({
  id,
  type: 'shape',
  position: { x, y },
  width: 120,
  height: 60,
  data: { shape: 'rectangle', fill: '#DBEAFE', stroke: '#93C5FD' },
  ...extra,
});

const edgeData = {
  ...makeEdgeData('elbow'),
  sourceAnchor: { side: 'right' as const, t: 0.5 },
  targetAnchor: { side: 'left' as const, t: 0.5 },
};

describe('boardGeometry', () => {
  it('is computed once per node array', () => {
    const nodes = [shape('a', 0, 0), shape('b', 300, 0)];
    expect(boardGeometry(nodes)).toBe(boardGeometry(nodes));
    expect(boardGeometry([...nodes])).not.toBe(boardGeometry(nodes));
  });

  it('measures a child on the board and leaves groups, anchors and hidden nodes out of the obstacles', () => {
    const nodes = [
      shape('frame', 100, 100, { type: 'frame' }),
      shape('child', 10, 20, { parentId: 'frame' }),
      shape('group', 0, 0, { type: 'group' }),
      shape('anchor', 500, 500, { width: 1, height: 1, data: { shape: 'rectangle', fill: 'transparent', stroke: 'transparent' } }),
      shape('folded', 600, 0, { hidden: true }),
    ];
    const board = boardGeometry(nodes);
    expect(board.rectOf(nodes[1])).toEqual({ x: 110, y: 120, width: 120, height: 60 });
    expect(board.obstacles.map((o) => o.id)).toEqual(['frame', 'child']);
  });
});

describe('connectorGeometry', () => {
  it('is null while either end is missing', () => {
    const memo = { current: null as RouteMemo | null };
    expect(connectorGeometry([shape('a', 0, 0)], 'a', 'b', edgeData, memo)).toBeNull();
  });

  it('routes an elbow round the board exactly as orthoRoute does', () => {
    const nodes = [shape('a', 0, 0), shape('b', 600, 0), shape('wall', 280, -100, { height: 260 })];
    const memo = { current: null as RouteMemo | null };
    const g = connectorGeometry(nodes, 'a', 'b', edgeData, memo)!;
    // Standoff 6 px, plus the arrowhead's depth at the target end.
    expect(g.sx).toBe(126);
    expect(g.sourceSide).toBe('right');
    expect(g.routed).toEqual(
      orthoRoute({
        source: { x: g.sx, y: g.sy },
        sourceSide: 'right',
        sourceRect: { x: 0, y: 0, width: 120, height: 60 },
        target: { x: g.tx, y: g.ty },
        targetSide: 'left',
        targetRect: { x: 600, y: 0, width: 120, height: 60 },
        obstacles: [{ x: 280, y: -100, width: 120, height: 260 }],
        vertices: [],
      }),
    );
    expect(g.routed!.length).toBeGreaterThan(0);
  });

  it('keeps the same route array when a shape far away moves, and a new one when a near one does', () => {
    const memo = { current: null as RouteMemo | null };
    const base = [shape('a', 0, 0), shape('b', 600, 0), shape('far', 3000, 3000)];
    const first = connectorGeometry(base, 'a', 'b', edgeData, memo)!;
    const moved = [base[0], base[1], shape('far', 3100, 3000)];
    const second = connectorGeometry(moved, 'a', 'b', edgeData, memo)!;
    expect(second.routed).toBe(first.routed);
    const blocking = [base[0], base[1], shape('far', 280, -100, { height: 260 })];
    const third = connectorGeometry(blocking, 'a', 'b', edgeData, memo)!;
    expect(third.routed).not.toEqual(first.routed);
  });

  it('does not route a straight connector', () => {
    const memo = { current: null as RouteMemo | null };
    const g = connectorGeometry([shape('a', 0, 0), shape('b', 600, 0)], 'a', 'b', { ...edgeData, connectorType: 'straight' }, memo)!;
    expect(g.routed).toBeUndefined();
  });
});
