import { describe, expect, it } from 'vitest';
import { frameStyle } from './frameStyle';

describe('frameStyle', () => {
  it('paints an uncoloured frame as the theme panel and rule, exactly as before', () => {
    expect(frameStyle({ fill: 'transparent', stroke: 'transparent' })).toEqual({
      background: 'var(--panel)',
      borderColor: 'var(--line)',
    });
    expect(frameStyle({ fill: 'transparent', stroke: 'transparent', transparent: false })).toEqual(
      frameStyle({ fill: 'transparent', stroke: 'transparent' }),
    );
  });

  it('tones a coloured frame down over the panel', () => {
    expect(frameStyle({ fill: '#DBEAFE', stroke: '#3B82F6' })).toEqual({
      background: 'color-mix(in srgb, #DBEAFE 28%, var(--panel))',
      borderColor: 'color-mix(in srgb, #3B82F6 55%, var(--line))',
    });
  });

  it('clears the inside of a transparent frame and keeps the coloured border', () => {
    expect(frameStyle({ fill: '#DBEAFE', stroke: '#3B82F6', transparent: true })).toEqual({
      background: 'transparent',
      borderColor: 'color-mix(in srgb, #3B82F6 55%, var(--line))',
    });
  });

  it('gives an uncoloured transparent frame a rule strong enough to read on the bare board', () => {
    const style = frameStyle({ fill: 'transparent', stroke: 'transparent', transparent: true });
    expect(style.background).toBe('transparent');
    expect(style.borderColor).not.toBe('var(--line)');
    expect(style.borderColor).toContain('var(--ink-600)');
  });
});
