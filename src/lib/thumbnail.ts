/**
 * Dashboard thumbnails.
 *
 * Rendering one means rasterising the whole canvas, which is far too expensive
 * to do on every edit — so captures are rate-limited rather than debounced: the
 * first change is captured straight away and further changes at most once per
 * interval, while a diagram nobody is editing costs nothing at all.
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

export interface ThumbnailScheduler {
  /** Note that the diagram changed. Cheap; call it on every store update. */
  markDirty: () => void;
  /** Capture now if anything is pending, ignoring the interval. */
  flush: () => Promise<void>;
}

export interface ThumbnailSchedulerOptions {
  /** Renders the current diagram, or null when there is nothing to show. */
  render: () => Promise<string | null>;
  /** Persists a rendered thumbnail. */
  save: (thumbnail: string) => Promise<unknown>;
  /** Minimum gap between two captures. */
  minIntervalMs?: number;
}

export function createThumbnailScheduler({
  render,
  save,
  minIntervalMs = THUMBNAIL_MIN_INTERVAL_MS,
}: ThumbnailSchedulerOptions): ThumbnailScheduler {
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastCaptureAt = Number.NEGATIVE_INFINITY;

  async function capture(): Promise<void> {
    if (!dirty) return;
    // Cleared before the render, not after: an edit made while the capture is
    // in flight has to schedule the next one rather than be swallowed by it.
    dirty = false;
    lastCaptureAt = Date.now();
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

  return {
    markDirty() {
      dirty = true;
      // A capture already queued will pick this change up; rescheduling would
      // let a stream of edits postpone it forever.
      if (timer !== null) return;
      // Zero-delay rather than a direct call: `markDirty` runs inside a store
      // subscription, and the capture writes to that same store when it clears
      // the selection.
      const waitMs = Math.max(0, lastCaptureAt + minIntervalMs - Date.now());
      timer = setTimeout(() => {
        timer = null;
        void capture();
      }, waitMs);
    },

    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      return capture();
    },
  };
}
