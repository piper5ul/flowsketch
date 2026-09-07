import { describe, expect, it } from 'vitest';
import { COLS, DEFAULT_SWATCH, PALETTE, isDarkFill } from './palette';

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

  it('keeps its 8-column grid across the tiers it names', () => {
    expect(PALETTE).toHaveLength(32);
    expect(COLS).toBe(8);
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
