import { describe, expect, it } from 'vitest';
import {
  maskRects,
  moveSlide,
  reorderSlides,
  slideBackground,
  slideScreenRect,
  slidesOf,
  type SlideNode,
} from './presentation';

/** A frame at `(x, y)`, 400×300 unless told otherwise. */
function frame(
  id: string,
  x: number,
  y: number,
  extra: Partial<Pick<SlideNode, 'width' | 'height' | 'parentId' | 'measured' | 'data'>> = {},
): SlideNode {
  const { data, ...rest } = extra;
  return {
    id,
    type: 'frame',
    position: { x, y },
    width: 400,
    height: 300,
    data: { label: '', fill: 'transparent', stroke: 'transparent', ...data },
    ...rest,
  };
}

function shape(id: string, x: number, y: number): SlideNode {
  return { id, type: 'shape', position: { x, y }, width: 100, height: 50, data: { label: id } };
}

describe('slidesOf', () => {
  it('takes the frames and nothing else', () => {
    const slides = slidesOf([shape('s1', 0, 0), frame('f1', 10, 10), shape('s2', 20, 20)]);
    expect(slides.map((s) => s.id)).toEqual(['f1']);
  });

  it('is empty on a board with no frames', () => {
    expect(slidesOf([shape('s1', 0, 0)])).toEqual([]);
  });

  it('orders unordered frames in reading order, down then across', () => {
    const slides = slidesOf([
      frame('c', 500, 900),
      frame('a', 900, 100),
      frame('b', 100, 100),
    ]);
    // Same row (y = 100): left to right. Then the lower one.
    expect(slides.map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });

  it('breaks a dead heat on the id, so the order never depends on the array', () => {
    const forwards = slidesOf([frame('b', 0, 0), frame('a', 0, 0)]);
    const backwards = slidesOf([frame('a', 0, 0), frame('b', 0, 0)]);
    expect(forwards.map((s) => s.id)).toEqual(['a', 'b']);
    expect(backwards.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('puts ordered frames first, by their number, and unordered ones after', () => {
    const slides = slidesOf([
      frame('top-left', 0, 0),
      frame('second', 900, 900, { data: { slideOrder: 1 } }),
      frame('first', 900, 500, { data: { slideOrder: 0 } }),
    ]);
    expect(slides.map((s) => s.id)).toEqual(['first', 'second', 'top-left']);
  });

  it('reads a slideOrder that is not a number as no order at all', () => {
    // `Diagram.data` is free-form JSON, so this is a shape a stored row can
    // really have — and sorting the board by it would be nonsense.
    const slides = slidesOf([
      frame('junk', 900, 900, { data: { slideOrder: 'first' } }),
      frame('real', 100, 100, { data: { slideOrder: 3 } }),
    ]);
    expect(slides.map((s) => s.id)).toEqual(['real', 'junk']);
  });

  it('measures a nested frame in board coordinates, and makes it a slide of its own', () => {
    // `inner` stores an offset from `outer`, so its raw y (20) would sort it
    // above a frame at y = 100 that it is really below.
    const slides = slidesOf([
      frame('outer', 0, 0, { width: 900, height: 900 }),
      frame('inner', 40, 20, { parentId: 'outer', width: 200, height: 150 }),
      frame('other', 0, 500),
    ]);
    expect(slides.map((s) => s.id)).toEqual(['outer', 'inner', 'other']);
    expect(slides[1].rect).toEqual({ x: 40, y: 20, w: 200, h: 150 });
    expect(slides[2].rect).toEqual({ x: 0, y: 500, w: 400, h: 300 });
  });

  it('names an unnamed frame after its place in the deck', () => {
    const slides = slidesOf([
      frame('a', 0, 0, { data: { label: 'Intro' } }),
      frame('b', 0, 500),
      frame('c', 0, 900, { data: { label: '   ' } }),
    ]);
    expect(slides.map((s) => s.title)).toEqual(['Intro', 'Frame 2', 'Frame 3']);
  });

  it('falls back to the measured size for a frame nothing has sized', () => {
    const slides = slidesOf([
      { id: 'f', type: 'frame', position: { x: 5, y: 6 }, measured: { width: 30, height: 40 }, data: {} },
    ]);
    expect(slides[0].rect).toEqual({ x: 5, y: 6, w: 30, h: 40 });
  });
});

describe('slideBackground', () => {
  it('is the panel for a frame with no colour of its own', () => {
    expect(slideBackground({ fill: 'transparent', stroke: 'transparent' })).toBe('var(--panel)');
    // A row written before frames could be coloured carries neither.
    expect(slideBackground({})).toBe('var(--panel)');
  });

  it('is a toned-down mix of the frame\'s own fill, exactly as FrameNode paints it', () => {
    expect(slideBackground({ fill: '#DBEAFE', stroke: '#93C5FD' })).toBe(
      'color-mix(in srgb, #DBEAFE 28%, var(--panel))',
    );
  });
});

describe('reorderSlides', () => {
  const board = [frame('a', 0, 0), frame('b', 0, 500), frame('c', 0, 900)];

  it('numbers the frames 0..n-1 in the order it is given', () => {
    expect(reorderSlides(board, ['c', 'a', 'b'])).toEqual([
      { id: 'c', data: { slideOrder: 0 } },
      { id: 'a', data: { slideOrder: 1 } },
      { id: 'b', data: { slideOrder: 2 } },
    ]);
  });

  it('writes nothing for a frame that already carries the number it would be given', () => {
    const ordered = [
      frame('a', 0, 0, { data: { slideOrder: 0 } }),
      frame('b', 0, 500, { data: { slideOrder: 2 } }),
    ];
    expect(reorderSlides(ordered, ['a', 'b'])).toEqual([{ id: 'b', data: { slideOrder: 1 } }]);
  });

  it('is empty when the order asked for is the one the board has', () => {
    const ordered = [
      frame('a', 0, 0, { data: { slideOrder: 0 } }),
      frame('b', 0, 500, { data: { slideOrder: 1 } }),
    ];
    expect(reorderSlides(ordered, ['a', 'b'])).toEqual([]);
  });

  it('skips ids that name no frame, and repeats, and stays contiguous', () => {
    expect(reorderSlides([...board, shape('s', 0, 0)], ['s', 'b', 'gone', 'b', 'a'])).toEqual([
      { id: 'b', data: { slideOrder: 0 } },
      { id: 'a', data: { slideOrder: 1 } },
    ]);
  });
});

describe('moveSlide', () => {
  it('swaps an entry with its neighbour', () => {
    expect(moveSlide(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveSlide(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });

  it('does nothing at either end, or off the list', () => {
    expect(moveSlide(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveSlide(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(moveSlide(['a', 'b'], 7, 1)).toEqual(['a', 'b']);
  });
});

describe('slideScreenRect', () => {
  it('applies the viewport transform the board itself is drawn with', () => {
    expect(slideScreenRect({ x: 100, y: 50, w: 400, h: 300 }, { x: 20, y: 10, zoom: 2 })).toEqual({
      left: 220,
      top: 110,
      width: 800,
      height: 600,
    });
  });
});

describe('maskRects', () => {
  const container = { width: 1000, height: 800 };

  it('covers everything outside the slide and nothing inside it', () => {
    const [top, bottom, left, right] = maskRects(
      { left: 200, top: 100, width: 400, height: 300 },
      container,
    );
    expect(top).toEqual({ left: 0, top: 0, width: 1000, height: 100 });
    expect(bottom).toEqual({ left: 0, top: 400, width: 1000, height: 400 });
    expect(left).toEqual({ left: 0, top: 100, width: 200, height: 300 });
    expect(right).toEqual({ left: 600, top: 100, width: 400, height: 300 });
  });

  it('paints no negative box for a slide hanging off the edge', () => {
    const bands = maskRects({ left: -300, top: -200, width: 400, height: 300 }, container);
    for (const band of bands) {
      expect(band.width, JSON.stringify(band)).toBeGreaterThanOrEqual(0);
      expect(band.height, JSON.stringify(band)).toBeGreaterThanOrEqual(0);
    }
    // What is left of the slide still shows: the top band stops at 0 and the
    // bottom one starts where the slide ends.
    expect(bands[0].height).toBe(0);
    expect(bands[1].top).toBe(100);
    expect(bands[2].width).toBe(0);
    expect(bands[3].left).toBe(100);
  });

  it('covers the whole container for a slide entirely off screen', () => {
    const bands = maskRects({ left: 4000, top: 4000, width: 400, height: 300 }, container);
    expect(bands[0]).toEqual({ left: 0, top: 0, width: 1000, height: 800 });
  });
});
