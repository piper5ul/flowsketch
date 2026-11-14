// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { decodeClipboardPayload, encodeClipboardPayload } from './clipboardPayload';
import { CURRENT_DIAGRAM_VERSION, migrateDiagramData } from './diagramMigrations';
import type { ClipboardPayload, ConnectorEdge } from '../store/useDiagramStore';

const clip: ClipboardPayload = {
  nodes: [{
    id: 'box', type: 'shape', position: { x: 10, y: 20 }, width: 180, height: 100,
    data: { shape: 'rectangle', label: '"<&></div><script>alert(1)</script> 🪄', fill: '#ABC', stroke: '#123456' },
  }],
  edges: [],
};

function htmlOf(raw: unknown): string {
  return `<div data-flowsketch="${encodeURIComponent(JSON.stringify(raw))}"></div>`;
}

describe('clipboardPayload', () => {
  it('round-trips a payload in an HTML marker without interpreting its labels as HTML', () => {
    const { html, text } = encodeClipboardPayload(clip);
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelectorAll('[data-flowsketch]')).toHaveLength(1);
    expect(document.querySelector('script')).toBeNull();
    expect(decodeClipboardPayload(`<html><body><!--StartFragment-->${html}<!--EndFragment--></body></html>`)).toEqual(clip);
    expect(text).toBe(clip.nodes[0].data.label);
  });

  it('includes node and connector labels in the plain text fallback', () => {
    const edge: ConnectorEdge = { id: 'edge', source: 'box', target: 'box',
      data: { label: 'Connector', connectorType: 'straight', stroke: '#123', strokeStyle: 'solid' },
    };
    expect(encodeClipboardPayload({ ...clip, edges: [edge] }).text).toBe(`${clip.nodes[0].data.label}\nConnector`);
  });

  it('narrows untrusted nodes and edges through the stored diagram migrations', () => {
    const raw = {
      nodes: [null, { id: 'box', data: {
        shape: 'image', imageSrc: '/api/images/private-image', fill: 'url(https://bad)',
        stroke: 'red', textColor: 'var(--bad)', fillStyle: 'bad', transparent: 'yes',
      } }, { id: 'table', type: 'table', data: { table: { columns: [], rows: [] } } }],
      edges: [{ id: 'edge', source: 'box', target: 'table', data: {
        stroke: 'url(https://bad)', labelBackground: 'yes', startArrow: true, waypoint: { x: 5, y: 8 },
      } }],
    };
    const expected = migrateDiagramData(raw);
    const decoded = decodeClipboardPayload(htmlOf(raw))!;
    expect(decoded).toEqual({ nodes: expected.nodes, edges: expected.edges });
    expect(decoded.nodes[0].data.imageSrc).toBe('/api/images/private-image');
    expect(decoded.nodes[0].data).not.toHaveProperty('textColor');
    expect(decoded.nodes[0].data).not.toHaveProperty('fillStyle');
    expect(decoded.edges[0].data).not.toHaveProperty('labelBackground');
    expect(decoded.edges[0].data?.waypoints).toEqual([{ x: 5, y: 8 }]);
  });

  it('narrows current-version payloads as well', () => {
    const raw = { ...clip, version: CURRENT_DIAGRAM_VERSION,
      nodes: [{ ...clip.nodes[0], data: { ...clip.nodes[0].data, fill: 'url(https://bad)' } }],
    };
    expect(decodeClipboardPayload(htmlOf(raw))!.nodes).toEqual(migrateDiagramData(raw).nodes);
  });

  it.each(['', '<p>ordinary HTML</p>', '<div data-flowsketch="%ZZ"></div>', '<div data-flowsketch="%7B"></div>'])('ignores a missing or malformed payload: %s', (html) => {
    expect(decodeClipboardPayload(html)).toBeNull();
  });

  it('ignores a diagram format this build cannot read', () => {
    expect(decodeClipboardPayload(htmlOf({ ...clip, version: CURRENT_DIAGRAM_VERSION + 1 }))).toBeNull();
  });
});
