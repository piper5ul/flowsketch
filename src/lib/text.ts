/**
 * Label sizing. A shape's `fontSize` used to be one of three names and is now
 * a number of pixels, so both spellings have to be readable — the names are
 * simply the numbers they were always drawn at, which is what lets a diagram
 * saved with `'large'` open at 18px without a migration step.
 */
import type { FontSize } from '../types';

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 48;
export const FONT_SIZE_STEP = 2;
export const DEFAULT_FONT_SIZE = 14;

/** The pixel each of the old preset names stood for. */
const PRESET_PX: Record<FontSize, number> = { small: 12, medium: 14, large: 18 };

const clamp = (px: number) => Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, px));

/** The size to draw a label at, whichever way its shape spells it. */
export function resolveFontSize(value: FontSize | number | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? clamp(value) : DEFAULT_FONT_SIZE;
  }
  if (value && value in PRESET_PX) return PRESET_PX[value];
  return DEFAULT_FONT_SIZE;
}

/**
 * One press of the −/+ buttons, or of ⌘⌥− / ⌘⌥=. Stepping snaps onto the grid
 * of even sizes rather than adding to whatever odd number it started from, so
 * a size arrived at by hand does not knock every later step out of line.
 */
export function nextFontSize(value: FontSize | number | undefined, direction: 1 | -1): number {
  const current = resolveFontSize(value);
  const stepped =
    direction === 1
      ? Math.floor(current / FONT_SIZE_STEP) * FONT_SIZE_STEP + FONT_SIZE_STEP
      : Math.ceil(current / FONT_SIZE_STEP) * FONT_SIZE_STEP - FONT_SIZE_STEP;
  return clamp(stepped);
}
