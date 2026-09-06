import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosaver } from './autosave';

describe('createAutosaver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces repeated schedule() calls into a single save', async () => {
    const save = vi.fn(async () => {});
    const autosaver = createAutosaver({ save, delayMs: 2000 });

    autosaver.schedule();
    vi.advanceTimersByTime(500);
    autosaver.schedule();
    vi.advanceTimersByTime(500);
    autosaver.schedule();
    expect(save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('reports a pending save until the timer fires', () => {
    const save = vi.fn(async () => {});
    const autosaver = createAutosaver({ save, delayMs: 2000 });

    expect(autosaver.isPending()).toBe(false);
    autosaver.schedule();
    expect(autosaver.isPending()).toBe(true);

    vi.advanceTimersByTime(2000);
    expect(autosaver.isPending()).toBe(false);
  });

  it('flush() saves immediately and clears the pending timer', async () => {
    const save = vi.fn(async () => {});
    const autosaver = createAutosaver({ save, delayMs: 2000 });

    autosaver.schedule();
    await autosaver.flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(autosaver.isPending()).toBe(false);

    // The cleared timer must not fire a second save.
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush() awaits the save it starts', async () => {
    let resolveSave: () => void = () => {};
    const save = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    const autosaver = createAutosaver({ save, delayMs: 2000 });

    autosaver.schedule();
    let settled = false;
    const flushed = autosaver.flush().then(() => { settled = true; });

    await Promise.resolve();
    expect(settled).toBe(false);

    resolveSave();
    await flushed;
    expect(settled).toBe(true);
  });

  it('flush() with nothing pending does not call save', async () => {
    const save = vi.fn(async () => {});
    const autosaver = createAutosaver({ save, delayMs: 2000 });

    await autosaver.flush();
    expect(save).not.toHaveBeenCalled();

    // Still a no-op after a scheduled save has already run.
    autosaver.schedule();
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(1);
    await autosaver.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('cancel() drops the pending save', async () => {
    const save = vi.fn(async () => {});
    const autosaver = createAutosaver({ save, delayMs: 2000 });

    autosaver.schedule();
    autosaver.cancel();
    expect(autosaver.isPending()).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(save).not.toHaveBeenCalled();

    // A cancelled save is not resurrected by a later flush.
    await autosaver.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('swallows a rejected save so flush() callers are not left with an unhandled rejection', async () => {
    const save = vi.fn(async () => { throw new Error('network down'); });
    const autosaver = createAutosaver({ save, delayMs: 2000 });

    autosaver.schedule();
    await expect(autosaver.flush()).resolves.toBeUndefined();
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('createAutosaver retries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Advance fake timers and let the promise chain the timer starts settle. */
  async function advance(ms: number) {
    await vi.advanceTimersByTimeAsync(ms);
  }

  it('backs off exponentially and stops once a save succeeds', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const autosaver = createAutosaver({ save, delayMs: 2000 });

    autosaver.schedule();
    await advance(2000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosaver.getState()).toBe('retrying');
    // The edit is not saved, so it is still pending work.
    expect(autosaver.isPending()).toBe(true);

    // First retry: one second later, not sooner.
    await advance(999);
    expect(save).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(save).toHaveBeenCalledTimes(2);

    // Second retry: the wait doubles.
    await advance(1999);
    expect(save).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(save).toHaveBeenCalledTimes(3);

    // That one succeeded: nothing is pending and no further attempt is made.
    expect(autosaver.getState()).toBe('idle');
    expect(autosaver.isPending()).toBe(false);
    await advance(60_000);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('caps the backoff at 30 seconds', async () => {
    const save = vi.fn(async () => { throw new Error('offline'); });
    const autosaver = createAutosaver({ save, delayMs: 2000 });

    autosaver.schedule();
    await advance(2000);

    // 1s, 2s, 4s, 8s, 16s, then 30s rather than 32s, and 30s from then on.
    for (const wait of [1000, 2000, 4000, 8000, 16_000]) {
      const before = save.mock.calls.length;
      await advance(wait);
      expect(save).toHaveBeenCalledTimes(before + 1);
    }
    const before = save.mock.calls.length;
    await advance(29_999);
    expect(save).toHaveBeenCalledTimes(before);
    await advance(1);
    expect(save).toHaveBeenCalledTimes(before + 1);

    await advance(30_000);
    expect(save).toHaveBeenCalledTimes(before + 2);
  });

  it('gives up after maxAttempts and reports an error', async () => {
    const save = vi.fn(async () => { throw new Error('offline'); });
    const autosaver = createAutosaver({ save, delayMs: 2000, maxAttempts: 3 });

    autosaver.schedule();
    await advance(2000);
    await advance(1000);
    await advance(2000);
    expect(save).toHaveBeenCalledTimes(3);

    expect(autosaver.getState()).toBe('error');
    await advance(60_000);
    expect(save).toHaveBeenCalledTimes(3);
    // The edit is still unsaved, so it must not be reported as clean.
    expect(autosaver.isPending()).toBe(true);
  });

  it('gives a change made after giving up a fresh run of attempts', async () => {
    const save = vi.fn(async () => { throw new Error('offline'); });
    const autosaver = createAutosaver({ save, delayMs: 2000, maxAttempts: 2 });

    autosaver.schedule();
    await advance(2000);
    await advance(1000);
    expect(autosaver.getState()).toBe('error');

    autosaver.schedule();
    expect(autosaver.getState()).toBe('pending');
    await advance(2000);
    expect(save).toHaveBeenCalledTimes(3);
    // ...and the backoff starts over from one second rather than where it left off.
    await advance(1000);
    expect(save).toHaveBeenCalledTimes(4);
    expect(autosaver.getState()).toBe('error');
  });

  it('a fresh change during backoff saves after the normal delay', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const autosaver = createAutosaver({ save, delayMs: 2000 });

    autosaver.schedule();
    await advance(2000);
    expect(save).toHaveBeenCalledTimes(1);

    // Half a second into the 1 s backoff the user edits again.
    await advance(500);
    autosaver.schedule();

    // The backoff timer is replaced, so nothing fires at the 1 s mark.
    await advance(499);
    expect(save).toHaveBeenCalledTimes(1);
    // ...and the retry lands a full debounce window after the change.
    await advance(1501);
    expect(save).toHaveBeenCalledTimes(2);
    expect(autosaver.getState()).toBe('idle');
  });

  it('flush() during backoff retries immediately', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const autosaver = createAutosaver({ save, delayMs: 2000 });

    autosaver.schedule();
    await advance(2000);
    expect(save).toHaveBeenCalledTimes(1);

    await autosaver.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(autosaver.isPending()).toBe(false);

    // The cleared backoff timer must not fire a third save.
    await advance(60_000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('cancel() abandons a pending retry', async () => {
    const save = vi.fn(async () => { throw new Error('offline'); });
    const autosaver = createAutosaver({ save, delayMs: 2000 });

    autosaver.schedule();
    await advance(2000);
    autosaver.cancel();

    expect(autosaver.getState()).toBe('idle');
    expect(autosaver.isPending()).toBe(false);
    await advance(60_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('reports each state transition to onStateChange', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const states: string[] = [];
    const autosaver = createAutosaver({
      save,
      delayMs: 2000,
      onStateChange: (state) => states.push(state),
    });

    autosaver.schedule();
    await advance(2000);
    await advance(1000);

    expect(states).toEqual(['pending', 'saving', 'retrying', 'idle']);
  });
});
