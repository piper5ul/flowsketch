import { describe, expect, it, vi } from 'vitest';
import { backfillBase64Images, dataUrlToBlob, findBase64ImageNodes } from './imageBackfill';
import type { ImageMeta } from '../../shared/types';

/** A 1×1 GIF, small enough to inline and a real base64 payload. */
const TINY_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

function node(id: string, data: Record<string, unknown>) {
  return { id, data };
}

function meta(url: string): ImageMeta {
  return { id: url.split('/').pop() ?? '', url, mime: 'image/gif', size: 37, width: 1, height: 1 };
}

describe('findBase64ImageNodes', () => {
  it('finds the nodes still carrying their pixels inline', () => {
    const found = findBase64ImageNodes([
      node('a', { shape: 'rectangle', imageSrc: TINY_GIF }),
      node('b', { shape: 'image', imageSrc: TINY_GIF }),
    ]);
    expect(found).toEqual([
      { id: 'a', imageSrc: TINY_GIF },
      { id: 'b', imageSrc: TINY_GIF },
    ]);
  });

  it('ignores images that already live behind a URL', () => {
    const found = findBase64ImageNodes([
      node('a', { shape: 'image', imageSrc: '/api/images/abc' }),
      node('b', { shape: 'image', imageSrc: 'https://example.test/pic.png' }),
    ]);
    expect(found).toEqual([]);
  });

  it('ignores data URLs that are not images', () => {
    const found = findBase64ImageNodes([
      node('a', { imageSrc: 'data:application/json;base64,e30=' }),
      node('b', { imageSrc: 'data:text/plain;base64,aGk=' }),
      // An SVG data URL is markup the browser would run; it is not something
      // to upload, and it is not what the old paste path ever produced.
      node('c', { imageSrc: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E' }),
    ]);
    expect(found).toEqual([]);
  });

  it('ignores nodes with no image at all', () => {
    expect(findBase64ImageNodes([node('a', { shape: 'rectangle', label: 'Hi' })])).toEqual([]);
  });
});

describe('dataUrlToBlob', () => {
  it('decodes the payload and keeps its mime type', () => {
    const blob = dataUrlToBlob(TINY_GIF)!;
    expect(blob.type).toBe('image/gif');
    expect(blob.size).toBe(37);
  });

  it('returns null for something it cannot read rather than throwing', () => {
    expect(dataUrlToBlob('data:image/png;base64,!!!not base64!!!')).toBeNull();
    expect(dataUrlToBlob('not a data url')).toBeNull();
  });
});

describe('backfillBase64Images', () => {
  it('uploads each inline image and maps it to a patch', async () => {
    const upload = vi.fn(async () => meta('/api/images/one'));

    const patches = await backfillBase64Images(
      [
        node('a', { shape: 'rectangle', imageSrc: TINY_GIF }),
        node('b', { shape: 'rectangle', label: 'not an image' }),
      ],
      upload,
    );

    expect(upload).toHaveBeenCalledTimes(1);
    // `shape: 'image'` is part of the patch: the pre-upload format drew these
    // as rectangles, and they should render as bare images from now on.
    expect(patches).toEqual([{ id: 'a', imageSrc: '/api/images/one', shape: 'image' }]);
  });

  it('skips an upload that failed and keeps going with the rest', async () => {
    const upload = vi
      .fn<(blob: Blob) => Promise<ImageMeta>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(meta('/api/images/two'));

    const patches = await backfillBase64Images(
      [node('a', { imageSrc: TINY_GIF }), node('b', { imageSrc: TINY_GIF })],
      upload,
    );

    // The failed node is absent, so it stays inline — still rendering, and
    // still a candidate the next time the diagram is opened.
    expect(patches).toEqual([{ id: 'b', imageSrc: '/api/images/two', shape: 'image' }]);
  });

  it('does not call the uploader at all when nothing is inline', async () => {
    const upload = vi.fn(async () => meta('/api/images/one'));
    expect(await backfillBase64Images([node('a', { imageSrc: '/api/images/x' })], upload)).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  it('leaves a node whose data URL cannot be decoded alone', async () => {
    const upload = vi.fn(async () => meta('/api/images/one'));
    const patches = await backfillBase64Images(
      [node('a', { imageSrc: 'data:image/png;base64,!!!' })],
      upload,
    );
    expect(patches).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });
});
