/**
 * A pointer drag's moves, delivered at most once per animation frame.
 *
 * A pointer can report several moves a frame, and in a connector drag each is
 * a store write, a re-route and a render nobody sees, so only the latest move
 * of a frame is acted on. The three ways a drag ends are kept apart:
 *
 * - **release** (`pointerup`) flushes a move still waiting, so the drag ends
 *   exactly where the pointer did, then calls `onEnd`;
 * - **cancel** (`pointercancel`, Escape, or the returned function — which the
 *   component calls when it unmounts) drops the waiting move and calls
 *   `onEnd`. Nothing is written after a cancel: a move that had not been drawn
 *   yet never is, and neither is the history entry its first frame would have
 *   opened.
 *
 * Either way the listeners are gone and `onEnd` runs exactly once.
 */
export interface FollowPointerEnv {
  target: EventTarget;
  requestFrame: (cb: () => void) => number;
  cancelFrame: (handle: number) => void;
}

const browserEnv = (): FollowPointerEnv => ({
  target: window,
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
});

export function followPointer(
  onMove: (ev: PointerEvent) => void,
  onEnd?: () => void,
  env: FollowPointerEnv = browserEnv(),
): () => void {
  let frame: number | null = null;
  let latest: PointerEvent | null = null;
  let done = false;
  const run = () => {
    frame = null;
    const ev = latest;
    latest = null;
    if (ev && !done) onMove(ev);
  };
  const move = (ev: Event) => {
    latest = ev as PointerEvent;
    if (frame === null) frame = env.requestFrame(run);
  };
  const stop = (flush: boolean) => {
    if (done) return;
    if (frame !== null) {
      env.cancelFrame(frame);
      if (flush) run();
    }
    frame = null;
    latest = null;
    done = true;
    env.target.removeEventListener('pointermove', move);
    env.target.removeEventListener('pointerup', up);
    env.target.removeEventListener('pointercancel', cancel);
    env.target.removeEventListener('keydown', key);
    onEnd?.();
  };
  const up = () => stop(true);
  const cancel = () => stop(false);
  const key = (ev: Event) => {
    if ((ev as KeyboardEvent).key === 'Escape') cancel();
  };
  env.target.addEventListener('pointermove', move);
  env.target.addEventListener('pointerup', up);
  env.target.addEventListener('pointercancel', cancel);
  env.target.addEventListener('keydown', key);
  return cancel;
}
