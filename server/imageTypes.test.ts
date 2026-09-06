import { describe, expect, it } from 'vitest';
import { extForMime, sniffImage } from './imageTypes.js';

/** Minimal PNG: signature + a length/`IHDR` chunk header carrying 4x3 dimensions. */
function pngHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** Minimal JPEG: SOI, a skipped APP0 segment, then an SOF0 frame header. */
function jpegHeader(width: number, height: number): Buffer {
  const app0 = Buffer.alloc(6);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(4, 2); // segment length, payload = 2 bytes
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(8, 2);
  sof.writeUInt8(8, 4); // precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

function gifHeader(version: string, width: number, height: number): Buffer {
  const b = Buffer.alloc(13);
  b.write(version, 0, 'latin1');
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
}

function webpHeader(): Buffer {
  const b = Buffer.alloc(16);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(8, 4);
  b.write('WEBP', 8, 'latin1');
  b.write('VP8 ', 12, 'latin1');
  return b;
}

describe('sniffImage', () => {
  it('recognises PNG and reads its IHDR dimensions', () => {
    expect(sniffImage(pngHeader(4, 3))).toEqual({
      mime: 'image/png',
      ext: 'png',
      width: 4,
      height: 3,
    });
  });

  it('recognises JPEG and reads dimensions from the SOF marker', () => {
    expect(sniffImage(jpegHeader(120, 90))).toEqual({
      mime: 'image/jpeg',
      ext: 'jpg',
      width: 120,
      height: 90,
    });
  });

  it('recognises both GIF versions', () => {
    expect(sniffImage(gifHeader('GIF87a', 10, 20))).toMatchObject({ mime: 'image/gif', ext: 'gif' });
    expect(sniffImage(gifHeader('GIF89a', 10, 20))).toEqual({
      mime: 'image/gif',
      ext: 'gif',
      width: 10,
      height: 20,
    });
  });

  it('recognises WEBP by its RIFF....WEBP container', () => {
    expect(sniffImage(webpHeader())).toMatchObject({ mime: 'image/webp', ext: 'webp' });
  });

  it('rejects a RIFF container that is not WEBP', () => {
    const wav = webpHeader();
    wav.write('WAVE', 8, 'latin1');
    expect(sniffImage(wav)).toBeNull();
  });

  it('rejects text, empty and truncated buffers', () => {
    expect(sniffImage(Buffer.from('hello world, not an image at all', 'utf8'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull();
  });

  it('never trusts a lying header: PNG magic bytes win over anything else', () => {
    // Body claiming to be text but carrying PNG bytes is still a PNG.
    expect(sniffImage(pngHeader(1, 1))?.mime).toBe('image/png');
  });

  it('reports null dimensions when the header is recognised but unparseable', () => {
    const truncatedIhdr = pngHeader(4, 3);
    truncatedIhdr.write('IDAT', 12, 'latin1');
    expect(sniffImage(truncatedIhdr)).toMatchObject({ mime: 'image/png', width: null, height: null });
  });

  it('does not loop forever on a JPEG with a zero-length segment', () => {
    const bad = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(sniffImage(bad)).toMatchObject({ mime: 'image/jpeg', width: null, height: null });
  });
});

describe('extForMime', () => {
  it('maps every supported mime back to the stored extension', () => {
    expect(extForMime('image/png')).toBe('png');
    expect(extForMime('image/jpeg')).toBe('jpg');
    expect(extForMime('image/gif')).toBe('gif');
    expect(extForMime('image/webp')).toBe('webp');
  });

  it('returns null for anything else', () => {
    expect(extForMime('image/svg+xml')).toBeNull();
    expect(extForMime('text/plain')).toBeNull();
  });
});
