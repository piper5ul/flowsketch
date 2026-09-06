import { describe, expect, it } from 'vitest';
import { canRoundCorners, canSwapShapeKind, isAnchorNode } from './nodeKinds';
import type { ShapeData, ShapeKind } from '../types';

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

  it('refuses the anchor nodes a floating arrow hangs off', () => {
    // Redrawing one as a star would give a 1×1 invisible endpoint a silhouette.
    expect(canSwapShapeKind(data({ fill: 'transparent', stroke: 'transparent' }))).toBe(false);
  });
});

describe('canRoundCorners', () => {
  it('is true for the two shapes drawn as a box with corners', () => {
    expect(canRoundCorners('rectangle')).toBe(true);
    expect(canRoundCorners('sticky')).toBe(true);
  });

  it('is false for everything already round, drawn as a path, or drawn as nothing', () => {
    const others: ShapeKind[] = ['ellipse', 'pill', 'cylinder', 'star', 'diamond', 'text', 'image'];
    for (const kind of others) expect(canRoundCorners(kind), kind).toBe(false);
  });
});
