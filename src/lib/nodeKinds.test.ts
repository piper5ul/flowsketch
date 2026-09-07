import { describe, expect, it } from 'vitest';
import {
  canRoundCorners,
  canSwapShapeKind,
  isAnchorNode,
  isContainerNode,
  isInkNode,
  isTableNode,
  isWireNode,
} from './nodeKinds';
import type { DiagramNodeType, ShapeData, ShapeKind } from '../types';

const data = (patch: Partial<ShapeData>): ShapeData => ({
  label: '',
  shape: 'rectangle',
  fill: '#DCEAFB',
  stroke: '#3B82F6',
  ...patch,
});

/** A node of `type` carrying that data — what `canSwapShapeKind` is asked about. */
const node = (patch: Partial<ShapeData>, type: DiagramNodeType = 'shape') => ({
  type,
  data: data(patch),
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

describe('isInkNode', () => {
  it('reads the type, not the data', () => {
    expect(isInkNode({ type: 'ink' })).toBe(true);
    expect(isInkNode({ type: 'shape' })).toBe(false);
    expect(isInkNode({})).toBe(false);
  });

  it('does not mistake a stroke for a floating arrow\'s anchor', () => {
    // An ink node's fill is transparent but its stroke is the pen's colour, so
    // the anchor test — which needs *both* — cannot match one.
    expect(isAnchorNode(data({ fill: 'transparent', stroke: '#334155' }))).toBe(false);
  });
});

describe('canSwapShapeKind', () => {
  it('accepts an ordinary drawn shape', () => {
    expect(canSwapShapeKind(node({ shape: 'rectangle' }))).toBe(true);
    expect(canSwapShapeKind(node({ shape: 'sticky' }))).toBe(true);
  });

  it('refuses images and text, which are not outlines to swap', () => {
    expect(canSwapShapeKind(node({ shape: 'image' }))).toBe(false);
    expect(canSwapShapeKind(node({ shape: 'text' }))).toBe(false);
  });

  it('refuses a locked shape', () => {
    expect(canSwapShapeKind(node({ locked: true }))).toBe(false);
  });

  it('refuses the anchor nodes a floating arrow hangs off', () => {
    // Redrawing one as a star would give a 1×1 invisible endpoint a silhouette.
    expect(canSwapShapeKind(node({ fill: 'transparent', stroke: 'transparent' }))).toBe(false);
  });

  it('refuses a container and a freehand stroke, whatever their data says', () => {
    // All three carry an ordinary `ShapeData` whose `shape` is a rectangle
    // nothing draws — the `type` is the only thing that tells them apart.
    expect(canSwapShapeKind(node({}, 'group'))).toBe(false);
    expect(canSwapShapeKind(node({}, 'frame'))).toBe(false);
    expect(canSwapShapeKind(node({ fill: 'transparent' }, 'ink'))).toBe(false);
  });

  it('refuses a wireframe component: what it draws is its component, not a silhouette', () => {
    expect(canSwapShapeKind(node({ wire: { component: 'button' } }, 'wire'))).toBe(false);
    // Its data is a rectangle's, so the type is what has to answer.
    expect(canSwapShapeKind(node({ wire: { component: 'button' } }))).toBe(true);
  });
});

describe('isWireNode', () => {
  it('recognises a wireframe component by its type', () => {
    expect(isWireNode({ type: 'wire' })).toBe(true);
  });

  it('is false for every other kind of node, data notwithstanding', () => {
    for (const type of ['shape', 'frame', 'group', 'table', 'ink', undefined]) {
      expect(isWireNode({ type }), String(type)).toBe(false);
    }
  });

  it('is not a container: nothing hangs off a browser frame in this build', () => {
    expect(isContainerNode({ type: 'wire' })).toBe(false);
  });

  it('is not mistaken for a floating arrow’s endpoint: its two colours are the palette, not transparent', () => {
    expect(isAnchorNode(data({ fill: '#EAEFF4', stroke: '#9EADBA' }))).toBe(false);
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

describe('isTableNode', () => {
  it('recognises a table by its type', () => {
    expect(isTableNode({ type: 'table' })).toBe(true);
  });

  it('is false for every other kind of node', () => {
    for (const type of ['shape', 'frame', 'group', undefined]) {
      expect(isTableNode({ type }), String(type)).toBe(false);
    }
  });

  it('is not a container: nothing hangs off a table', () => {
    expect(isContainerNode({ type: 'table' })).toBe(false);
    expect(isContainerNode({ type: 'frame' })).toBe(true);
    expect(isContainerNode({ type: 'group' })).toBe(true);
  });
});
