import { create } from 'zustand';
import { nanoid } from 'nanoid';

export type ToastKind = 'error' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

/** How long a toast stays up when the caller does not say otherwise. */
const DEFAULT_TTL_MS = 5000;

interface ToastState {
  toasts: Toast[];
  /** Shows a toast and returns its id. A `ttlMs` of 0 or less never expires. */
  push: (kind: ToastKind, message: string, options?: { ttlMs?: number }) => string;
  dismiss: (id: string) => void;
  /** Drops every toast — used when a view unmounts and by the tests. */
  clear: () => void;
}

// Expiry timers stay out of the store: they are not state the UI renders, and
// keeping them module-level means a re-render never has to diff a timer handle.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelTimer(id: string) {
  const timer = timers.get(id);
  if (timer === undefined) return;
  clearTimeout(timer);
  timers.delete(id);
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  push: (kind, message, options) => {
    const id = nanoid(8);
    const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));

    if (ttlMs > 0) {
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
        }, ttlMs),
      );
    }
    return id;
  },

  dismiss: (id) => {
    cancelTimer(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  clear: () => {
    for (const id of [...timers.keys()]) cancelTimer(id);
    set({ toasts: [] });
  },
}));

/** Shorthand for the common case: a failure the user needs to know about. */
export function toastError(message: string) {
  useToastStore.getState().push('error', message);
}
