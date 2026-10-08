/**
 * Dashboard thumbnails.
 *
 * Rendering one means rasterising the whole canvas, which is far too expensive
 * to do on every edit. Captures are rate-limited and happen only during an idle
 * turn, while a diagram nobody is editing costs nothing at all.
 *
 * The leading capture matters because the only reliable moment to read the
 * canvas is while it is on screen. `flush()` on unmount is best-effort: by the
 * time an async render resumes, the viewport it was going to read has usually
 * been torn down already, and `render` reports that as "nothing to capture".
 *
 * Every failure here is swallowed. A thumbnail is decoration; it must never
 * break an edit, a navigation or a page teardown.
 */
import { MAX_THUMBNAIL_CHARS } from '../../shared/types';

/** Minimum gap between two captures of the same diagram. */
export const THUMBNAIL_MIN_INTERVAL_MS = 30_000;

/** Longest side of the rendered image, in CSS pixels. */
export const THUMBNAIL_MAX_SIDE = 480;

/** Delay before checking again when the app is still handling input. */
const BUSY_RECHECK_MS = 100;

/** Quiet period after keyboard input before another canvas render. */
const KEYBOARD_QUIET_MS = 2_000;

export type ThumbnailInputKind = 'keyboard' | 'other';

export interface ThumbnailIdleScheduler {
  /** Queue work for an idle turn. */
  request: (callback: () => void) => unknown;
  /** Cancel queued work when the scheduler supports cancellation. */
  cancel?: (handle: unknown) => void;
}

type DefaultIdleHandle =
  | { kind: 'idle'; id: unknown }
  | { kind: 'timeout'; id: ReturnType<typeof setTimeout> };

const defaultIdleScheduler: ThumbnailIdleScheduler = {
  request(callback) {
    const browser = globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void) => unknown;
    };
    if (typeof browser.requestIdleCallback === 'function') {
      return { kind: 'idle', id: browser.requestIdleCallback(callback) } satisfies DefaultIdleHandle;
    }
    return { kind: 'timeout', id: setTimeout(callback, 0) } satisfies DefaultIdleHandle;
  },
  cancel(handle) {
    const browser = globalThis as typeof globalThis & {
      cancelIdleCallback?: (id: unknown) => void;
    };
    const idleHandle = handle as DefaultIdleHandle;
    if (idleHandle.kind === 'idle') browser.cancelIdleCallback?.(idleHandle.id);
    else clearTimeout(idleHandle.id);
  },
};

export interface ThumbnailScheduler {
  /** Note that the diagram changed. Cheap; call it on every store update. */
  markDirty: (options?: { urgent?: boolean }) => void;
  /** Report input so a queued idle capture can be postponed. */
  notifyInput: (kind?: ThumbnailInputKind) => void;
  /** Capture now if anything is pending, ignoring idle and interval waits. */
  flush: () => Promise<void>;
}

export interface ThumbnailSchedulerOptions {
  /** Renders the current diagram, or null when there is nothing to show. */
  render: () => Promise<string | null>;
  /** Persists a rendered thumbnail. */
  save: (thumbnail: string) => Promise<unknown>;
  /** Minimum gap between two captures. */
  minIntervalMs?: number;
  /** Clock used for interval checks. */
  now?: () => number;
  /** Whether the app is currently handling user input. */
  isBusy?: () => boolean;
  /** Delay after the most recent keyboard input before rendering. */
  keyboardQuietMs?: number;
  /** Injectable idle queue, useful for deterministic scheduling and tests. */
  idleScheduler?: ThumbnailIdleScheduler;
}

