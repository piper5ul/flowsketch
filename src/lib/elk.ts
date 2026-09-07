/**
 * The one place the Eclipse Layout Kernel is loaded and run.
 *
 * elkjs is a GWT-compiled port of ELK and weighs about 1.4 MB — more than the
 * rest of the app put together — for a command most sessions never reach for.
 * So it is behind a **dynamic `import()`**: Vite splits it into its own chunk
 * and the browser fetches it the first time somebody lays a diagram out, not on
 * the way to the canvas. `elk.bundled.js` is the build that runs the algorithm
 * in-process (there is a web-worker build too, but a worker would have to be
 * served from a URL we control and the layout of a hand-drawn diagram takes
 * tens of milliseconds — not a frame budget worth a second deployment artefact).
 *
 * The instance is cached, so the second layout costs nothing and the module is
 * fetched once. Everything about *what* to lay out is in `autoLayout.ts`; this
 * is only the call.
 */
import type { ElkGraph, ElkPlacement } from './autoLayout';

/** The half of elkjs's `ELK` interface we use, so nothing here needs its types at load time. */
interface ElkInstance {
  layout(graph: ElkGraph): Promise<{ children?: { id: string; x?: number; y?: number }[] }>;
}

let instance: Promise<ElkInstance> | null = null;

function loadElk(): Promise<ElkInstance> {
  instance ??= import('elkjs/lib/elk.bundled.js').then(
    ({ default: ElkConstructor }) => new ElkConstructor() as unknown as ElkInstance,
  );
  return instance;
}

/**
 * Where ELK would put each of the graph's nodes, in the graph's own coordinates.
 *
 * ELK also reports routed edge sections; they are dropped on purpose. A
 * connector in this app is drawn by `src/lib/connectorPath.ts` against the
 * shapes' live positions, so a set of points frozen at layout time would be
 * wrong the moment anything moved.
 */
export async function runElkLayout(graph: ElkGraph): Promise<ElkPlacement[]> {
  const elk = await loadElk();
  const result = await elk.layout(graph);
  return (result.children ?? []).map((child) => ({
    id: child.id,
    x: child.x ?? 0,
    y: child.y ?? 0,
  }));
}
