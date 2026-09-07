import { describe, expect, it } from 'vitest';
import { MAX_PER_ROW, PASTE_GAP, linesOf, stackAlong, stickyGrid } from './pasteAs';

describe('linesOf', () => {
  it('keeps the words and drops the markers', () => {
    expect(linesOf('- one\n* two\n• three\n+ four\n1. five\n2) six')).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
    ]);
  });

  it('strips a checkbox as well as the bullet in front of it', () => {
    expect(linesOf('- [ ] ship it\n- [x] done')).toEqual(['ship it', 'done']);
    // A checkbox with no bullet is a list too.
    expect(linesOf('[ ] alone')).toEqual(['alone']);
  });

  it('drops blank lines and lines that were only a marker', () => {
    expect(linesOf('one\n\n   \ntwo')).toEqual(['one', 'two']);
    // A rule in the middle of a pasted list is not a sticky note.
    expect(linesOf('one\n-\ntwo')).toEqual(['one', 'two']);
    expect(linesOf('one\n---\ntwo')).toEqual(['one', 'two']);
  });

  it('does not mistake emphasis or a negative number for a marker', () => {
    expect(linesOf('**bold**\n-30 degrees')).toEqual(['**bold**', '-30 degrees']);
  });

  it('ignores indentation, so a nested list is still one note per line', () => {
    expect(linesOf('- top\n    - nested\n\t- tabbed')).toEqual(['top', 'nested', 'tabbed']);
  });

  it('leaves a dash inside the words alone', () => {
    expect(linesOf('- well-behaved — really')).toEqual(['well-behaved — really']);
  });

  it('reads a plain paragraph as one line, and empty text as none', () => {
    expect(linesOf('just some words')).toEqual(['just some words']);
    expect(linesOf('')).toEqual([]);
    expect(linesOf('\n\n')).toEqual([]);
  });

  it('handles CRLF, which is what a Windows clipboard hands over', () => {
    expect(linesOf('one\r\ntwo')).toEqual(['one', 'two']);
  });
});

describe('stickyGrid', () => {
  const origin = { x: 100, y: 40 };
  const size = { width: 160, height: 160 };

  it('puts the first note exactly on the origin', () => {
    const [first] = stickyGrid(['a', 'b', 'c'], origin, size);
    expect(first).toMatchObject({ label: 'a', x: 100, y: 40, width: 160, height: 160 });
  });

  it('lays four notes out as a square with the gap between them', () => {
    const boxes = stickyGrid(['a', 'b', 'c', 'd'], origin, size);
    expect(boxes.map((b) => [b.x - origin.x, b.y - origin.y])).toEqual([
      [0, 0],
      [160 + PASTE_GAP, 0],
      [0, 160 + PASTE_GAP],
      [160 + PASTE_GAP, 160 + PASTE_GAP],
    ]);
  });

  it('uses rows of ceil(sqrt(n)) up to the cap, then keeps that width', () => {
    const rowOf = (n: number) => {
      const boxes = stickyGrid(Array.from({ length: n }, (_, i) => `${i}`), origin, size);
      return boxes.filter((b) => b.y === origin.y).length;
    };
    expect(rowOf(1)).toBe(1);
    expect(rowOf(2)).toBe(2);
    expect(rowOf(9)).toBe(3);
    expect(rowOf(16)).toBe(4);
    // 30 lines would want a row of 6; the cap holds it at five.
    expect(rowOf(30)).toBe(MAX_PER_ROW);
  });

  it('leaves the last row short rather than centring it', () => {
    const boxes = stickyGrid(['a', 'b', 'c'], origin, size);
    expect(boxes[2]).toMatchObject({ x: origin.x, y: origin.y + 160 + PASTE_GAP });
  });

  it('makes nothing out of nothing', () => {
    expect(stickyGrid([], origin, size)).toEqual([]);
  });
});

describe('stackAlong', () => {
  const sizes = [
    { width: 180, height: 100 },
    { width: 120, height: 120 },
    { width: 180, height: 70 },
  ];

  it('stacks downwards with every box on the origin\'s left edge', () => {
    expect(stackAlong(sizes, { x: 10, y: 20 }, 'vertical', 10)).toEqual([
      { x: 10, y: 20 },
      { x: 10, y: 130 },
      { x: 10, y: 260 },
    ]);
  });

  it('runs across with every box on the origin\'s top edge', () => {
    expect(stackAlong(sizes, { x: 10, y: 20 }, 'horizontal', 10)).toEqual([
      { x: 10, y: 20 },
      { x: 200, y: 20 },
      { x: 330, y: 20 },
    ]);
  });

  it('puts the run\'s bounding-box corner on the origin, which is what layout anchors to', () => {
    for (const axis of ['vertical', 'horizontal'] as const) {
      const points = stackAlong(sizes, { x: -30, y: 12 }, axis);
      expect(Math.min(...points.map((p) => p.x))).toBe(-30);
      expect(Math.min(...points.map((p) => p.y))).toBe(12);
    }
  });
});
