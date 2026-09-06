import { describe, expect, it } from 'vitest';
import { buildVersionPreview } from './versionPreview';
import { DEFAULT_EDGE_STROKE } from './defaults';
import type { DiagramData, SerializedEdge, SerializedNode } from '../../shared/types';

function node(id: string, over: Partial<SerializedNode> = {}): SerializedNode {
  return {
    id,
    type: 'shape',
    position: { x: 0, y: 0 },
    width: 100,
    height: 50,
    data: { fill: '#FFF', stroke: '#000' },
    ...over,
  };
}

function edge(id: string, source: string, target: string, over: Partial<SerializedEdge> = {}): SerializedEdge {
  return { id, source, target, type: 'connector', data: {}, ...over };
}

function diagram(nodes: SerializedNode[], edges: SerializedEdge[] = []): DiagramData {
  return { version: 3, nodes, edges };
}

describe('buildVersionPreview', () => {
  it('has nothing to draw for an empty diagram', () => {
    expect(buildVersionPreview(diagram([]))).toBeNull();
  });

  it('frames the content with air around it', () => {
    const preview = buildVersionPreview(
      diagram([node('a', { position: { x: 0, y: 0 }, width: 400, height: 200 })]),
    )!;
    // 8% of the longer side (400) is 32, which clears the 16 floor.
    expect(preview.viewBox).toBe('-32 -32 464 264');
  });

  it('never squeezes the padding below its floor', () => {
    const preview = buildVersionPreview(
      diagram([node('a', { position: { x: 10, y: 10 }, width: 20, height: 20 })]),
    )!;
    expect(preview.viewBox).toBe('-6 -6 52 52');
  });

  it('frames every node, not just the first', () => {
    const preview = buildVersionPreview(
      diagram([
        node('a', { position: { x: 100, y: 100 } }),
        node('b', { position: { x: -50, y: 300 } }),
      ]),
    )!;
    const [x, y, w, h] = preview.viewBox.split(' ').map(Number);
    expect(x).toBeLessThanOrEqual(-50);
    expect(y).toBeLessThanOrEqual(100);
    expect(x + w).toBeGreaterThanOrEqual(200);
    expect(y + h).toBeGreaterThanOrEqual(350);
  });

  it('carries each node\'s own box and colours', () => {
    const preview = buildVersionPreview(
      diagram([
        node('a', { position: { x: 5, y: 6 }, width: 70, height: 30, data: { fill: '#FBF3D0', stroke: '#E9B10A' } }),
      ]),
    )!;
    expect(preview.boxes).toEqual([
      { id: 'a', x: 5, y: 6, w: 70, h: 30, fill: '#FBF3D0', stroke: '#E9B10A' },
    ]);
  });

  it('falls back to a box for a v0 node that stored no size', () => {
    const preview = buildVersionPreview(diagram([node('a', { width: undefined, height: undefined })]))!;
    expect(preview.boxes[0]).toMatchObject({ w: 180, h: 100 });
  });

  it('draws a connector centre to centre in the version\'s own coordinates', () => {
    const preview = buildVersionPreview(
      diagram(
        [
          node('a', { position: { x: 0, y: 0 }, width: 100, height: 50 }),
          node('b', { position: { x: 200, y: 100 }, width: 100, height: 50 }),
        ],
        [edge('e1', 'a', 'b', { data: { stroke: '#FF0000' } })],
      ),
    )!;
    expect(preview.lines).toEqual([
      { id: 'e1', x1: 50, y1: 25, x2: 250, y2: 125, stroke: '#FF0000' },
    ]);
  });

  it('uses the default connector colour when the edge stored none', () => {
    const preview = buildVersionPreview(
      diagram([node('a'), node('b', { position: { x: 300, y: 0 } })], [edge('e1', 'a', 'b')]),
    )!;
    expect(preview.lines[0].stroke).toBe(DEFAULT_EDGE_STROKE);
  });

  it('drops a connector whose endpoint this version does not have', () => {
    const preview = buildVersionPreview(diagram([node('a')], [edge('e1', 'a', 'gone')]))!;
    expect(preview.lines).toEqual([]);
    expect(preview.boxes).toHaveLength(1);
  });
});
