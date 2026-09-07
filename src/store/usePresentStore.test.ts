import { beforeEach, describe, expect, it } from 'vitest';
import { usePresentStore } from './usePresentStore';
import { useDiagramStore } from './useDiagramStore';

const present = () => usePresentStore.getState();

/** A board of `count` frames, one under the other, plus one ordinary shape. */
function seedFrames(count: number) {
  useDiagramStore.getState().loadDiagram('d1', 'Deck', false, {
    nodes: [
      { id: 's', type: 'shape', position: { x: 0, y: 0 }, width: 100, height: 50, data: { label: 'not a slide' } },
      ...Array.from({ length: count }, (_, i) => ({
        id: `f${i}`,
        type: 'frame' as const,
        position: { x: 0, y: i * 1000 },
        width: 400,
        height: 300,
        data: { label: `Slide ${i}` },
      })),
    ],
    edges: [],
  });
}

beforeEach(() => {
  seedFrames(3);
  usePresentStore.setState({ active: false, index: 0 });
});

describe('usePresentStore', () => {
  it('starts inactive on the first slide', () => {
    expect(present().active).toBe(false);
    expect(present().index).toBe(0);
  });

  it('starts at the first slide by default, and at the one it is given', () => {
    present().start();
    expect(present().active).toBe(true);
    expect(present().index).toBe(0);

    present().stop();
    present().start(2);
    expect(present().index).toBe(2);
  });

  it('clamps a start index to the deck', () => {
    present().start(99);
    expect(present().index).toBe(2);
    present().stop();
    present().start(-4);
    expect(present().index).toBe(0);
  });

  it('refuses to start on a board with no frames', () => {
    seedFrames(0);
    present().start();
    expect(present().active).toBe(false);
  });

  it('steps through the deck', () => {
    present().start();
    present().next();
    expect(present().index).toBe(1);
    present().next();
    expect(present().index).toBe(2);
    present().prev();
    expect(present().index).toBe(1);
  });

  it('clamps at both ends rather than wrapping', () => {
    // A deck is not a loop: walking off the end and landing back on slide 1 is
    // a way of losing your place mid-talk.
    present().start(2);
    present().next();
    expect(present().index).toBe(2);
    present().goTo(0);
    present().prev();
    expect(present().index).toBe(0);
  });

  it('clamps goTo to the deck', () => {
    present().start();
    present().goTo(7);
    expect(present().index).toBe(2);
    present().goTo(-1);
    expect(present().index).toBe(0);
  });

  it('steps against the deck as it is now, not as it was at the start', () => {
    present().start(2);
    // Two frames deleted under the presentation: the index has to come back
    // inside the deck rather than point past the end of it.
    seedFrames(1);
    present().next();
    expect(present().index).toBe(0);
  });

  it('does nothing at all while it is not running', () => {
    present().next();
    present().goTo(2);
    expect(present().index).toBe(0);
    expect(present().active).toBe(false);
  });

  it('goes back to the first slide when it stops', () => {
    present().start(2);
    present().stop();
    expect(present().active).toBe(false);
    expect(present().index).toBe(0);
  });
});
