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

function controlledIdleScheduler() {
  const callbacks: Array<{ callback: () => void; canceled: boolean }> = [];
  const request = vi.fn((callback: () => void) => {
    const entry = { callback, canceled: false };
    callbacks.push(entry);
    return entry;
  });
  const cancel = vi.fn((handle: unknown) => {
    (handle as { canceled: boolean }).canceled = true;
  });
  return { callbacks, request, cancel };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createThumbnailScheduler', () => {
  it('captures the first change on the next idle task', async () => {
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
    // Reaching the interval queues the idle capture on the next task.
    await vi.runOnlyPendingTimersAsync();
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

  it('defers while busy and rechecks before capturing from idle', async () => {
    const idleScheduler = controlledIdleScheduler();
    const isBusy = vi.fn(() => true);
    const render = vi.fn().mockResolvedValue(PNG);
    const save = vi.fn().mockResolvedValue(undefined);
    const scheduler = createThumbnailScheduler({
      render,
      save,
      minIntervalMs: INTERVAL,
      isBusy,
      idleScheduler,
    });

    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(100);
    expect(idleScheduler.request).not.toHaveBeenCalled();

    isBusy.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(idleScheduler.callbacks).toHaveLength(1);

    // Busy state can change after an idle callback was queued.
    isBusy.mockReturnValue(true);
    idleScheduler.callbacks[0].callback();
    expect(render).not.toHaveBeenCalled();

    isBusy.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(idleScheduler.callbacks).toHaveLength(2);
    idleScheduler.callbacks[1].callback();
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('pushes a pending idle capture back when input arrives', async () => {
    const idleScheduler = controlledIdleScheduler();
    const render = vi.fn().mockResolvedValue(PNG);
    const save = vi.fn().mockResolvedValue(undefined);
    const scheduler = createThumbnailScheduler({
      render,
      save,
      minIntervalMs: INTERVAL,
      idleScheduler,
    });

    scheduler.markDirty();
    expect(idleScheduler.callbacks).toHaveLength(1);

    scheduler.notifyInput();
    expect(idleScheduler.cancel).toHaveBeenCalledTimes(1);
    expect(idleScheduler.callbacks).toHaveLength(2);

    // Even a scheduler that delivers a canceled callback cannot capture it.
    idleScheduler.callbacks[0].callback();
    expect(render).not.toHaveBeenCalled();
    idleScheduler.callbacks[1].callback();
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('waits for keyboard quiet after input, including urgent dirty work', async () => {
    const idleScheduler = controlledIdleScheduler();
    const render = vi.fn().mockResolvedValue(PNG);
    const save = vi.fn().mockResolvedValue(undefined);
    const scheduler = createThumbnailScheduler({
      render,
      save,
      minIntervalMs: INTERVAL,
      keyboardQuietMs: 2_000,
      idleScheduler,
    });

    scheduler.markDirty();
    scheduler.notifyInput('keyboard');
    expect(idleScheduler.cancel).toHaveBeenCalledTimes(1);

    // Urgency bypasses cooldown, but not the keyboard quiet window.
    scheduler.markDirty({ urgent: true });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(idleScheduler.callbacks).toHaveLength(1);
    expect(render).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(idleScheduler.callbacks).toHaveLength(2);
    idleScheduler.callbacks[1].callback();
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);

    // Keyboard activity is remembered even when no capture is dirty yet.
    scheduler.notifyInput('keyboard');
    await vi.advanceTimersByTimeAsync(500);
    scheduler.markDirty({ urgent: true });
    await vi.advanceTimersByTimeAsync(1_499);
    expect(idleScheduler.callbacks).toHaveLength(2);
    expect(render).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(idleScheduler.callbacks).toHaveLength(3);
    idleScheduler.callbacks[2].callback();
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('waits for wheel quiet and resets the 400 ms window on each event', async () => {
    const idleScheduler = controlledIdleScheduler();
    const render = vi.fn().mockResolvedValue(PNG);
    const save = vi.fn().mockResolvedValue(undefined);
    const scheduler = createThumbnailScheduler({
      render,
      save,
      minIntervalMs: INTERVAL,
      idleScheduler,
    });

    scheduler.markDirty();
    scheduler.notifyInput('wheel');
    await vi.advanceTimersByTimeAsync(250);
    scheduler.notifyInput('wheel');

    await vi.advanceTimersByTimeAsync(399);
    expect(idleScheduler.request).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(idleScheduler.request).toHaveBeenCalledTimes(2);
    expect(render).not.toHaveBeenCalled();
    idleScheduler.callbacks[1].callback();
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('keeps the rate limit when idle scheduling is injected', async () => {
    const idleScheduler = controlledIdleScheduler();
    const render = vi.fn().mockResolvedValue(PNG);
    const save = vi.fn().mockResolvedValue(undefined);
    const scheduler = createThumbnailScheduler({
      render,
      save,
      minIntervalMs: INTERVAL,
      idleScheduler,
    });

    scheduler.markDirty();
    idleScheduler.callbacks[0].callback();
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);

    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(idleScheduler.callbacks).toHaveLength(1);
    expect(render).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(idleScheduler.callbacks).toHaveLength(2);
    expect(render).toHaveBeenCalledTimes(1);
    idleScheduler.callbacks[1].callback();
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('lets urgent dirtiness bypass the interval without skipping idle', async () => {
    const idleScheduler = controlledIdleScheduler();
    const render = vi.fn().mockResolvedValue(PNG);
    const save = vi.fn().mockResolvedValue(undefined);
    const scheduler = createThumbnailScheduler({
      render,
      save,
      minIntervalMs: INTERVAL,
      idleScheduler,
    });

    scheduler.markDirty();
    idleScheduler.callbacks[0].callback();
    await Promise.resolve();
    scheduler.markDirty();
    scheduler.markDirty({ urgent: true });

    expect(idleScheduler.callbacks).toHaveLength(2);
    expect(render).toHaveBeenCalledTimes(1);
    idleScheduler.callbacks[1].callback();
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('flushes immediately and invalidates the pending idle callback', async () => {
    const idleScheduler = controlledIdleScheduler();
    const render = vi.fn().mockResolvedValue(PNG);
    const save = vi.fn().mockResolvedValue(undefined);
    const scheduler = createThumbnailScheduler({
      render,
      save,
      minIntervalMs: INTERVAL,
      idleScheduler,
    });

    scheduler.markDirty();
    expect(idleScheduler.callbacks).toHaveLength(1);

    await scheduler.flush();
    expect(render).toHaveBeenCalledTimes(1);
    expect(idleScheduler.cancel).toHaveBeenCalledTimes(1);
    expect(idleScheduler.callbacks).toHaveLength(1);

    // Delivering the canceled callback later cannot duplicate the capture.
    idleScheduler.callbacks[0].callback();
    await Promise.resolve();
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
