import { useEffect, type RefObject } from 'react';

/** What Tab can land on inside a dialog. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where Tab (or ⇧Tab) should go instead of where the browser would send it,
 * or `null` to let the browser move focus itself. Only the two ends wrap, and
 * focus that has somehow left the list is pulled back to its near end.
 */
export function wrapFocusTarget<T>(items: readonly T[], active: unknown, backwards: boolean): T | null {
  if (items.length === 0) return null;
  const first = items[0];
  const last = items[items.length - 1];
  const index = items.indexOf(active as T);
  if (index === -1) return backwards ? last : first;
  if (backwards && index === 0) return last;
  if (!backwards && index === items.length - 1) return first;
  return null;
}

/**
 * Holds keyboard focus inside a modal for as long as it is mounted: focus moves
 * into it on open, Tab and ⇧Tab cycle through its controls, and on close focus
 * goes back to whatever had it before — the button that opened it.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    (focusables()[0] ?? panel).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const target = wrapFocusTarget(focusables(), document.activeElement, event.shiftKey);
      if (!target) return;
      event.preventDefault();
      target.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, [ref]);
}
