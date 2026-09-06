import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThumbnailScheduler } from './thumbnail';
import { MAX_THUMBNAIL_CHARS, THUMBNAIL_DATA_URL_PREFIX } from '../../shared/types';

const PNG = `${THUMBNAIL_DATA_URL_PREFIX}iVBORw0KGgo=`;
const INTERVAL = 30_000;

function setup(render = vi.fn().mockResolvedValue(PNG)) {
  const save = vi.fn().mockResolvedValue(undefined);
  const scheduler = createThumbnailScheduler({ render, save, minIntervalMs: INTERVAL });
  return { scheduler, render, save };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createThumbnailScheduler', () => {
  it('captures the first change right away', async () => {
    const { scheduler, render, save } = setup();

    scheduler.markDirty();
    // Off the caller's stack — `markDirty` runs inside a store subscription.
    expect(render).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);
    expect(render).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(PNG);
  });

  it('renders once per interval however often the diagram changes', async () => {
    const { scheduler, render } = setup();

    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(0);
    expect(render).toHaveBeenCalledTimes(1);

    // A burst of edits inside the interval earns exactly one more capture,
    // and not before the interval is up.
    scheduler.markDirty();
    scheduler.markDirty();
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(render).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('never renders a diagram that has not changed', async () => {
    const { scheduler, render } = setup();

    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(render).not.toHaveBeenCalled();

    await scheduler.flush();
    expect(render).not.toHaveBeenCalled();
  });

  it('stops rendering once the edits stop', async () => {
    const { scheduler, render } = setup();

    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending capture immediately instead of waiting out the interval', async () => {
    const { scheduler, render, save } = setup();

    // Spend the leading capture, so the next one is inside the cooldown.
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.markDirty();

    await scheduler.flush();
    expect(render).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);

    // The flush consumed the pending capture; the timer must not fire again.
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('skips the save when there is nothing worth capturing', async () => {
    const { scheduler, render, save } = setup(vi.fn().mockResolvedValue(null));

    scheduler.markDirty();
    await scheduler.flush();
    expect(render).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('skips a thumbnail the server would refuse as oversized', async () => {
    const huge = THUMBNAIL_DATA_URL_PREFIX + 'A'.repeat(MAX_THUMBNAIL_CHARS);
    const { scheduler, save } = setup(vi.fn().mockResolvedValue(huge));

    scheduler.markDirty();
    await scheduler.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('swallows a failed render — a thumbnail is never worth breaking a page teardown', async () => {
    const { scheduler, save } = setup(vi.fn().mockRejectedValue(new Error('canvas is tainted')));

    scheduler.markDirty();
    await expect(scheduler.flush()).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it('swallows a failed save', async () => {
    const { scheduler, save } = setup();
    save.mockRejectedValue(new Error('API error: 500'));

    scheduler.markDirty();
    await expect(scheduler.flush()).resolves.toBeUndefined();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
