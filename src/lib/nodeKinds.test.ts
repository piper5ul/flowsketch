import { describe, expect, it } from 'vitest';
import { canSwapShapeKind, isAnchorNode } from './nodeKinds';
import type { ShapeData } from '../types';

const data = (patch: Partial<ShapeData>): ShapeData => ({
  label: '',
  shape: 'rectangle',
  fill: '#DCEAFB',
  stroke: '#3B82F6',
  ...patch,
});

describe('isAnchorNode', () => {
  it('recognises the invisible 1×1 rectangle a floating arrow hangs off', () => {
    expect(isAnchorNode(data({ fill: 'transparent', stroke: 'transparent' }))).toBe(true);
  });

  it('does not mistake a text shape for one', () => {
    // Text shapes are transparent too, but they are real, editable content.
    expect(isAnchorNode(data({ shape: 'text', fill: 'transparent', stroke: 'transparent' }))).toBe(false);
  });

  it('does not mistake an image node for one', () => {
    // Image nodes carry no fill or stroke of their own.
    expect(
      isAnchorNode(data({ shape: 'image', fill: 'transparent', stroke: 'transparent', imageSrc: '/api/images/x' })),
    ).toBe(false);
  });

  it('is false for an ordinary filled shape', () => {
    expect(isAnchorNode(data({}))).toBe(false);
  });

  it('needs both fill and stroke to be transparent', () => {
    expect(isAnchorNode(data({ fill: 'transparent' }))).toBe(false);
    expect(isAnchorNode(data({ stroke: 'transparent' }))).toBe(false);
  });
});

describe('canSwapShapeKind', () => {
  it('accepts an ordinary drawn shape', () => {
    expect(canSwapShapeKind(data({ shape: 'rectangle' }))).toBe(true);
    expect(canSwapShapeKind(data({ shape: 'sticky' }))).toBe(true);
  });

  it('refuses images and text, which are not outlines to swap', () => {
    expect(canSwapShapeKind(data({ shape: 'image' }))).toBe(false);
    expect(canSwapShapeKind(data({ shape: 'text' }))).toBe(false);
  });

  it('refuses a locked shape', () => {
    expect(canSwapShapeKind(data({ locked: true }))).toBe(false);
  });
});
