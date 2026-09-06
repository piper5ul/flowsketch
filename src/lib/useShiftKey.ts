import { useSyncExternalStore } from 'react';

/**
 * Whether ⇧ is currently held, shared by every subscriber.
 *
 * A diagram can hold hundreds of nodes and each one wants to know, so the
 * window listeners are attached once for the whole app rather than once per
 * component. `useSyncExternalStore` gives each subscriber a re-render when the
 * flag flips and nothing at all when it does not.
 */
let shiftHeld = false;
const listeners = new Set<() => void>();

function setShiftHeld(next: boolean) {
  if (next === shiftHeld) return;
  shiftHeld = next;
  for (const listener of listeners) listener();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Shift') setShiftHeld(true);
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === 'Shift') setShiftHeld(false);
}

// Switching windows or tabs with the key down never delivers the keyup, which
// would otherwise leave the modifier stuck on forever.
function onWindowBlur() {
  setShiftHeld(false);
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
  }
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onWindowBlur);
    shiftHeld = false;
  };
}

const getSnapshot = () => shiftHeld;
/** No keyboard on the server, and the export path renders to a static DOM. */
const getServerSnapshot = () => false;

export function useShiftKey(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
