import { describe, expect, it } from 'vitest';
import { rewriteSharedDiagram, rewriteSharedImageUrls } from './sharedView';
import type { SerializedNode } from '../../shared/types';

const TOKEN = 'aBc-123_xyz';

function node(id: string, data: Record<string, unknown>) {
  return { id, type: 'shape', position: { x: 0, y: 0 }, data } as SerializedNode;
}

describe('rewriteSharedImageUrls', () => {
  it('repoints an uploaded image at the share token\'s own route', () => {
    const [rewritten] = rewriteSharedImageUrls(
      [node('n1', { shape: 'image', imageSrc: '/api/images/img123' })],
      TOKEN,
    );
    expect(rewritten.data.imageSrc).toBe(`/api/shared/${TOKEN}/images/img123`);
  });

  it('leaves everything else about the node alone', () => {
    const [rewritten] = rewriteSharedImageUrls(
      [node('n1', { shape: 'image', imageSrc: '/api/images/img123', label: 'Logo' })],
      TOKEN,
    );
    expect(rewritten).toMatchObject({ id: 'n1', type: 'shape', position: { x: 0, y: 0 } });
    expect(rewritten.data.label).toBe('Logo');
  });

  it('returns untouched nodes by identity', () => {
    const plain = node('n1', { shape: 'rectangle', label: 'Hi' });
    const [rewritten] = rewriteSharedImageUrls([plain], TOKEN);
    expect(rewritten).toBe(plain);
  });

  it('leaves an inline base64 image where it is', () => {
    // Old diagrams still carry their pixels inline; they need no token to draw.
    const inline = node('n1', { imageSrc: 'data:image/png;base64,AAAA' });
    expect(rewriteSharedImageUrls([inline], TOKEN)[0]).toBe(inline);
  });

  it('rewrites only the exact authenticated path, not anything containing it', () => {
    for (const src of [
      'https://example.test/api/images/img123',
      '/api/images/img123?w=10',
      '/api/images/',
      '/api/images/a/b',
    ]) {
      const original = node('n1', { imageSrc: src });
      expect(rewriteSharedImageUrls([original], TOKEN)[0], src).toBe(original);
    }
  });

  it('escapes the token rather than pasting it into the path raw', () => {
    const [rewritten] = rewriteSharedImageUrls([node('n1', { imageSrc: '/api/images/i1' })], 'a/b');
    expect(rewritten.data.imageSrc).toBe('/api/shared/a%2Fb/images/i1');
  });

  it('handles a node with no data at all', () => {
    const bare: { id: string; data?: Record<string, unknown> } = { id: 'n1' };
    expect(rewriteSharedImageUrls([bare], TOKEN)[0]).toBe(bare);
  });
});

describe('rewriteSharedDiagram', () => {
  it('rewrites the nodes and carries the rest of the diagram through', () => {
    const data = {
      version: 3,
      nodes: [node('n1', { imageSrc: '/api/images/img123' })],
      edges: [{ id: 'e1', source: 'a', target: 'b' }],
      viewport: { x: 1, y: 2, zoom: 0.5 },
    };
    const shared = rewriteSharedDiagram(data, TOKEN);
    expect(shared.nodes[0].data.imageSrc).toBe(`/api/shared/${TOKEN}/images/img123`);
    expect(shared.edges).toBe(data.edges);
    expect(shared.viewport).toEqual({ x: 1, y: 2, zoom: 0.5 });
    expect(shared.version).toBe(3);
  });
});
