import { describe, expect, it } from 'vitest';
import { isClipShape, svgPaths, textInset } from './shapePaths';
import { SHAPE_KINDS } from './nodeKinds';
import type { ShapeKind } from '../types';

describe('svgPaths', () => {
  it('draws every kind `isClipShape` claims, and only those', () => {
    const drawn = SHAPE_KINDS.filter((kind) => isClipShape(kind));
    expect(drawn.sort()).toEqual(Object.keys(svgPaths).sort());
  });

  it('gives every clip kind a closed outline inside the 0–100 box', () => {
    for (const [kind, d] of Object.entries(svgPaths)) {
      // Closed, because the outline is filled rather than stroked open — an
      // unclosed path leaves the shape with a hole down one side.
      expect(d, kind).toMatch(/^M /);
      expect(d.trimEnd(), kind).toMatch(/Z$/);

      // Every coordinate is a proportion of the node's box; anything outside
      // 0–100 would be clipped away by the viewBox.
      const numbers = d.match(/-?\d+(\.\d+)?/g) ?? [];
      expect(numbers.length, kind).toBeGreaterThan(0);
      for (const n of numbers) {
        expect(Number(n), `${kind}: ${n}`).toBeGreaterThanOrEqual(0);
        expect(Number(n), `${kind}: ${n}`).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('isClipShape', () => {
  it('is false for the kinds CSS can draw on its own', () => {
    const cssShapes: ShapeKind[] = ['rectangle', 'ellipse', 'pill', 'sticky', 'text', 'cylinder', 'image'];
    for (const kind of cssShapes) expect(isClipShape(kind), kind).toBe(false);
  });

  it('is true for the six shapes added alongside the originals', () => {
    const added: ShapeKind[] = ['parallelogram', 'document', 'cloud', 'star', 'callout', 'arrow'];
    for (const kind of added) expect(isClipShape(kind), kind).toBe(true);
  });
});

describe('textInset', () => {
  it('leaves a box shape alone: its whole face holds text', () => {
    for (const kind of ['rectangle', 'sticky', 'ellipse', 'pill', 'text'] as ShapeKind[]) {
      expect(textInset(kind), kind).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    }
  });

  it('answers for every shape kind', () => {
    for (const kind of SHAPE_KINDS) {
      const inset = textInset(kind);
      // Percentages of the node's own box, so opposite sides can never eat it.
      expect(inset.left + inset.right, kind).toBeLessThan(100);
      expect(inset.top + inset.bottom, kind).toBeLessThan(100);
      for (const [side, value] of Object.entries(inset)) {
        expect(value, `${kind}.${side}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('pulls a star\'s label into the pentagon between its points', () => {
    const star = textInset('star');
    // At mid-height the star spans roughly x 23–77, so anything narrower than
    // a ~22% inset would put text out over the points.
    expect(star.left).toBeGreaterThanOrEqual(22);
    expect(star.right).toBeGreaterThanOrEqual(22);
    expect(star.top).toBeGreaterThan(0);
    expect(star.bottom).toBeGreaterThan(0);
  });

  it('clears the callout\'s tail, which hangs below the bubble', () => {
    // The bubble ends at y=85 and the tail runs to y=100.
    expect(textInset('callout').bottom).toBeGreaterThanOrEqual(15);
  });

  it('clears the ripple along a document\'s bottom edge', () => {
    // The wave dips to y≈84 at its deepest point above the baseline.
    expect(textInset('document').bottom).toBeGreaterThanOrEqual(16);
  });

  it('keeps a cloud\'s label under its top bump', () => {
    const cloud = textInset('cloud');
    // The cloud's body starts around y=17 but is only full width below y≈45.
    expect(cloud.top).toBeGreaterThanOrEqual(25);
    expect(cloud.left).toBeGreaterThan(0);
  });

  it('sits an arrow\'s label on the shaft rather than in the head', () => {
    const arrow = textInset('arrow');
    // The head starts at x=62, so the text has to stop short of it — which
    // makes this the one shape whose inset is deliberately lopsided.
    expect(arrow.right).toBeGreaterThan(arrow.left);
    expect(100 - arrow.right).toBeLessThanOrEqual(62);
    // The shaft spans y 25–75; the label has to stay between those.
    expect(arrow.top).toBeGreaterThanOrEqual(25);
    expect(arrow.bottom).toBeGreaterThanOrEqual(25);
  });
});
