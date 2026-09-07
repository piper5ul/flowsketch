import { describe, expect, it } from 'vitest';
import { SHARED_POLL_MS, liveBoardPatch, liveBoardStateOf } from './sharedPoll';

const timer = { endsAt: '2030-01-01T00:00:00.000Z', startedById: 'ada' };
const round = { active: true, revealed: false, dotsPerPerson: 3, startedById: 'ada' };

describe('SHARED_POLL_MS', () => {
  it('stays inside the shared route’s rate limit with room to spare', () => {
    // 300 requests / 15 minutes (`server/rateLimit.ts`), so one viewer costs 30.
    const perWindow = (15 * 60 * 1000) / SHARED_POLL_MS;
    expect(perWindow).toBeLessThanOrEqual(30);
  });
});

describe('liveBoardStateOf', () => {
  it('reads the two live fields off a stored diagram', () => {
    expect(liveBoardStateOf({ version: 3, nodes: [], edges: [], timer, voting: round })).toEqual({
      timer,
      voting: round,
    });
  });

  it('answers null for a board with neither, and for anything that is not one', () => {
    expect(liveBoardStateOf({ version: 3, nodes: [], edges: [] })).toEqual({
      timer: null,
      voting: null,
    });
    expect(liveBoardStateOf(null)).toEqual({ timer: null, voting: null });
    expect(liveBoardStateOf('nonsense')).toEqual({ timer: null, voting: null });
  });

  it('narrows through the same gates every other reader uses', () => {
    // A half-written end time would leave the page drawing a countdown that
    // never moves; `sanitizeTimer` is what refuses it.
    expect(liveBoardStateOf({ timer: { endsAt: 'soon', startedById: 'ada' } }).timer).toBeNull();
    expect(liveBoardStateOf({ voting: { active: 'yes' } }).voting).toBeNull();
  });
});

describe('liveBoardPatch', () => {
  const none = { voting: null, timer: null };

  it('is null when nothing moved, whatever the objects’ identity', () => {
    expect(liveBoardPatch(none, { voting: null, timer: null })).toBeNull();
    // Different parses of the same JSON: never the same reference, always the
    // same board.
    expect(
      liveBoardPatch({ voting: round, timer }, { voting: { ...round }, timer: { ...timer } }),
    ).toBeNull();
  });

  it('reports a timer that has started, and one that has been stopped', () => {
    expect(liveBoardPatch(none, { voting: null, timer })).toEqual({ timer });
    expect(liveBoardPatch({ voting: null, timer }, none)).toEqual({ timer: null });
  });

  it('reports a round opening and its totals being revealed', () => {
    expect(liveBoardPatch(none, { voting: round, timer: null })).toEqual({ voting: round });
    const revealed = { ...round, active: false, revealed: true };
    expect(liveBoardPatch({ voting: round, timer: null }, { voting: revealed, timer: null })).toEqual(
      { voting: revealed },
    );
  });

  it('carries only the field that moved, so the other is not re-rendered', () => {
    const patch = liveBoardPatch({ voting: round, timer: null }, { voting: round, timer });
    expect(patch).toEqual({ timer });
    expect(patch && 'voting' in patch).toBe(false);
  });

  it('notices a timer restarted at a different instant', () => {
    const later = { ...timer, endsAt: '2030-01-01T00:05:00.000Z' };
    expect(liveBoardPatch({ voting: null, timer }, { voting: null, timer: later })).toEqual({
      timer: later,
    });
  });
});
