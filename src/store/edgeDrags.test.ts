import { describe, expect, it, vi } from 'vitest';
import { followPointer, type FollowPointerEnv } from '../lib/followPointer';
import { activeEdgeDragCount, trackEdgeDrag } from './edgeDrags';
import { useDiagramStore } from './useDiagramStore';

const store = () => useDiagramStore.getState();

function fakeFrames() {
  const target = new EventTarget();
  const frames = new Map<number, () => void>();
  let next = 1;
  const env: FollowPointerEnv = {
    target,
    requestFrame: (cb) => (frames.set(next, cb), next++),
    cancelFrame: (h) => void frames.delete(h),
  };
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb());
  };
  return { target, env, flush };
}

const box = (id: string, x: number) => ({
  id, type: 'shape' as const, position: { x, y: 0 }, width: 100, height: 60,
  data: { label: id, shape: 'rectangle' as const, fill: '#fff', stroke: '#000' },
});

describe('edge drags', () => {
  it('are cancelled when their edge leaves the store, whoever started them', () => {
    store().loadDiagram('test', 'Test', false, {
      nodes: [box('a', 0), box('b', 300), box('c', 600)],
      edges: [{ id: 'e', source: 'a', target: 'b', type: 'connector', data: { targetAnchor: { side: 'left', t: 0.5 } } }],
    });
    const f = fakeFrames();
    // The ConnectorEdge end drag, in miniature: its move re-pins the end and
    // raises the flags; its end lowers them.
    const onMove = vi.fn(() => {
      store().setConnectorDragging(true);
      store().setConnectTarget('c');
      store().reconnectEdgeEndpoint('e', 'target', 'c', { side: 'left', t: 0.5 });
    });
    const onEnd = () => {
      store().setConnectTarget(null);
      store().setConnectorDragging(false);
    };
    // Started from one component instance…
    const startFromMountedEdge = () =>
      trackEdgeDrag('e', (release) => followPointer(onMove, () => { release(); onEnd(); }, f.env));
    startFromMountedEdge();
    f.target.dispatchEvent(new Event('pointermove'));
    f.flush();
    expect(onMove).toHaveBeenCalledTimes(1);
    // …which then remounts: nothing about the drag lives in it. A move is
    // queued, and the edge is deleted before the frame fires.
    f.target.dispatchEvent(new Event('pointermove'));
    useDiagramStore.setState((s) => ({ edges: s.edges.filter((e) => e.id !== 'e') }));
    f.flush();
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(store().connectorDragging).toBe(false);
    expect(store().connectTargetId).toBeNull();
    expect(activeEdgeDragCount()).toBe(0);
  });

  it('forget a drag that ended on release', () => {
    store().loadDiagram('test', 'Test', false, {
      nodes: [box('a', 0), box('b', 300)],
      edges: [{ id: 'e', source: 'a', target: 'b', type: 'connector', data: {} }],
    });
    const f = fakeFrames();
    trackEdgeDrag('e', (release) => followPointer(() => {}, release, f.env));
    expect(activeEdgeDragCount()).toBe(1);
    f.target.dispatchEvent(new Event('pointerup'));
    expect(activeEdgeDragCount()).toBe(0);
  });
});
