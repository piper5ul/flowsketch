import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_BYTES, fitWithin, isImageTooLarge, uploadImage } from './imageUpload';

describe('fitWithin', () => {
  it('leaves an image that already fits alone — it never upscales', () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });

  it('leaves an image sitting exactly on the limit alone', () => {
    expect(fitWithin(2000, 1000, 2000)).toEqual({ width: 2000, height: 1000 });
  });

  it('scales the longer edge down to the limit and the other edge with it', () => {
    expect(fitWithin(4000, 2000, 2000)).toEqual({ width: 2000, height: 1000 });
    expect(fitWithin(2000, 4000, 2000)).toEqual({ width: 1000, height: 2000 });
  });

  it('keeps a square square', () => {
    expect(fitWithin(3000, 3000, 2000)).toEqual({ width: 2000, height: 2000 });
  });

  it('rounds to whole pixels and never returns a zero edge', () => {
    const { width, height } = fitWithin(4000, 3, 2000);
    expect(width).toBe(2000);
    expect(Number.isInteger(height)).toBe(true);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it('is a no-op for a degenerate size rather than dividing by zero', () => {
    expect(fitWithin(0, 0, 2000)).toEqual({ width: 0, height: 0 });
  });
});

describe('isImageTooLarge', () => {
  it('accepts a blob on the limit and rejects one past it', () => {
    expect(isImageTooLarge(new Blob([new Uint8Array(10)]))).toBe(false);
    expect(isImageTooLarge({ size: MAX_IMAGE_BYTES } as Blob)).toBe(false);
    expect(isImageTooLarge({ size: MAX_IMAGE_BYTES + 1 } as Blob)).toBe(true);
  });
});

describe('uploadImage', () => {
  const meta = { id: 'img1', url: '/api/images/img1', mime: 'image/png', size: 12, width: 4, height: 2 };
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function respond(status: number, body: unknown = {}) {
    fetchMock.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });
  }

  it('posts the raw bytes with the blob\'s own content type and the session cookie', async () => {
    respond(201, meta);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await expect(uploadImage(blob)).resolves.toEqual(meta);

    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toContain('/api/images');
    expect(init).toMatchObject({
      method: 'POST',
      body: blob,
      credentials: 'include',
      headers: { 'Content-Type': 'image/png' },
    });
  });

  it('explains a 413 in words the user can act on', async () => {
    respond(413);
    await expect(uploadImage(new Blob([]))).rejects.toThrow(/10 MB/);
  });

  it('explains a 415 in words the user can act on', async () => {
    respond(415);
    await expect(uploadImage(new Blob([]))).rejects.toThrow(/PNG|JPEG|GIF|WEBP/i);
  });

  it('still throws something readable for an unexpected status', async () => {
    respond(500);
    await expect(uploadImage(new Blob([]))).rejects.toThrow(/upload/i);
  });

  it('throws rather than uploading a blob past the 10 MB ceiling', async () => {
    await expect(uploadImage({ size: MAX_IMAGE_BYTES + 1, type: 'image/png' } as Blob)).rejects.toThrow(/10 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
