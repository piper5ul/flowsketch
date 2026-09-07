import { describe, expect, it } from 'vitest';
import { COLS, DEFAULT_SWATCH, PALETTE, isDarkFill, mix } from './palette';

describe('PALETTE', () => {
  it('is a full grid with unique ids and valid hex colors', () => {
    expect(PALETTE.length % COLS).toBe(0);
    const ids = new Set(PALETTE.map((s) => s.id));
    expect(ids.size).toBe(PALETTE.length);
    for (const s of PALETTE) {
      expect(s.fill).toMatch(/^#[0-9A-F]{6}$/i);
      expect(s.stroke).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('is twelve columns — a neutral and Whimsical’s eleven hues — in four tiers', () => {
    expect(COLS).toBe(12);
    expect(PALETTE).toHaveLength(48);
    // The hue itself sits in tier 3, so a board here matches one there.
    expect(PALETTE.find((s) => s.id === 'indigo-3')?.fill).toBe('#6558F5');
    expect(PALETTE.find((s) => s.id === 'yellow-3')?.fill).toBe('#F7C325');
  });

  it('reads light to dark down every column, so the same tier means the same weight everywhere', () => {
    const column = (name: string) => [1, 2, 3, 4].map((t) => PALETTE.find((s) => s.id === `${name}-${t}`)!.fill);
    const lum = (hex: string) => {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16));
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    for (const name of ['blue', 'yellow', 'brown']) {
      const l = column(name).map(lum);
      expect(l[0]).toBeGreaterThan(l[1]);
      expect(l[1]).toBeGreaterThan(l[2]);
      expect(l[2]).toBeGreaterThan(l[3]);
    }
  });

  it('defaults to white, so a new shape is paper and takes dark text', () => {
    expect(PALETTE).toContain(DEFAULT_SWATCH);
    expect(DEFAULT_SWATCH.id).toBe('white');
    expect(DEFAULT_SWATCH.fill).toBe('#FFFFFF');
    expect(isDarkFill(DEFAULT_SWATCH.fill)).toBe(false);
  });

  it('keeps pastel tiers light and the deep tier dark, so auto-contrast is predictable per row', () => {
    // Tier 3 is deliberately not asserted: those fills straddle the threshold
    // and isDarkFill decides per swatch (yellow-3 stays dark-text, blue-3 goes white).
    for (const s of PALETTE) {
      const tier = Number(s.id.split('-')[1]);
      if (tier <= 2) expect(isDarkFill(s.fill), `${s.id} (${s.fill}) should be light`).toBe(false);
      if (tier === 4) expect(isDarkFill(s.fill), `${s.id} (${s.fill}) should be dark`).toBe(true);
    }
  });
});

describe('isDarkFill', () => {
  it('treats transparent and malformed values as light', () => {
    expect(isDarkFill('transparent')).toBe(false);
    expect(isDarkFill('')).toBe(false);
    expect(isDarkFill('#fff')).toBe(false);
  });

  it('classifies black and white', () => {
    expect(isDarkFill('#000000')).toBe(true);
    expect(isDarkFill('#FFFFFF')).toBe(false);
  });
});

describe('mix', () => {
  it('moves a colour towards another by a fraction, and keeps the ends', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#2C88D9', '#FFFFFF', 0)).toBe('#2C88D9');
    expect(mix('#2C88D9', '#FFFFFF', 1)).toBe('#FFFFFF');
  });
});
