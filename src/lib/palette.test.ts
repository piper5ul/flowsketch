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
  sanitizeColor,
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

  it('does not do string work on malformed runtime values', () => {
    expect(matchSwatch({ fill: 42, stroke: {} }, 'shape')).toBeNull();
    expect(matchSwatch(null, 'edge')).toBeNull();
    expect(isDarkFill(42)).toBe(false);
    expect(isDarkFill({})).toBe(false);
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

describe('sanitizeColor', () => {
  it('keeps the exact hex, functional and transparent spellings the app supports', () => {
    for (const colour of [
      '#abc', '#A1B2C3', '#a1b2c3d4',
      'rgb(12, 34, 56)', 'rgba(12, 34, 56, 0.5)', 'transparent',
    ]) {
      expect(sanitizeColor(colour)).toBe(colour);
    }
  });

  it.each([
    ['URL', 'url(https://attacker.example/pixel)'],
    ['CSS expression', 'expression(alert(1))'],
    ['number', 42],
    ['object', { toString: 'red' }],
    ['custom property', 'var(--x)'],
  ])('rejects a %s colour value', (_label, value) => {
    expect(sanitizeColor(value)).toBeUndefined();
  });

  it('does not accept CSS names because stored palettes have always used hex', () => {
    expect(sanitizeColor('red')).toBeUndefined();
    expect(sanitizeColor('windowtext')).toBeUndefined();
  });

  it('preserves all fill and stroke hexes from the previous 48-swatch palette', () => {
    const legacy = [
      ['#FFFFFF', '#CBD5E1'], ['#D9EAF8', '#96C4EC'], ['#E3E1FD', '#B2ACFA'],
      ['#E6D4F4', '#B987E1'], ['#F3DAF7', '#DE9AE8'], ['#D6F0EE', '#8DD7CF'],
      ['#D7E7E4', '#90BCB4'], ['#EAE7E2', '#C4BDAF'], ['#F0E3E3', '#D6B1B1'],
      ['#F7DEE1', '#E9A2AD'], ['#FBE9DC', '#F4C19D'], ['#FEF4D8', '#FBE192'],
      ['#DFE6ED', '#9EADBA'], ['#ABCFF0', '#61A6E3'], ['#C1BCFB', '#8C82F8'],
      ['#C79FE7', '#964BD2'], ['#E5AEED', '#CE67DD'], ['#A3DFD9', '#53C2B7'],
      ['#A6C9C3', '#589A8E'], ['#D0CABF', '#A79B87'], ['#DEC1C1', '#C18A8A'],
      ['#EDB5BD', '#DE7484'], ['#F6CDB0', '#EEA26B'], ['#FCE7A8', '#F9D25C'],
      ['#788896', '#4B5C6B'], ['#2C88D9', '#236DAE'], ['#6558F5', '#5146C4'],
      ['#730FC3', '#5C0C9C'], ['#BD34D1', '#972AA7'], ['#1AAE9F', '#158B7F'],
      ['#207868', '#1A6053'], ['#897A5F', '#6E624C'], ['#AC6363', '#8A4F4F'],
      ['#D3455B', '#A93749'], ['#E8833A', '#BA692E'], ['#F7C325', '#C69C1E'],
      ['#293845', '#19232C'], ['#184B77', '#123657'], ['#383087', '#282362'],
      ['#3F086B', '#2E064E'], ['#681D73', '#4C1554'], ['#0E6057', '#0A4640'],
      ['#124239', '#0D302A'], ['#4B4334', '#373126'], ['#5F3636', '#452828'],
      ['#742632', '#541C24'], ['#804820', '#5D3417'], ['#886B14', '#634E0F'],
    ];

    for (const [fill, stroke] of legacy) {
      expect(sanitizeColor(fill), `fill ${fill}`).toBe(fill);
      expect(sanitizeColor(stroke), `stroke ${stroke}`).toBe(stroke);
    }
  });
});

describe('mix', () => {
  it('moves a colour towards another by a fraction, and keeps the ends', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#2987D7', '#FFFFFF', 0)).toBe('#2987D7');
    expect(mix('#2987D7', '#FFFFFF', 1)).toBe('#FFFFFF');
  });

  it('returns a safe colour when a caller hands it a non-string', () => {
    expect(mix(42 as unknown as string, '#FFFFFF', 0.5)).toBe('#FFFFFF');
    expect(mix('#000000', {} as unknown as string, 0.5)).toBe('#FFFFFF');
  });
});
