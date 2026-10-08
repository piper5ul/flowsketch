import { describe, expect, it } from 'vitest';
import type { ShapeData } from '../types';
import { DEFAULT_SWATCH, isDarkFill, mix } from './palette';
import {
  DASH_ARRAY,
  OUTLINE_FILL,
  resolveFillLook,
  resolveFillStyle,
  shapePaint,
} from './shapeStyle';

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
  it('reads absent and filled fields as Fill, and unknown values as Fill', () => {
    expect(resolveFillStyle({})).toBe('filled');
    expect(resolveFillStyle({ fillStyle: undefined })).toBe('filled');
    expect(resolveFillStyle({ fillStyle: 'filled' })).toBe('filled');
    expect(resolveFillStyle({ fillStyle: 'unknown' as ShapeData['fillStyle'] })).toBe('filled');
  });

  it('preserves every stored paint value including legacy outline', () => {
    expect(resolveFillStyle({ fillStyle: 'outline' })).toBe('outline');
    expect(resolveFillStyle({ fillStyle: 'tinted' })).toBe('tinted');
    expect(resolveFillStyle({ fillStyle: 'dashed' })).toBe('dashed');
  });
});

describe('resolveFillLook', () => {
  it.each([
    [undefined, 'fill'],
    ['filled', 'fill'],
    ['unknown', 'fill'],
    ['outline', 'outline'],
    ['tinted', 'outline'],
    ['dashed', 'dash'],
  ] as const)('maps %s to the %s toolbar look', (fillStyle, look) => {
    expect(resolveFillLook({ fillStyle: fillStyle as ShapeData['fillStyle'] })).toBe(look);
  });
});

describe('shapePaint', () => {
  it('paints absent and filled styles with their fill and no outline', () => {
    expect(shapePaint(shape())).toEqual({ fill: DEFAULT_SWATCH.fill, stroke: null, dashed: false });
    expect(shapePaint(shape({ fillStyle: 'filled' }))).toEqual({
      fill: DEFAULT_SWATCH.fill,
      stroke: null,
      dashed: false,
    });
  });

  it('keeps legacy outline white with the stored stroke', () => {
    expect(shapePaint(shape({ fillStyle: 'outline' }))).toEqual({
      fill: OUTLINE_FILL,
      stroke: DEFAULT_SWATCH.stroke,
      dashed: false,
    });
  });

  it('paints tinted Outline with a pale inside and solid stored stroke', () => {
    expect(shapePaint(shape({ fill: '#2987D7', stroke: '#2987D7', fillStyle: 'tinted' }))).toEqual({
      fill: '#D4E7F7',
      stroke: '#2987D7',
      dashed: false,
    });
  });

  it('paints Dash with the same pale inside and a dashed stored stroke', () => {
    expect(shapePaint(shape({ fill: '#2987D7', stroke: '#2987D7', fillStyle: 'dashed' }))).toEqual({
      fill: '#D4E7F7',
      stroke: '#2987D7',
      dashed: true,
    });
    expect(DASH_ARRAY).toBe('5 4');
  });

  it('falls back to Fill for unknown values and white for a non-hex tinted fill', () => {
    expect(shapePaint(shape({ fillStyle: 'other' as ShapeData['fillStyle'] }))).toEqual({
      fill: DEFAULT_SWATCH.fill,
      stroke: null,
      dashed: false,
    });
    expect(shapePaint(shape({ fill: 'transparent', fillStyle: 'tinted' }))).toEqual({
      fill: OUTLINE_FILL,
      stroke: DEFAULT_SWATCH.stroke,
      dashed: false,
    });
  });

  it.each([
    [undefined, null, false],
    ['filled', null, false],
    ['outline', DEFAULT_SWATCH.stroke, false],
    ['tinted', DEFAULT_SWATCH.stroke, false],
    ['dashed', DEFAULT_SWATCH.stroke, true],
  ] as const)('makes %s transparent without changing its border', (fillStyle, stroke, dashed) => {
    expect(shapePaint(shape({ fillStyle: fillStyle as ShapeData['fillStyle'], transparent: true }))).toEqual({
      fill: 'transparent',
      stroke,
      dashed,
    });
  });

  it('leaves a hand-authored Fill plus Transparent as label-only paint', () => {
    expect(shapePaint(shape({ fillStyle: 'filled', transparent: true }))).toEqual({
      fill: 'transparent',
      stroke: null,
      dashed: false,
    });
  });

  it('does not change the stored pair when resolving looks', () => {
    const data = shape({ fill: '#DBEAFE', stroke: '#93C5FD', fillStyle: 'tinted' });
    expect(shapePaint(data).stroke).toBe('#93C5FD');
    expect(shapePaint({ ...data, fillStyle: 'filled' }).fill).toBe('#DBEAFE');
  });

  it('falls back safely when a tinted fill is not a string', () => {
    const paint = shapePaint(shape({ fill: 42 as unknown as string, fillStyle: 'tinted' }));
    expect(paint.fill).toBe(OUTLINE_FILL);
  });

  it('keeps floating arrow anchors invisible whatever paint fields say', () => {
    const anchor = shape({ fill: 'transparent', stroke: 'transparent', fillStyle: 'dashed', transparent: true });
    expect(shapePaint(anchor)).toEqual({ fill: 'transparent', stroke: null, dashed: false });
  });

  it.each(['text', 'image'] as const)('%s ignores fillStyle and transparent', (kind) => {
    const data = shape({ shape: kind, fill: '#334455', fillStyle: 'dashed', transparent: true });
    expect(shapePaint(data)).toEqual({ fill: '#334455', stroke: null, dashed: false });
  });
});

describe('the default swatch', () => {
  it('is white and takes dark text', () => {
    expect(DEFAULT_SWATCH.fill).toBe('#FFFFFF');
    expect(isDarkFill('#FFFFFF')).toBe(false);
    expect(shapePaint(shape())).toEqual({ fill: '#FFFFFF', stroke: null, dashed: false });
  });
});

describe('outline tint', () => {
  it('mixes a fill 80% of the way to white', () => {
    expect(mix('#2987D7', '#FFFFFF', 0.8)).toBe('#D4E7F7');
  });
});
