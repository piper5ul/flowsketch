import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
  nextFontSize,
  resolveFontSize,
} from './text';

describe('resolveFontSize', () => {
  it('falls back to the default when a shape has never been sized', () => {
    expect(resolveFontSize(undefined)).toBe(DEFAULT_FONT_SIZE);
  });

  it('reads the three presets diagrams were saved with', () => {
    // The sizes those names were drawn at, so an old diagram opens unchanged
    // and needs no migration to say the same thing in numbers.
    expect(resolveFontSize('small')).toBe(12);
    expect(resolveFontSize('medium')).toBe(14);
    expect(resolveFontSize('large')).toBe(18);
  });

  it('passes a number through', () => {
    expect(resolveFontSize(22)).toBe(22);
  });

  it('clamps a number to the range the controls offer', () => {
    expect(resolveFontSize(2)).toBe(FONT_SIZE_MIN);
    expect(resolveFontSize(400)).toBe(FONT_SIZE_MAX);
  });

  it('treats a value that is neither as the default', () => {
    // Hand-edited JSON and older experiments both reach this.
    expect(resolveFontSize(Number.NaN)).toBe(DEFAULT_FONT_SIZE);
    expect(resolveFontSize('huge' as never)).toBe(DEFAULT_FONT_SIZE);
  });
});

describe('nextFontSize', () => {
  it('steps up and down by one step', () => {
    expect(nextFontSize(14, 1)).toBe(14 + FONT_SIZE_STEP);
    expect(nextFontSize(14, -1)).toBe(14 - FONT_SIZE_STEP);
  });

  it('steps off a preset onto the number it stood for', () => {
    expect(nextFontSize('large', 1)).toBe(18 + FONT_SIZE_STEP);
    expect(nextFontSize('small', -1)).toBe(12 - FONT_SIZE_STEP);
  });

  it('stops at both ends rather than running past them', () => {
    expect(nextFontSize(FONT_SIZE_MAX, 1)).toBe(FONT_SIZE_MAX);
    expect(nextFontSize(FONT_SIZE_MIN, -1)).toBe(FONT_SIZE_MIN);
  });

  it('lands on the step grid from an odd size', () => {
    // 15 is reachable by hand-edited JSON; stepping up from it should not
    // leave every size after it off by one.
    expect(nextFontSize(15, 1)).toBe(16);
    expect(nextFontSize(15, -1)).toBe(14);
  });
});
