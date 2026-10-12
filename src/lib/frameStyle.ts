import type { ShapeData } from '../types';

/** What a frame paints: its panel and its border, as CSS values. */
export interface FrameStyle {
  background: string;
  borderColor: string;
}

/**
 * A frame with no colour of its own is the theme's panel and rule; one the
 * user coloured wears a toned-down version of that colour, the way Whimsical's
 * sections do, so the contents stay the loudest thing in it.
 *
 * `transparent` (the toolbar's Transparent toggle, the same field a shape's
 * uses) leaves only the border and the title, with the board showing through.
 * The theme rule is a few percent of black or white — on the panel that is
 * enough, on the bare board it would vanish — so an uncoloured transparent
 * frame takes a stronger rule from the ink scale, which flips with the theme
 * (and export pins the light theme, so a PNG gets the light one).
 */
export function frameStyle(data: Pick<ShapeData, 'fill' | 'stroke' | 'transparent'>): FrameStyle {
  const tinted = data.fill !== 'transparent' && data.stroke !== 'transparent';
  const clear = data.transparent === true;
  const background = clear
    ? 'transparent'
    : tinted ? `color-mix(in srgb, ${data.fill} 28%, var(--panel))` : 'var(--panel)';
  const borderColor = tinted
    ? `color-mix(in srgb, ${data.stroke} 55%, var(--line))`
    : clear ? 'color-mix(in srgb, var(--ink-600) 35%, transparent)' : 'var(--line)';
  return { background, borderColor };
}
