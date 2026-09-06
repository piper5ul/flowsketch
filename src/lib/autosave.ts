/**
 * A debounced save that can be flushed, and that retries a failed save.
 *
 * The canvas autosaves on every store change, so writes are debounced to avoid
 * a request per keystroke. The debounce alone loses work: navigating away or
 * closing the tab within the debounce window drops the pending save. `flush()`
 * runs it immediately instead, so unmount and `pagehide` handlers can persist
 * whatever is still in flight.
 *
 * A save that fails used to sit there until the next edit, so a diagram edited
 * across a brief network blip stayed unsaved for as long as the user stopped
 * typing. A failed save is now retried on its own with an exponential backoff,
 * and the autosaver keeps reporting the edit as pending until one succeeds.
 */

/** The first retry waits this long; each further failure doubles it. */
const FIRST_RETRY_MS = 1000;
/** ...up to this, so a long outage settles into one attempt every 30 s. */
const MAX_RETRY_MS = 30_000;

/**
 * - `idle` — everything the store holds has been saved.
 * - `pending` — a change is waiting out the debounce window.
 * - `saving` — the first attempt of a save is in flight.
 * - `retrying` — a save failed: an attempt is either waiting out its backoff
 *   or already in flight again. The state does not flap back to `saving`
 *   between attempts, so the UI can show one steady "retrying" message.
 * - `error` — `maxAttempts` attempts all failed. The change is still unsaved;
 *   only a new `schedule()` or a `flush()` tries again.
 */
export type AutosaveState = 'idle' | 'pending' | 'saving' | 'retrying' | 'error';

export interface AutosaverOptions {
  save: () => Promise<void>;
  /** Debounce window for a normal (non-retry) save. */
  delayMs: number;
  /**
   * Attempts per failure streak before giving up. Unlimited by default: while
   * the page is open the edit is worth another try, and the backoff cap keeps
   * an offline tab down to one request every 30 s.
   */
  maxAttempts?: number;
  onStateChange?: (state: AutosaveState) => void;
}

export interface Autosaver {
  /** (Re)start the debounce window. Repeated calls coalesce into one save. */
  schedule: () => void;
  /** Run a pending save now and wait for it. A no-op when nothing is pending. */
  flush: () => Promise<void>;
  /** Drop a pending save (or a pending retry) without running it. */
  cancel: () => void;
  /** True while a change is unsaved: scheduled, awaiting a retry, or given up on. */
  isPending: () => boolean;
  /** The current state, also delivered to `onStateChange` on every transition. */
  getState: () => AutosaveState;
}

export function createAutosaver({
  save,
  delayMs,
  maxAttempts = Infinity,
  onStateChange,
}: AutosaverOptions): Autosaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let state: AutosaveState = 'idle';
  /** Consecutive failed attempts since the last successful save. */
  let failures = 0;

  function setState(next: AutosaveState) {
    if (next === state) return;
    state = next;
    onStateChange?.(next);
  }

  function clear() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** 1 s, 2 s, 4 s … capped at 30 s, by number of failures so far. */
  function backoffMs() {
    return Math.min(FIRST_RETRY_MS * 2 ** (failures - 1), MAX_RETRY_MS);
  }

  function wait(ms: number) {
    clear();
    timer = setTimeout(() => {
      timer = null;
      void attempt();
    }, ms);
  }

  /**
   * Runs `save` once. A rejection never escapes — it is turned into a scheduled
   * retry — so a failed flush can never break unmount or unload.
   */
  async function attempt(): Promise<void> {
    clear();
    setState(failures === 0 ? 'saving' : 'retrying');
    try {
      await save();
      failures = 0;
      setState('idle');
    } catch {
      failures += 1;
      if (failures >= maxAttempts) {
        setState('error');
        return;
      }
      setState('retrying');
      wait(backoffMs());
    }
  }

  return {
    schedule() {
      // A fresh change earns a fresh budget after the retries were given up on.
      if (state === 'error') failures = 0;
      // Mid-streak the state stays `retrying` rather than dropping back to
      // `pending`, so typing through an outage does not blink the indicator.
      setState(failures === 0 ? 'pending' : 'retrying');
      // Replaces a backoff timer too: a new change should be tried soon, not
      // after the rest of a 30 s wait. The failure count survives, so if this
      // attempt fails as well the backoff carries on growing.
      wait(delayMs);
    },

    flush() {
      if (timer === null && state !== 'retrying' && state !== 'error') return Promise.resolve();
      return attempt();
    },

    cancel() {
      clear();
      failures = 0;
      setState('idle');
    },

    isPending: () => timer !== null || state === 'retrying' || state === 'error',

    getState: () => state,
  };
}
