import { describe, expect, it } from 'vitest';
import { DEFAULT_EDGE_STROKE } from './defaults';
import {
  DEFAULT_SWATCH,
  GRID_COLUMNS,
  PALETTE,
  STICKY_TINT,
  isDarkFill,
  isHex6,
  matchSwatch,
  mix,
  swatchFromHex,
  swatchPair,
} from './palette';

const expected = [
  ['white', 'White', '#FFFFFF', '#CBD5E1'],
  ['smoke', 'Smoke', '#C4CFDA', '#C4CFDA'],
  ['gray', 'Gray', '#788896', '#788896'],
  ['slate', 'Slate', '#4D5D6C', '#4D5D6C'],
  ['blue', 'Blue', '#2987D7', '#2987D7'],
  ['indigo', 'Indigo', '#655BF3', '#655BF3'],
  ['purple', 'Purple', '#730FC3', '#730FC3'],
  ['pink', 'Pink', '#BE36D3', '#BE36D3'],
  ['mint', 'Mint', '#26AFA0', '#26AFA0'],
  ['green', 'Green', '#007A6F', '#007A6F'],
  ['brown', 'Brown', '#897A5F', '#897A5F'],
  ['crimson', 'Crimson', '#A46767', '#A46767'],
  ['red', 'Red', '#D5475B', '#D5475B'],
  ['orange', 'Orange', '#E8843C', '#E8843C'],
  ['yellow', 'Yellow', '#F0C54F', '#F0C54F'],
] as const;

describe('PALETTE', () => {
  it('uses the 15 named colours in grid order with unique ids and four columns', () => {
    expect(GRID_COLUMNS).toBe(4);
    expect(PALETTE).toHaveLength(15);
    expect(PALETTE.map(({ id }) => id)).toEqual(expected.map(([id]) => id));
    expect(PALETTE.map(({ name }) => name)).toEqual(expected.map(([, name]) => name));
    expect(new Set(PALETTE.map(({ id }) => id)).size).toBe(15);
  });

  it('keeps the exact fill and stroke pair for every swatch', () => {
    for (const [index, [id, name, fill, stroke]] of expected.entries()) {
      expect(PALETTE[index]).toMatchObject({ id, name, fill, stroke });
    }
  });

  it('precomputes each sticky fill by mixing its fill towards white', () => {
    for (const swatch of PALETTE) {
      expect(swatch.sticky).toBe(mix(swatch.fill, '#FFFFFF', STICKY_TINT));
    }
    expect(PALETTE[0].sticky).toBe('#FFFFFF');
  });

  it('defaults to White and keeps Gray aligned with the connector default', () => {
    expect(DEFAULT_SWATCH).toBe(PALETTE[0]);
    expect(DEFAULT_SWATCH).toMatchObject({ id: 'white', fill: '#FFFFFF', stroke: '#CBD5E1' });
    expect(PALETTE.find(({ id }) => id === 'gray')?.stroke).toBe(DEFAULT_EDGE_STROKE);
  });

  it('derives custom swatches in uppercase and pairs sticky colours', () => {
    expect(swatchFromHex('#12abef')).toEqual({
      id: 'custom',
      name: '#12ABEF',
      fill: '#12ABEF',
      stroke: '#12ABEF',
      sticky: mix('#12ABEF', '#FFFFFF', 0.75),
    });
    expect(swatchPair(PALETTE[4], 'shape')).toEqual({ fill: '#2987D7', stroke: '#2987D7' });
    expect(swatchPair(PALETTE[4], 'sticky')).toEqual({ fill: '#CAE1F5', stroke: '#2987D7' });
  });

  it('matches shape, sticky and edge colours exactly without regard to case', () => {
    const blue = PALETTE.find(({ id }) => id === 'blue')!;
    expect(matchSwatch({ fill: '#2987d7', stroke: '#2987D7' }, 'shape')).toBe(blue);
    expect(matchSwatch({ fill: '#cae1f5', stroke: '#2987d7' }, 'sticky')).toBe(blue);
    expect(matchSwatch({ stroke: '#788896' }, 'edge')).toBe(PALETTE.find(({ id }) => id === 'gray'));
  });

  it('leaves old and mixed colour pairs without an active swatch', () => {
    expect(matchSwatch({ fill: '#2C88D9', stroke: '#236DAE' }, 'shape')).toBeNull();
    expect(matchSwatch({ fill: '#FFFFFF', stroke: '#E8843C' }, 'shape')).toBeNull();
  });

  it('accepts only six digit hexadecimal colours', () => {
    expect(isHex6('#a1B2c3')).toBe(true);
    expect(isHex6('#fff')).toBe(false);
    expect(isHex6('transparent')).toBe(false);
  });
});

describe('isDarkFill', () => {
  it('uses white text for the specified dark swatches', () => {
    const whiteText = ['slate', 'blue', 'indigo', 'purple', 'pink', 'green', 'brown', 'crimson', 'red'];
    for (const swatch of PALETTE) {
      expect(isDarkFill(swatch.fill), swatch.name).toBe(whiteText.includes(swatch.id));
    }
  });

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
    expect(mix('#2987D7', '#FFFFFF', 0)).toBe('#2987D7');
    expect(mix('#2987D7', '#FFFFFF', 1)).toBe('#FFFFFF');
  });
});
