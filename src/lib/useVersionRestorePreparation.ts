import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { setVersionRestorePreparation, useDiagramStore, type ShapeNode } from '../store/useDiagramStore';

/** End DOM gesture streams before a restore replaces the controlled elements. */
export function useVersionRestorePreparation(
  storeOnNodesChange: ReturnType<typeof useDiagramStore.getState>['onNodesChange'],
  storeOnNodeDragStop: (event: MouseEvent | TouchEvent, node: ShapeNode, nodes: ShapeNode[]) => void,
  clearDraft: () => void,
  cancellingConnection: RefObject<boolean>,
) {
  const suppressDragEnd = useRef(false);
  const draft = useRef(clearDraft);
  draft.current = clearDraft;

  useEffect(() => {
    let activeTouch: { target: Element; touch: Touch } | null = null;
    const onTouchStart = (event: TouchEvent) => {
      const target = event.target instanceof Element ? event.target.closest('.react-flow__node') : null;
      const touch = event.changedTouches[0];
      if (target && touch) activeTouch = { target, touch };
    };
    const onTouchEnd = (event: TouchEvent) => {
      const current = activeTouch;
      if (current && [...event.changedTouches].some((t) => t.identifier === current.touch.identifier)) {
        activeTouch = null;
      }
    };
    document.addEventListener('touchstart', onTouchStart, true);
    document.addEventListener('touchend', onTouchEnd, true);
    document.addEventListener('touchcancel', onTouchEnd, true);

    setVersionRestorePreparation(() => {
      suppressDragEnd.current = true;
      cancellingConnection.current = true;
      // Connector, table, ink and eraser listeners all stop on pointercancel.
      window.dispatchEvent(new PointerEvent('pointercancel'));
      draft.current();
      // d3-drag and React Flow's handle connections listen for mouse/touch
      // release. End their streams too, suppressing old positions, reparenting
      // and connections so cancellation cannot create a new edit.
      if (activeTouch?.target.isConnected) {
        activeTouch.target.dispatchEvent(new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true,
          changedTouches: [activeTouch.touch],
        }));
      } else {
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
      }
      queueMicrotask(() => {
        suppressDragEnd.current = false;
        cancellingConnection.current = false;
      });
    });
    return () => {
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchend', onTouchEnd, true);
      document.removeEventListener('touchcancel', onTouchEnd, true);
      setVersionRestorePreparation(null);
    };
  }, [cancellingConnection]);

  const onNodesChange = useCallback<typeof storeOnNodesChange>((changes) => {
    const kept = suppressDragEnd.current
      ? changes.filter((change) => change.type !== 'position' && !(change.type === 'dimensions' && change.resizing === false))
      : changes;
    if (kept.length) storeOnNodesChange(kept);
  }, [storeOnNodesChange]);
  const onNodeDragStop = useCallback<typeof storeOnNodeDragStop>((...args) => {
    if (!suppressDragEnd.current) storeOnNodeDragStop(...args);
  }, [storeOnNodeDragStop]);
  return { onNodesChange, onNodeDragStop };
}
