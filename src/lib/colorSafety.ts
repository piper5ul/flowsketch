import { DEFAULT_EDGE_STROKE } from './defaults.js';
import { DEFAULT_INK_STROKE } from './ink.js';
import { DEFAULT_SWATCH, PALETTE, swatchPair } from './palette.js';
import { WIRE_FILL, WIRE_STROKE } from './wireframe.js';
import { sanitizeColor } from './colorString.js';
export { sanitizeColor } from './colorString.js';

const FILL_STYLES = new Set(['filled', 'outline', 'tinted', 'dashed']);
const STICKY_DEFAULT = swatchPair(PALETTE.find((swatch) => swatch.id === 'yellow')!, 'sticky');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Narrows the colour and look fields shared by a shape and its defaults.
 * Invalid fields are omitted so the shape look and default-style resolver can
 * use their existing built-in values.
 */
export function sanitizeShapeStyleValues(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  for (const key of ['fill', 'stroke', 'textColor'] as const) {
    if (!(key in out)) continue;
    const colour = sanitizeColor(out[key]);
    if (colour === undefined) delete out[key];
    else out[key] = colour;
  }
  if ('fillStyle' in out && !FILL_STYLES.has(out.fillStyle as string)) delete out.fillStyle;
  if ('transparent' in out && typeof out.transparent !== 'boolean') delete out.transparent;
  return out;
}

/** Narrows connector default colour fields without adding a built-in default. */
export function sanitizeConnectorStyleValues(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  if ('stroke' in out) {
    const colour = sanitizeColor(out.stroke);
    if (colour === undefined) delete out.stroke;
    else out.stroke = colour;
  }
  return out;
}

function shapeColourFallbacks(data: Record<string, unknown>, nodeType?: string): { fill: string; stroke: string } {
  if (nodeType === 'frame' || nodeType === 'group') return { fill: 'transparent', stroke: 'transparent' };
  if (nodeType === 'ink') return { fill: 'transparent', stroke: DEFAULT_INK_STROKE };
  if (nodeType === 'wire') return { fill: WIRE_FILL, stroke: WIRE_STROKE };
  if (data.shape === 'text' || data.shape === 'image') return { fill: 'transparent', stroke: 'transparent' };
  if (data.shape === 'sticky') return STICKY_DEFAULT;
  return { fill: DEFAULT_SWATCH.fill, stroke: DEFAULT_SWATCH.stroke };
}

/** Narrows a node's untrusted `ShapeData`, restoring its built-in colours. */
export function sanitizeShapeData(raw: unknown, nodeType?: string): Record<string, unknown> {
  const data = isRecord(raw) ? raw : {};
  const out = sanitizeShapeStyleValues(data);
  const fallback = shapeColourFallbacks(data, nodeType);
  for (const key of ['fill', 'stroke'] as const) {
    if (key in data && !(key in out)) out[key] = fallback[key];
  }
  return out;
}

/** Narrows a connector's untrusted colour while preserving its other fields. */
export function sanitizeConnectorData(raw: unknown): Record<string, unknown> {
  const data = isRecord(raw) ? raw : {};
  const out = sanitizeConnectorStyleValues(data);
  if ('stroke' in data && !('stroke' in out)) out.stroke = DEFAULT_EDGE_STROKE;
  return out;
}
