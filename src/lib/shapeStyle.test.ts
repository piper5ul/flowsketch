import { describe, expect, it } from 'vitest';
import type { ShapeData } from '../types';
import { DEFAULT_SWATCH, isDarkFill } from './palette';
import { OUTLINE_FILL, resolveFillStyle, shapePaint } from './shapeStyle';

function shape(patch: Partial<ShapeData> = {}): ShapeData {
  return {
    label: '',
    shape: 'rectangle',
    fill: DEFAULT_SWATCH.fill,
    stroke: DEFAULT_SWATCH.stroke,
    ...patch,
  };
}

describe('resolveFillStyle', () => {
  it('reads an absent field as filled, so no diagram needed migrating', () => {
    expect(resolveFillStyle({})).toBe('filled');
    expect(resolveFillStyle({ fillStyle: undefined })).toBe('filled');
  });

  it('reads the two spellings it stores', () => {
    expect(resolveFillStyle({ fillStyle: 'filled' })).toBe('filled');
    expect(resolveFillStyle({ fillStyle: 'outline' })).toBe('outline');
  });
});

describe('shapePaint', () => {
  it('paints a filled shape with its fill and no outline at all', () => {
    expect(shapePaint(shape())).toEqual({ fill: DEFAULT_SWATCH.fill, stroke: null });
  });

  it('paints an outline shape white and draws the stroke it was already carrying', () => {
    expect(shapePaint(shape({ fillStyle: 'outline' }))).toEqual({
      fill: OUTLINE_FILL,
      stroke: DEFAULT_SWATCH.stroke,
    });
  });

  it('leaves the stored pair alone either way, so the toggle is lossless', () => {
    const data = shape({ fill: '#DBEAFE', stroke: '#93C5FD', fillStyle: 'outline' });
    expect(shapePaint(data).stroke).toBe('#93C5FD');
    expect(shapePaint({ ...data, fillStyle: 'filled' }).fill).toBe('#DBEAFE');
  });

  it('keeps a floating arrow’s anchor invisible, whatever the field says', () => {
    const anchor = shape({ fill: 'transparent', stroke: 'transparent' });
    expect(shapePaint(anchor)).toEqual({ fill: 'transparent', stroke: null });
    expect(shapePaint({ ...anchor, fillStyle: 'outline' })).toEqual({
      fill: 'transparent',
      stroke: null,
    });
  });

  it('never puts a white box behind a text shape', () => {
    const text = shape({ shape: 'text', fill: 'transparent', fillStyle: 'outline' });
    expect(shapePaint(text)).toEqual({ fill: 'transparent', stroke: null });
  });
});

describe('the default swatch', () => {
  it('is white, and white takes dark text', () => {
    expect(DEFAULT_SWATCH.fill).toBe('#FFFFFF');
    expect(isDarkFill('#FFFFFF')).toBe(false);
    // A new shape is therefore a white card on the board: filled, borderless,
    // standing on the board’s grey rather than on a shadow.
    expect(shapePaint(shape())).toEqual({ fill: '#FFFFFF', stroke: null });
  });
});
