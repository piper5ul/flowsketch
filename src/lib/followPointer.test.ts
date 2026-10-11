import { describe, expect, it, vi } from 'vitest';
import { followPointer, type FollowPointerEnv } from './followPointer';

function harness() {
  const target = new EventTarget();
  const frames = new Map<number, () => void>();
  let next = 1;
  const env: FollowPointerEnv = {
    target,
    requestFrame: (cb) => {
      frames.set(next, cb);
      return next++;
    },
    cancelFrame: (h) => void frames.delete(h),
  };
  const tick = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb());
  };
  const move = (x: number) => {
    const ev = new Event('pointermove') as Event & { clientX: number };
    ev.clientX = x;
    target.dispatchEvent(ev);
  };
  const key = (k: string) => {
    const ev = new Event('keydown') as Event & { key: string };
    ev.key = k;
    target.dispatchEvent(ev);
  };
  return { target, env, tick, move, key, frames };
}

describe('followPointer', () => {
  it('acts on the latest move once per frame, and flushes a waiting one on release', () => {
    const h = harness();
    const seen: number[] = [];
    const onEnd = vi.fn();
    followPointer((ev) => seen.push(ev.clientX), onEnd, h.env);
    h.move(1);
    h.move(2);
    h.move(3);
    h.tick();
    h.move(4);
    h.target.dispatchEvent(new Event('pointerup'));
    expect(seen).toEqual([3, 4]);
    expect(onEnd).toHaveBeenCalledTimes(1);
    h.move(5);
    h.tick();
    expect(seen).toEqual([3, 4]);
  });

  it.each([
    ['pointercancel', (h: ReturnType<typeof harness>) => h.target.dispatchEvent(new Event('pointercancel'))],
    ['Escape', (h: ReturnType<typeof harness>) => h.key('Escape')],
  ])('drops a waiting move on %s and writes nothing after it', (_name, cancel) => {
    const h = harness();
    const onMove = vi.fn();
    const onEnd = vi.fn();
    followPointer(onMove, onEnd, h.env);
    h.move(1);
    cancel(h);
    h.tick();
    h.move(2);
    h.target.dispatchEvent(new Event('pointerup'));
    h.tick();
    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(h.frames.size).toBe(0);
  });

  it('is cancelled by the function it returns (an unmount), once', () => {
    const h = harness();
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const cancel = followPointer(onMove, onEnd, h.env);
    h.move(1);
    cancel();
    cancel();
    h.tick();
    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ignores keys other than Escape', () => {
    const h = harness();
    const onMove = vi.fn();
    followPointer(onMove, undefined, h.env);
    h.move(1);
    h.key('Shift');
    h.tick();
    expect(onMove).toHaveBeenCalledTimes(1);
  });
});
