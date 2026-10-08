import { describe, expect, it, vi } from 'vitest';
import { listenForCanvasPointerActivity } from './canvasPointerActivity';

describe('canvas pointer activity listeners', () => {
  it('registers and removes pointer listeners in the capture phase', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const target = { addEventListener, removeEventListener } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;
    const onPointerDown = vi.fn();
    const onPointerEnd = vi.fn();

    const remove = listenForCanvasPointerActivity(target, onPointerDown, onPointerEnd);

    expect(addEventListener).toHaveBeenNthCalledWith(1, 'pointerdown', onPointerDown, { capture: true });
    expect(addEventListener).toHaveBeenNthCalledWith(2, 'pointerup', onPointerEnd, { capture: true });
    expect(addEventListener).toHaveBeenNthCalledWith(3, 'pointercancel', onPointerEnd, { capture: true });

    remove();

    expect(removeEventListener).toHaveBeenNthCalledWith(1, 'pointerdown', onPointerDown, { capture: true });
    expect(removeEventListener).toHaveBeenNthCalledWith(2, 'pointerup', onPointerEnd, { capture: true });
    expect(removeEventListener).toHaveBeenNthCalledWith(3, 'pointercancel', onPointerEnd, { capture: true });
  });
});
