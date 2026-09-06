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