export function createThumbnailScheduler({
  render,
  save,
  minIntervalMs = THUMBNAIL_MIN_INTERVAL_MS,
  now = () => Date.now(),
  isBusy = () => false,
  keyboardQuietMs = KEYBOARD_QUIET_MS,
  idleScheduler = defaultIdleScheduler,
}: ThumbnailSchedulerOptions): ThumbnailScheduler {
  let dirty = false;
  let urgent = false;
  let idleHandle: unknown = null;
  let idlePending = false;
  let idleGeneration = 0;
  let busyTimer: ReturnType<typeof setTimeout> | null = null;
  let keyboardTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCaptureAt = Number.NEGATIVE_INFINITY;
  let lastKeyboardInputAt = Number.NEGATIVE_INFINITY;

  function cancelIdle(): void {
    idleGeneration += 1;
    if (!idlePending) return;
    try {
      idleScheduler.cancel?.(idleHandle);
    } catch {
      // A cancellation failure must not affect the edit that reported input.
    }
    idleHandle = null;
    idlePending = false;
  }

  function cancelTimers(): void {
    if (busyTimer !== null) {
      clearTimeout(busyTimer);
      busyTimer = null;
    }
    if (keyboardTimer !== null) {
      clearTimeout(keyboardTimer);
      keyboardTimer = null;
    }
    if (intervalTimer !== null) {
      clearTimeout(intervalTimer);
      intervalTimer = null;
    }
  }

  async function capture(): Promise<void> {
    if (!dirty) return;
    // Clear before the render so an edit made while it is in flight schedules
    // the next capture instead of being swallowed by it.
    dirty = false;
    urgent = false;
    lastCaptureAt = now();
    try {
      const thumbnail = await render();
      // An empty diagram has no thumbnail worth storing, and one the server
      // would refuse is not worth the upload.
      if (thumbnail === null || thumbnail.length > MAX_THUMBNAIL_CHARS) return;
      await save(thumbnail);
    } catch {
      // Left for the next capture to retry.
    }
  }

  function schedule(): void {
    if (!dirty || idlePending || busyTimer !== null || keyboardTimer !== null || intervalTimer !== null) return;

    if (isBusy()) {
      busyTimer = setTimeout(() => {
        busyTimer = null;
        schedule();
      }, BUSY_RECHECK_MS);
      return;
    }

    const keyboardWaitMs = Math.max(0, lastKeyboardInputAt + keyboardQuietMs - now());
    if (keyboardWaitMs > 0) {
      keyboardTimer = setTimeout(() => {
        keyboardTimer = null;
        schedule();
      }, keyboardWaitMs);
      return;
    }

    if (!urgent) {
      const waitMs = Math.max(0, lastCaptureAt + minIntervalMs - now());
      if (waitMs > 0) {
        intervalTimer = setTimeout(() => {
          intervalTimer = null;
          schedule();
        }, waitMs);
        return;
      }
    }

    idlePending = true;
    const generation = ++idleGeneration;
    const handle = idleScheduler.request(() => {
      if (generation !== idleGeneration) return;
      idlePending = false;
      idleHandle = null;
      if (!dirty) return;

      // Activity can start after the idle callback was queued.
      if (isBusy()) {
        schedule();
        return;
      }
      if (lastKeyboardInputAt + keyboardQuietMs > now()) {
        schedule();
        return;
      }
      // An idle callback may have been queued before the interval elapsed.
      if (!urgent && lastCaptureAt + minIntervalMs > now()) {
        schedule();
        return;
      }
      void capture();
    });
    // Also tolerate an injected scheduler that invokes callbacks synchronously.
    if (idlePending && generation === idleGeneration) idleHandle = handle;
  }

  return {
    markDirty(options) {
      dirty = true;
      if (options?.urgent) {
        urgent = true;
        if (intervalTimer !== null) {
          clearTimeout(intervalTimer);
          intervalTimer = null;
        }
      }
      schedule();
    },

    notifyInput(kind = 'other') {
      if (kind === 'keyboard') {
        lastKeyboardInputAt = now();
        if (keyboardTimer !== null) {
          clearTimeout(keyboardTimer);
          keyboardTimer = null;
        }
      }
      if (!dirty) return;
      cancelIdle();
      if (busyTimer !== null) {
        clearTimeout(busyTimer);
        busyTimer = null;
      }
      schedule();
    },

    flush() {
      cancelIdle();
      cancelTimers();
      return capture();
    },
  };
}
