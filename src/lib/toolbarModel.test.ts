import { describe, expect, it } from 'vitest';
import { connectorBarSlots, shapeBarSlots, textBarSlots, type ShapeBarSummary } from './toolbarModel';

const summary = (patch: Partial<ShapeBarSummary> = {}): ShapeBarSummary => ({
  selectedNodes: 1,
  textableNodes: 1,
  swappableNodes: 1,
  colourableNodes: 1,
  styleableNodes: 1,
  tableNode: false,
  canAddComment: true,
  ...patch,
});

describe('shapeBarSlots', () => {
  it.each([
    [
      'one rectangle-like shape',
      summary(),
      ['text', 'changeShape', 'separator', 'color', 'separator', 'fillStyle', 'style', 'separator', 'duplicate', 'addComment', 'moreActions'],
    ],
    [
      'a sticky note',
      summary(),
      ['text', 'changeShape', 'separator', 'color', 'separator', 'fillStyle', 'style', 'separator', 'duplicate', 'addComment', 'moreActions'],
    ],
    [
      'a text shape (the existing kind-swap gate excludes it)',
      summary({ swappableNodes: 0 }),
      ['text', 'separator', 'color', 'separator', 'fillStyle', 'style', 'separator', 'duplicate', 'addComment', 'moreActions'],
    ],
    [
      'a wireframe with a label',
      summary({ swappableNodes: 0, styleableNodes: 0 }),
      ['text', 'separator', 'color', 'separator', 'duplicate', 'addComment', 'moreActions'],
    ],
    [
      'a wireframe without a label',
      summary({ textableNodes: 0, swappableNodes: 0, styleableNodes: 0 }),
      ['color', 'separator', 'duplicate', 'addComment', 'moreActions'],
    ],
    [
      'one table',
      summary({ textableNodes: 0, swappableNodes: 0, styleableNodes: 0, tableNode: true }),
      ['color', 'separator', 'table', 'headerRow', 'separator', 'duplicate', 'addComment', 'moreActions'],
    ],
    [
      'one ink stroke',
      summary({ textableNodes: 0, swappableNodes: 0, styleableNodes: 0 }),
      ['color', 'separator', 'duplicate', 'addComment', 'moreActions'],
    ],
    [
      'one frame',
      summary({ textableNodes: 0, swappableNodes: 0, styleableNodes: 0 }),
      ['color', 'separator', 'duplicate', 'addComment', 'moreActions'],
    ],
    [
      'one group',
      summary({ textableNodes: 0, swappableNodes: 0, colourableNodes: 0, styleableNodes: 0 }),
      ['duplicate', 'addComment', 'moreActions'],
    ],
    [
      'one image',
      summary({ textableNodes: 0, swappableNodes: 0, colourableNodes: 0, styleableNodes: 0 }),
      ['duplicate', 'addComment', 'moreActions'],
    ],
    [
      'a multi-selection',
      summary({ selectedNodes: 2, textableNodes: 2, swappableNodes: 2, colourableNodes: 2, styleableNodes: 2 }),
      ['text', 'changeShape', 'separator', 'color', 'separator', 'fillStyle', 'style', 'separator', 'filterSelection', 'separator', 'duplicate', 'moreActions'],
    ],
    ['connectors only (handled by the connector bar)', summary({ selectedNodes: 0, textableNodes: 0, swappableNodes: 0, colourableNodes: 0, styleableNodes: 0, canAddComment: false }), []],
  ])('maps %s to its visible groups', (_name, input, expected) => {
    expect(shapeBarSlots(input as ShapeBarSummary)).toEqual(expected);
  });

  it('omits Add comment when the command is not offered for a single node', () => {
    expect(shapeBarSlots(summary({ canAddComment: false }))).toEqual([
      'text', 'changeShape', 'separator', 'color', 'separator', 'fillStyle', 'style', 'separator', 'duplicate', 'moreActions',
    ]);
  });
});

describe('connectorBarSlots', () => {
  it('adds Reset route only when a waypoint exists', () => {
    expect(connectorBarSlots(false)).toEqual([
      'text', 'separator', 'color', 'separator', 'connectorKind', 'separator', 'line', 'separator', 'startArrow', 'endArrow', 'separator', 'moreActions',
    ]);
    expect(connectorBarSlots(true)).toEqual([
      'text', 'separator', 'color', 'separator', 'connectorKind', 'separator', 'line', 'separator', 'startArrow', 'endArrow', 'separator', 'resetRoute', 'moreActions',
    ]);
  });
});

describe('textBarSlots', () => {
  it('lays out a single shape label with Link and both align groups', () => {
    expect(textBarSlots('shape', false)).toEqual([
      'finishEditing', 'separator', 'textSize', 'separator', 'textStyle', 'separator', 'link', 'separator', 'horizontalAlign', 'verticalAlign',
    ]);
  });

  it('omits Link for multi/locked shape labels and all shape-only controls for connector labels', () => {
    expect(textBarSlots('shape', true)).toEqual([
      'finishEditing', 'separator', 'textSize', 'separator', 'textStyle', 'separator', 'horizontalAlign', 'verticalAlign',
    ]);
    expect(textBarSlots('connectorLabel', false)).toEqual([
      'finishEditing', 'separator', 'textSize', 'separator', 'textStyle',
    ]);
    expect(textBarSlots('connectorLabel', true)).toEqual(textBarSlots('connectorLabel', false));
  });
});
