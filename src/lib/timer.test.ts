import { describe, expect, it } from 'vitest';
import { formatRemaining, remainingSeconds, sanitizeTimer, timerState } from './timer';

const NOW = Date.parse('2026-09-07T12:00:00.000Z');
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('remainingSeconds', () => {
  it('counts down from an end time, whatever clock is asking', () => {
    expect(remainingSeconds(iso(125_000), NOW)).toBe(125);
    expect(remainingSeconds(iso(125_000), NOW + 60_000)).toBe(65);
  });

  it('rounds up, so the number never reads zero before the timer is out', () => {
    // 200 ms left is still a second on the clock: zero is what the UI treats as
    // the end, and it must not arrive early.
    expect(remainingSeconds(iso(200), NOW)).toBe(1);
    expect(remainingSeconds(iso(0), NOW)).toBe(0);
  });

  it('is zero for a timer that has run out, however long ago', () => {
    expect(remainingSeconds(iso(-1), NOW)).toBe(0);
    expect(remainingSeconds(iso(-9_000_000), NOW)).toBe(0);
  });

  it('is zero for something that is not a date — the column is free-form JSON', () => {
    expect(remainingSeconds('soon', NOW)).toBe(0);
  });
});

describe('formatRemaining', () => {
  it('reads as a clock', () => {
    expect(formatRemaining(125)).toBe('2:05');
    expect(formatRemaining(9)).toBe('0:09');
    expect(formatRemaining(60)).toBe('1:00');
    expect(formatRemaining(0)).toBe('0:00');
  });

  it('does not wrap minutes into hours', () => {
    // Unambiguous, and needs no third field for the one case in a hundred that
    // runs past an hour.
    expect(formatRemaining(90 * 60)).toBe('90:00');
  });

  it('never shows a negative clock', () => {
    expect(formatRemaining(-5)).toBe('0:00');
  });
});

describe('timerState', () => {
  it('tells a running timer from one that has finished and one that is not there', () => {
    expect(timerState(null, NOW)).toBe('none');
    expect(timerState({ endsAt: iso(30_000), startedById: 'ada' }, NOW)).toBe('running');
    // 'done' is a state of its own: the timer is still on the board — that is
    // what makes the flash and "Time's up" possible — until somebody stops it.
    expect(timerState({ endsAt: iso(-1), startedById: 'ada' }, NOW)).toBe('done');
  });

  it('reads an unparseable end time as no timer rather than a finished one', () => {
    expect(timerState({ endsAt: 'later', startedById: 'ada' }, NOW)).toBe('none');
  });
});

describe('sanitizeTimer', () => {
  it('accepts an end time with somebody behind it', () => {
    const timer = { endsAt: iso(60_000), startedById: 'ada' };
    expect(sanitizeTimer(timer)).toEqual(timer);
  });

  it('keeps a label when there is one and drops one that is not text', () => {
    expect(sanitizeTimer({ endsAt: iso(60_000), startedById: 'ada', label: 'Silent writing' })).toEqual({
      endsAt: iso(60_000),
      startedById: 'ada',
      label: 'Silent writing',
    });
    expect(sanitizeTimer({ endsAt: iso(60_000), startedById: 'ada', label: 7 })).toEqual({
      endsAt: iso(60_000),
      startedById: 'ada',
    });
  });

  it('is null for anything a countdown could not be drawn from', () => {
    expect(sanitizeTimer(null)).toBeNull();
    expect(sanitizeTimer({ endsAt: 'never', startedById: 'ada' })).toBeNull();
    expect(sanitizeTimer({ endsAt: iso(60_000) })).toBeNull();
    expect(sanitizeTimer({ endsAt: iso(60_000), startedById: '' })).toBeNull();
    expect(sanitizeTimer([{ endsAt: iso(60_000), startedById: 'ada' }])).toBeNull();
  });

  it('keeps a timer that has already run out, because stopping it is a decision', () => {
    // Nothing here reads the clock: an expired timer is still the board's, and
    // 'Time's up' is what a reader who was away has to be able to see.
    expect(sanitizeTimer({ endsAt: iso(-60_000), startedById: 'ada' })).not.toBeNull();
  });
});
