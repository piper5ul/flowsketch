/**
 * One-off binding performance benchmark. Run with `npm run benchmark:collab-binding`.
 * This is deliberately not a test and has no wall-clock assertion.
 */
import { performance } from 'node:perf_hooks';
import * as Y from 'yjs';
import { createServer } from 'vite';
import type { DiagramData, SerializedNode } from '../shared/types.js';

const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});
const [{ VIEWPORT_KEY, docMeta, nodeEntries }, { bindDocToStore }, { useDiagramStore }] = await Promise.all([
  vite.ssrLoadModule('/shared/collabDoc.ts'),
  vite.ssrLoadModule('/src/lib/collab/binding.ts'),
  vite.ssrLoadModule('/src/store/useDiagramStore.ts'),
]);

const nodes: SerializedNode[] = Array.from({ length: 1_000 }, (_, index) => {
  if (index >= 900) {
    const stroke = index - 900;
    const points = Array.from({ length: 500 }, (_, point) => ({
      x: stroke * 800 + point * 2,
      y: (stroke * 31 + point * 17) % 1_200,
    }));
    return {
      id: `ink-${stroke}`,
      type: 'ink',
      position: { x: stroke * 800, y: 0 },
      width: 1_000,
      height: 1_200,
      data: {
        label: '',
        shape: 'rectangle',
        fill: 'transparent',
        stroke: '#111111',
        ink: { points, width: 3, kind: 'pen' },
      },
    };
  }
  return {
    id: `shape-${index}`,
    type: 'shape',
    position: { x: (index % 50) * 220, y: Math.floor(index / 50) * 140 },
    width: 180,
    height: 80,
    data: { label: `Shape ${index}`, shape: 'rectangle', fill: '#FFFFFF', stroke: '#111111' },
  };
});

const board: DiagramData = { version: 3, nodes, edges: [] };
const state = useDiagramStore.getState();
state.loadDiagram('benchmark', 'Binding benchmark', false, board);

const doc = new Y.Doc();
const origin = Symbol('benchmark-local');
const binding = bindDocToStore(doc, useDiagramStore, origin);
const peer = new Y.Doc();
Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));

let latestUpdate: Uint8Array | undefined;
peer.on('update', (update: Uint8Array) => {
  latestUpdate = update;
});

function applyPeerWrite(write: () => void): void {
  latestUpdate = undefined;
  write();
  if (latestUpdate) Y.applyUpdate(doc, latestUpdate);
}

function benchmark(name: string, iterations: number, run: (index: number) => void): void {
  for (let i = 0; i < 5; i += 1) run(i);
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) run(i + 5);
  const elapsed = performance.now() - started;
  process.stdout.write(`${name}: ${(elapsed / iterations).toFixed(2)} ms/op (${iterations} measured runs)\n`);
}

try {
  benchmark('local one-node selection', 25, (index) => {
    const id = index % 2 === 0 ? 'shape-0' : 'shape-1';
    useDiagramStore.getState().narrowSelection(new Set([id]));
  });

  benchmark('remote viewport update', 25, (index) => {
    applyPeerWrite(() => {
      docMeta(peer).set(VIEWPORT_KEY, { x: index, y: index * 2, zoom: 1 });
    });
  });

  benchmark('remote edit to a 500-point ink stroke', 25, (index) => {
    applyPeerWrite(() => {
      const entry = nodeEntries(peer).get('ink-0');
      if (!entry) throw new Error('Benchmark ink stroke is missing');
      nodeEntries(peer).set('ink-0', {
        order: entry.order,
        value: { ...entry.value, position: { ...entry.value.position, x: index + 1 } },
      });
    });
  });
} finally {
  binding.destroy();
  peer.destroy();
  doc.destroy();
  await vite.close();
}
