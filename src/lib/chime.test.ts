import { describe, expect, it, vi } from 'vitest';
import { CHIME_DURATION_S, canPlayChime, chimeNotes, playChime } from './chime';

describe('chimeNotes', () => {
  it('is two overlapping notes about a third of a second long', () => {
    const notes = chimeNotes();
    expect(notes).toHaveLength(2);
    // The second is higher — a rising fifth reads as "finished", not "alarm".
    expect(notes[1].frequency).toBeGreaterThan(notes[0].frequency);
    // ...and it starts before the first has died away, so it is one gesture.
    expect(notes[1].startsAt).toBeGreaterThan(0);
    expect(notes[1].startsAt).toBeLessThan(notes[0].startsAt + notes[0].duration);
    expect(CHIME_DURATION_S).toBeGreaterThan(0.25);
    expect(CHIME_DURATION_S).toBeLessThan(0.5);
  });

  it('stays quiet enough to interrupt a meeting without startling it', () => {
    for (const note of chimeNotes()) {
      expect(note.peak).toBeGreaterThan(0);
      expect(note.peak).toBeLessThan(0.3);
    }
  });
});

describe('canPlayChime', () => {
  it('is false only when the browser says the page has never been touched', () => {
    expect(canPlayChime({ userActivation: { hasBeenActive: false } } as Navigator)).toBe(false);
    expect(canPlayChime({ userActivation: { hasBeenActive: true } } as Navigator)).toBe(true);
    // No `userActivation` at all is not a refusal: a page with a timer on it
    // has almost certainly been clicked, and the audio call is guarded anyway.
    expect(canPlayChime({} as Navigator)).toBe(true);
    expect(canPlayChime(undefined)).toBe(true);
  });
});

/** The smallest thing `playChime` can be handed that behaves like a context. */
function fakeContext() {
  const started: number[] = [];
  const frequencies: number[] = [];
  const close = vi.fn(async () => {});
  const gainNode = () => ({
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(() => ({ connect: vi.fn() })),
  });
  const ctor = vi.fn(function AudioContextStub(this: unknown) {
    return {
      currentTime: 10,
      destination: {},
      createGain: gainNode,
      createOscillator: () => ({
        type: '',
        frequency: { set value(v: number) { frequencies.push(v); } },
        connect: vi.fn(() => ({ connect: vi.fn() })),
        start: (at: number) => started.push(at),
        stop: vi.fn(),
      }),
      close,
    };
  });
  return { ctor: ctor as unknown as new () => AudioContext, started, frequencies, close };
}

describe('playChime', () => {
  it('schedules every note from the context’s own clock', () => {
    const { ctor, started, frequencies } = fakeContext();
    playChime(ctor);
    expect(frequencies).toEqual(chimeNotes().map((n) => n.frequency));
    expect(started).toEqual(chimeNotes().map((n) => 10 + n.startsAt));
  });

  it('closes the context once the chime is over rather than holding one open', () => {
    vi.useFakeTimers();
    try {
      const { ctor, close } = fakeContext();
      playChime(ctor);
      expect(close).not.toHaveBeenCalled();
      vi.advanceTimersByTime((CHIME_DURATION_S + 0.2) * 1000);
      expect(close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says nothing when there is no audio to be had', () => {
    expect(() => playChime(undefined)).not.toThrow();
    const throwing = function Throwing() {
      throw new Error('not allowed');
    } as unknown as new () => AudioContext;
    expect(() => playChime(throwing)).not.toThrow();
  });
});
