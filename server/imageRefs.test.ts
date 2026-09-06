import { describe, expect, it } from 'vitest';
import { imageIdsInDiagram } from './imageRefs.js';

function diagram(...imageSrcs: (string | undefined)[]) {
  return {
    nodes: imageSrcs.map((imageSrc, i) => ({
      id: `n${i}`,
      type: 'shape',
      position: { x: 0, y: 0 },
      data: imageSrc === undefined ? { label: 'plain' } : { imageSrc },
    })),
    edges: [],
  };
}

describe('imageIdsInDiagram', () => {
  it('finds the id in an /api/images/<id> reference', () => {
    expect(imageIdsInDiagram(diagram('/api/images/img1'))).toEqual(['img1']);
  });

  it('collects ids from several nodes', () => {
    expect(imageIdsInDiagram(diagram('/api/images/a', undefined, '/api/images/b')).sort()).toEqual(['a', 'b']);
  });

  it('dedupes an id used by more than one node', () => {
    expect(imageIdsInDiagram(diagram('/api/images/dup', '/api/images/dup'))).toEqual(['dup']);
  });

  it('ignores base64 data URLs (the pre-upload format)', () => {
    expect(imageIdsInDiagram(diagram('data:image/png;base64,iVBORw0KGgo='))).toEqual([]);
  });

  it('ignores foreign URLs that merely look similar', () => {
    expect(
      imageIdsInDiagram(
        diagram(
          'https://evil.example.com/api/images/x',
          '/api/images/',
          '/api/images/a/b',
          '/api/diagrams/d1',
          '/api/imagesx/y',
        ),
      ),
    ).toEqual([]);
  });

  it('tolerates a trailing query string or slash on an otherwise valid reference', () => {
    expect(imageIdsInDiagram(diagram('/api/images/withq?v=2'))).toEqual(['withq']);
  });

  it('returns an empty list for malformed or empty diagram data', () => {
    expect(imageIdsInDiagram(null)).toEqual([]);
    expect(imageIdsInDiagram(undefined)).toEqual([]);
    expect(imageIdsInDiagram('not an object')).toEqual([]);
    expect(imageIdsInDiagram({})).toEqual([]);
    expect(imageIdsInDiagram({ nodes: 'nope' })).toEqual([]);
    expect(imageIdsInDiagram({ nodes: [null, 7, { data: null }, { data: { imageSrc: 42 } }] })).toEqual([]);
  });
});
