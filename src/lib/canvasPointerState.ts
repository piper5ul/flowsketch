const activePointerIds = new Set<number>();
const listeners = new Set<(active: boolean) => void>();

function publish() {
  const active = activePointerIds.size > 0;
  for (const listener of listeners) listener(active);
}

export function isCanvasPointerActive() {
  return activePointerIds.size > 0;
}

export function subscribeCanvasPointerState(listener: (active: boolean) => void) {
  listeners.add(listener);
  listener(isCanvasPointerActive());
  return () => {
    listeners.delete(listener);
  };
}

/** Tracks only pointers that began in the canvas, including portal-rendered edges. */
export function trackCanvasPointers() {
  if (typeof window === 'undefined') return () => {};

  const onPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[role="dialog"][aria-label="Version history"]')) return;
    if (!target.closest('[data-canvas-root]')) return;
    if (activePointerIds.has(event.pointerId)) return;
    activePointerIds.add(event.pointerId);
    publish();
  };
  const onPointerEnd = (event: PointerEvent) => {
    if (activePointerIds.delete(event.pointerId)) publish();
  };
  const onBlur = () => {
    if (activePointerIds.size === 0) return;
    activePointerIds.clear();
    publish();
  };

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', onPointerEnd, true);
  window.addEventListener('pointercancel', onPointerEnd, true);
  window.addEventListener('blur', onBlur);

  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointerup', onPointerEnd, true);
    window.removeEventListener('pointercancel', onPointerEnd, true);
    window.removeEventListener('blur', onBlur);
    onBlur();
  };
}
