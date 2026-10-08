import type { SwatchColor } from '../types.js';
import { sanitizeColor } from './colorString.js';
export { sanitizeColor } from './colorString.js';

function hexChannels(value: unknown): [number, number, number] | null {
  const colour = sanitizeColor(value);
  if (!colour || !colour.startsWith('#')) return null;
  let hex = colour.slice(1);
  if (hex.length === 3) hex = [...hex].map((digit) => digit + digit).join('');
  return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
}

/** `hex` moved `amount` (0–1) of the way to `towards`, as upper-case hex. */
export function mix(hex: unknown, towards: unknown, amount: number): string {
  const a = hexChannels(hex);
  const b = hexChannels(towards);
  if (!a || !b || !Number.isFinite(amount)) return '#FFFFFF';
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * amount));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

const WHITE = '#FFFFFF';

/** How much lighter Outline and Dash interiors are than their stored fill. */
export const TINT_AMOUNT = 0.8;
export const STICKY_TINT = 0.75;

const SWATCHES: readonly Omit<SwatchColor, 'sticky'>[] = [
  { id: 'white', name: 'White', fill: '#FFFFFF', stroke: '#CBD5E1' },
  { id: 'smoke', name: 'Smoke', fill: '#C4CFDA', stroke: '#C4CFDA' },
  { id: 'gray', name: 'Gray', fill: '#788896', stroke: '#788896' },
  { id: 'slate', name: 'Slate', fill: '#4D5D6C', stroke: '#4D5D6C' },
  { id: 'blue', name: 'Blue', fill: '#2987D7', stroke: '#2987D7' },
  { id: 'indigo', name: 'Indigo', fill: '#655BF3', stroke: '#655BF3' },
  { id: 'purple', name: 'Purple', fill: '#730FC3', stroke: '#730FC3' },
  { id: 'pink', name: 'Pink', fill: '#BE36D3', stroke: '#BE36D3' },
  { id: 'mint', name: 'Mint', fill: '#26AFA0', stroke: '#26AFA0' },
  { id: 'green', name: 'Green', fill: '#007A6F', stroke: '#007A6F' },
  { id: 'brown', name: 'Brown', fill: '#897A5F', stroke: '#897A5F' },
  { id: 'crimson', name: 'Crimson', fill: '#A46767', stroke: '#A46767' },
  { id: 'red', name: 'Red', fill: '#D5475B', stroke: '#D5475B' },
  { id: 'orange', name: 'Orange', fill: '#E8843C', stroke: '#E8843C' },
  { id: 'yellow', name: 'Yellow', fill: '#F0C54F', stroke: '#F0C54F' },
];

/** The named colour grid in row order; sticky fills are the lightened pair. */
export const PALETTE: readonly SwatchColor[] = SWATCHES.map((swatch) => ({
  ...swatch,
  sticky: mix(swatch.fill, WHITE, STICKY_TINT),
}));

export const GRID_COLUMNS = 4;
export const DEFAULT_SWATCH: SwatchColor = PALETTE[0];

export function isHex6(value: unknown): boolean {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export function swatchFromHex(hex: string): SwatchColor {
  const normalized = hex.toUpperCase();
  return {
    id: 'custom',
    name: normalized,
    fill: normalized,
    stroke: normalized,
    sticky: mix(normalized, WHITE, STICKY_TINT),
  };
}

export type ColourTarget = 'shape' | 'sticky' | 'edge';

export function swatchPair(swatch: SwatchColor, target: 'shape' | 'sticky'): { fill: string; stroke: string } {
  return {
    fill: target === 'sticky' ? swatch.sticky : swatch.fill,
    stroke: swatch.stroke,
  };
}

function sameColour(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.toUpperCase() === b.toUpperCase();
}

export function matchSwatch(
  colour: { fill?: unknown; stroke?: unknown } | null | undefined,
  target: ColourTarget,
): SwatchColor | null {
  if (!colour || typeof colour !== 'object') return null;
  return PALETTE.find((swatch) => {
    if (target === 'edge') return sameColour(colour.stroke, swatch.stroke);
    const fill = target === 'sticky' ? swatch.sticky : swatch.fill;
    return sameColour(colour.fill, fill) && sameColour(colour.stroke, swatch.stroke);
  }) ?? null;
}

/**
 * Returns true if the fill is dark enough to warrant white text.
 * Uses the existing weighted RGB threshold to keep current contrast behaviour.
 */
export function isDarkFill(fill: unknown): boolean {
  const colour = sanitizeColor(fill);
  if (!colour || colour.toLowerCase() === 'transparent') return false;
  const channels = hexChannels(colour) ?? rgbFunctionChannels(colour);
  if (!channels) return false;
  const [red, green, blue] = channels;
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance < 0.5;
}

function rgbFunctionChannels(colour: string): [number, number, number] | null {
  if (!colour.toLowerCase().startsWith('rgb')) return null;
  const body = colour.slice(colour.indexOf('(') + 1, -1).replace('/', ' ');
  const values = body.split(/[\s,]+/).filter(Boolean);
  if (values.length < 3) return null;
  return values.slice(0, 3).map((channel) => {
    const numeric = Number.parseFloat(channel);
    return Math.max(0, Math.min(255, channel.endsWith('%') ? numeric * 2.55 : numeric));
  }) as [number, number, number];
}
