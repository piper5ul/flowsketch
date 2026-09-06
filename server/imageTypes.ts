/**
 * Content sniffing for uploaded images.
 *
 * The `Content-Type` header on an upload is attacker-controlled, so it is only
 * used to decide whether to buffer the body at all. What the file *is* comes
 * from its magic bytes, which is also what decides the extension we store it
 * under and the mime we serve it back with.
 */

export interface SniffedImage {
  mime: string;
  ext: string;
  width: number | null;
  height: number | null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Extension stored on disk for each mime we accept. */
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** The stored file extension for a mime we accept, or null if we do not accept it. */
export function extForMime(mime: string): string | null {
  return EXT_BY_MIME[mime] ?? null;
}

/** Identify an image by its magic bytes. Returns null for anything unsupported. */
export function sniffImage(buffer: Buffer): SniffedImage | null {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { mime: 'image/png', ext: 'png', ...pngSize(buffer) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg', ...jpegSize(buffer) };
  }
  const magic6 = buffer.subarray(0, 6).toString('latin1');
  if (magic6 === 'GIF87a' || magic6 === 'GIF89a') {
    return {
      mime: 'image/gif',
      ext: 'gif',
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
    };
  }
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF'
    && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    // VP8/VP8L/VP8X each encode dimensions differently; not worth the bytes here.
    return { mime: 'image/webp', ext: 'webp', width: null, height: null };
  }
  return null;
}

/** PNG dimensions live in the IHDR chunk, which is always the first one. */
function pngSize(b: Buffer): { width: number | null; height: number | null } {
  if (b.length < 24 || b.subarray(12, 16).toString('latin1') !== 'IHDR') {
    return { width: null, height: null };
  }
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** JPEG dimensions live in whichever SOF (start of frame) marker comes first. */
function jpegSize(b: Buffer): { width: number | null; height: number | null } {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1];
    // SOF0..SOF15, minus DHT (c4), JPG (c8) and DAC (cc), which are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    // Standalone markers (padding, RSTn, SOI/EOI) carry no length field.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const segmentLength = b.readUInt16BE(i + 2);
    if (segmentLength < 2) return { width: null, height: null };
    i += 2 + segmentLength;
  }
  return { width: null, height: null };
}
