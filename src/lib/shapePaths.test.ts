import { describe, expect, it } from 'vitest';
import { isClipShape, svgPaths } from './shapePaths';
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
