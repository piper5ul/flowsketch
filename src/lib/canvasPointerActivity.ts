/** Listen for pointer activity before canvas controls can stop bubbling. */
export function listenForCanvasPointerActivity(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  onPointerDown: EventListener,
  onPointerEnd: EventListener,
): () => void {
  const options: AddEventListenerOptions = { capture: true };
  target.addEventListener('pointerdown', onPointerDown, options);
  target.addEventListener('pointerup', onPointerEnd, options);
  target.addEventListener('pointercancel', onPointerEnd, options);

  return () => {
    target.removeEventListener('pointerdown', onPointerDown, options);
    target.removeEventListener('pointerup', onPointerEnd, options);
    target.removeEventListener('pointercancel', onPointerEnd, options);
  };
}
