import type { SwatchColor } from '../types';

/**
 * The colour palette: Whimsical's eleven theme hues plus a neutral column,
 * each in four tiers — two pastel tints (dark text), the hue itself, and a
 * shade (white text) — built from the hue by mixing towards white or black.
 *
 * The hues are the ones Whimsical's own colour themes are made of (read out of
 * its client: Blue, Indigo, Purple, Pink, Mint, Green, Brown, Crimson, Red,
 * Orange, Yellow), so a board here and a board there sit in the same family.
 * Every swatch carries a `stroke` too: the outline an `'outline'` shape draws,
 * and the tone a coloured frame is mixed from.
 */
const HUES: [name: string, hex: string][] = [
  ['blue', '#2C88D9'],
  ['indigo', '#6558F5'],
  ['purple', '#730FC3'],
  ['pink', '#BD34D1'],
  ['mint', '#1AAE9F'],
  ['green', '#207868'],
  ['brown', '#897A5F'],
  ['crimson', '#AC6363'],
  ['red', '#D3455B'],
  ['orange', '#E8833A'],
  ['yellow', '#F7C325'],
];

/** The neutral column, hand-picked from Whimsical's grey scale. */
const NEUTRALS: SwatchColor[] = [
  { id: 'white', fill: '#FFFFFF', stroke: '#CBD5E1' },
  { id: 'gray-2', fill: '#DFE6ED', stroke: '#9EADBA' },
  { id: 'gray-3', fill: '#788896', stroke: '#4B5C6B' },
  { id: 'gray-4', fill: '#293845', stroke: '#19232C' },
];

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** `hex` moved `amount` (0–1) of the way to `towards`, as upper-case hex. */
export function mix(hex: string, towards: string, amount: number): string {
  const a = channels(hex);
  const b = channels(towards);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * amount));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

const WHITE = '#FFFFFF';
const BLACK = '#000000';

/** Each tier: how far the fill and the stroke sit from the hue. */
const TIERS: { fill: (hue: string) => string; stroke: (hue: string) => string }[] = [
  { fill: (h) => mix(h, WHITE, 0.82), stroke: (h) => mix(h, WHITE, 0.5) },
  { fill: (h) => mix(h, WHITE, 0.6), stroke: (h) => mix(h, WHITE, 0.25) },
  { fill: (h) => h, stroke: (h) => mix(h, BLACK, 0.2) },
  { fill: (h) => mix(h, BLACK, 0.45), stroke: (h) => mix(h, BLACK, 0.6) },
];

/** Laid out tier by tier, neutral first in each row, so the grid reads light to dark downwards. */
export const PALETTE: SwatchColor[] = TIERS.flatMap((tier, index) => [
  NEUTRALS[index],
  ...HUES.map(([name, hex]) => ({ id: `${name}-${index + 1}`, fill: tier.fill(hex), stroke: tier.stroke(hex) })),
]);

export const DEFAULT_SWATCH = NEUTRALS[0]; // white

export const COLS = HUES.length + 1;

/**
 * Returns true if the fill is dark enough to warrant white text.
 * Uses the W3C relative luminance formula.
 */
export function isDarkFill(fill: string): boolean {
  if (!fill || fill === 'transparent') return false;
  const hex = fill.replace('#', '');
  if (hex.length < 6) return false;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance < 0.5;
}
