/**
 * A debounced save that can be flushed.
 *
 * The canvas autosaves on every store change, so writes are debounced to avoid
 * a request per keystroke. The debounce alone loses work: navigating away or
 * closing the tab within the debounce window drops the pending save. `flush()`
 * runs it immediately instead, so unmount and `pagehide` handlers can persist
 * whatever is still in flight.
 */
export interface Autosaver {
  /** (Re)start the debounce window. Repeated calls coalesce into one save. */
  schedule: () => void;
  /** Run a pending save now and wait for it. A no-op when nothing is pending. */
  flush: () => Promise<void>;
  /** Drop a pending save without running it. */
  cancel: () => void;
  /** True while a save is scheduled but has not started yet. */
  isPending: () => boolean;
}

export function createAutosaver({ save, delayMs }: { save: () => Promise<void>; delayMs: number }): Autosaver {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clear() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** Runs `save` without letting a rejection escape as an unhandled promise. */
  async function run(): Promise<void> {
    try {
      await save();
    } catch {
      // Save failures surface through the store's saveStatus; the autosaver
      // itself stays quiet so a failed flush never breaks unmount or unload.
    }
  }

  return {
    schedule() {
      clear();
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delayMs);
    },

    flush() {
      if (timer === null) return Promise.resolve();
      clear();
      return run();
    },

    cancel: clear,

    isPending: () => timer !== null,
  };
}
