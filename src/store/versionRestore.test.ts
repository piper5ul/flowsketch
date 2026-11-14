import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { bindDocToStore, type DocBinding } from '../lib/collab/binding';
import { docToDiagramData } from '../../server/collab/render';
import { consumeSuppressBlur, setDocumentHistory, suppressNextBlurCommit, useDiagramStore } from './useDiagramStore';

const store = () => useDiagramStore.getState();
let binding: DocBinding | undefined;

beforeEach(() => store().loadDiagram('test', 'Current title', false, { nodes: [], edges: [] }));
afterEach(() => {
  binding?.destroy();
  binding = undefined;
  setDocumentHistory(null);
  vi.useRealTimers();
});

describe.each([false, true])('applyVersionRestore (bound=%s)', (bound) => {
  it('replaces content and board meta in one undo step, preserving the viewport and earlier history', () => {
    const doc = new Y.Doc();
    if (bound) {
      binding = bindDocToStore(doc, useDiagramStore, Symbol('restorer'));
      setDocumentHistory(binding.history);
    }
    const id = store().addShape('rectangle', { x: 10, y: 20 });
    const other = store().addShape('rectangle', { x: 300, y: 20 });
    store().onConnect({ source: id, target: other, sourceHandle: null, targetHandle: null });
    const beforeEdges = store().edges;
    store().updateNodeData(id, { label: 'Before restore' });
    const viewport = { x: 23, y: 45, zoom: 0.8 };
    store().setViewport(viewport);
    const before = store().nodes;
    const version = {
      nodes: [{ id: 'old', position: { x: 30, y: 40 }, data: { shape: 'rectangle', label: 'Snapshot' } }],
      edges: [],
      viewport: { x: 999, y: 999, zoom: 2 },
      defaults: { shape: { fill: '#123456', imageSrc: 'untrusted' } },
      thumbnailNodeIds: ['old'],
      voting: { active: true, dotsPerPerson: 3, revealed: false, startedById: 'u1' },
      timer: { endsAt: '2026-11-14T22:00:00.000Z', startedById: 'u1' },
    };

    store().applyVersionRestore(version);

    expect(store().nodes).toMatchObject([{ id: 'old', type: 'shape', data: { label: 'Snapshot' } }]);
    expect(store().edges).toEqual([]);
    expect(store().defaults).toEqual({ shape: { fill: '#123456' } });
    expect(store().thumbnailNodeIds).toEqual(['old']);
    expect(store().voting).toEqual(version.voting);
    expect(store().timer).toEqual(version.timer);
    expect(store().viewport).toEqual(viewport);
    expect(store().title).toBe('Current title');
    if (bound) expect(docToDiagramData(doc).nodes.map((n) => n.id)).toEqual(['old']);

    store().undo();
    expect(store().nodes.map((n) => n.data.label)).toEqual(before.map((n) => n.data.label));
    expect(store().edges.map((e) => e.id)).toEqual(beforeEdges.map((e) => e.id));
    expect(store().defaults).toEqual({});
    expect(store().thumbnailNodeIds).toBeNull();
    expect(store().voting).toBeNull();
    expect(store().timer).toBeNull();
    expect(store().viewport).toEqual(viewport);
    store().undo();
    expect(store().nodes[0].data.label).toBe('');
    store().redo();
    store().redo();
    expect(store().nodes[0].id).toBe('old');
  });
});

it('separates a held transient gesture and the following nudge from the restore', () => {
  vi.useFakeTimers();
  const doc = new Y.Doc();
  binding = bindDocToStore(doc, useDiagramStore, Symbol('restorer'));
  setDocumentHistory(binding.history);
  const id = store().addShape('rectangle', { x: 0, y: 0 });
  store().moveNodesTransient({ [id]: { x: 25, y: 30 } });
  const version = { nodes: [{ ...store().nodes[0], position: { x: 100, y: 100 }, selected: true }], edges: [] };
  store().applyVersionRestore(version);
  vi.runAllTimers();
  store().nudgeSelected(1, 0);
  store().undo();
  expect(store().nodes[0].position).toEqual({ x: 100, y: 100 });
  store().undo();
  expect(store().nodes[0].position).toEqual({ x: 25, y: 30 });
  store().undo();
  expect(store().nodes[0].position).toEqual({ x: 0, y: 0 });
});

it('clears missing board metadata and stale blur suppression without clearing earlier undo', () => {
  const id = store().addShape('rectangle', { x: 0, y: 0 });
  store().setThumbnailNodeIds([id]);
  suppressNextBlurCommit();
  store().applyVersionRestore({ nodes: [], edges: [] });
  expect(consumeSuppressBlur()).toBe(false);
  expect(store().thumbnailNodeIds).toBeNull();
  store().undo();
  expect(store().thumbnailNodeIds).toEqual([id]);
});

it('opens a new nudge entry even when a nudge immediately preceded restore', () => {
  vi.useFakeTimers();
  const id = store().addShape('rectangle', { x: 0, y: 0 });
  useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: n.id === id })) }));
  store().nudgeSelected(1, 0);
  store().applyVersionRestore({ nodes: [{ ...store().nodes[0], position: { x: 50, y: 60 } }], edges: [] });
  store().nudgeSelected(1, 0);
  store().undo();
  expect(store().nodes[0].position).toEqual({ x: 50, y: 60 });
  store().undo();
  expect(store().nodes[0].position).toEqual({ x: 1, y: 0 });
});
