import { describe, expect, it } from 'vitest';
import { anchorFor, boardRect, facingSide, nodeAtPoint, sideAnchor, OPPOSITE_SIDE } from './connectorGesture';

const frame = { id: 'f', position: { x: 100, y: 100 }, width: 600, height: 400 };
const child = { id: 'c', parentId: 'f', position: { x: 50, y: 50 }, width: 200, height: 100 };
const loose = { id: 'l', position: { x: 900, y: 100 }, width: 100, height: 100 };
const unsized = { id: 'u', position: { x: 0, y: 0 } };
const nodes = [frame, child, loose, unsized];

describe('boardRect', () => {
  it('folds the parent offset in and falls back to the measured size', () => {
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    expect(boardRect(child, byId)).toEqual({ x: 150, y: 150, width: 200, height: 100 });
    expect(boardRect({ id: 'm', position: { x: 1, y: 2 }, measured: { width: 30, height: 40 } }, byId)).toEqual({ x: 1, y: 2, width: 30, height: 40 });
    expect(boardRect(unsized, byId)).toBeNull();
  });
});

describe('nodeAtPoint', () => {
  it('picks the innermost shape inside a frame, and the frame beside it', () => {
    expect(nodeAtPoint(nodes, { x: 200, y: 200 })?.id).toBe('c');
    expect(nodeAtPoint(nodes, { x: 120, y: 450 })?.id).toBe('f');
  });

  it('finds a loose shape and nothing on empty board', () => {
    expect(nodeAtPoint(nodes, { x: 950, y: 150 })?.id).toBe('l');
    expect(nodeAtPoint(nodes, { x: 800, y: 800 })).toBeNull();
  });

  it('leaves out what the caller says to skip', () => {
    expect(nodeAtPoint(nodes, { x: 200, y: 200 }, (n) => n.id === 'c')?.id).toBe('f');
  });
});

describe('anchorFor', () => {
  it('pins the connector to the nearest point on the outline, in board coordinates', () => {
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    // 30px from the child's bottom edge (y = 250), a quarter of the way along it.
    expect(anchorFor(child, byId, { x: 200, y: 240 })).toEqual({ side: 'bottom', t: 0.25 });
    expect(anchorFor(unsized, byId, { x: 0, y: 0 })).toBeNull();
  });
});

describe('facingSide', () => {
  it('names the side of the far box that looks back at the near one', () => {
    expect(facingSide({ x: 0, y: 0 }, { x: 100, y: 10 })).toBe('left');
    expect(facingSide({ x: 0, y: 0 }, { x: -100, y: 10 })).toBe('right');
    expect(facingSide({ x: 0, y: 0 }, { x: 10, y: 100 })).toBe('top');
    expect(facingSide({ x: 0, y: 0 }, { x: 10, y: -100 })).toBe('bottom');
  });

  it('is the mirror of OPPOSITE_SIDE and sideAnchor is a side’s middle', () => {
    expect(OPPOSITE_SIDE[facingSide({ x: 0, y: 0 }, { x: 100, y: 0 })]).toBe('right');
    expect(sideAnchor('top')).toEqual({ side: 'top', t: 0.5 });
  });
});
