import { getNodesBounds } from '@xyflow/react';
import { toPng } from 'html-to-image';
import { useDiagramStore } from '../store/useDiagramStore';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExportViewport {
  /** CSS pixel size of the rendered image, padding included. */
  width: number;
  height: number;
  /** Transform that maps flow coordinates into that image. */
  viewport: { x: number; y: number; zoom: number };
}

export interface ExportViewportOptions {
  /** Breathing room around the diagram, in flow units. */
  padding: number;
  /** Device pixels rendered per CSS pixel; only used to respect the canvas limit. */
  pixelRatio: number;
  /** Longest CSS-pixel side the image may take before it is scaled down. */
  maxSide?: number;
}

const DEFAULT_MAX_SIDE = 4096;

/** Browsers refuse to rasterize a canvas whose longer side passes this. */
const MAX_DEVICE_SIDE = 16384;

/** Padding used around an exported diagram, in flow units. */
export const EXPORT_PADDING = 24;

const DEFAULT_BACKGROUND = '#f6f7fb';

/** Suppresses transitions while capturing — see the rule in `index.css`. */
const EXPORTING_CLASS = 'is-exporting-image';

/**
 * Selection rings live on the nodes themselves, but these chrome elements are
 * always drawn and would otherwise be baked into the exported image.
 */
const EXCLUDED_SELECTORS = [
  '.react-flow__handle',
  '.quick-add-btn',
  '.connector-joint-hit',
  '.connector-label-target',
  '.react-flow__resize-control',
  '.react-flow__nodesselection',
  '.react-flow__selection',
];

/**
 * Sizes an export image around the diagram's bounds and returns the viewport
 * transform that brings the diagram into it, independent of how the user
 * happens to be panned or zoomed. Pure, so the framing rules stay testable.
 */
export function computeExportViewport(bounds: Rect, options: ExportViewportOptions): ExportViewport {
  const { padding, pixelRatio, maxSide = DEFAULT_MAX_SIDE } = options;

  const paddedWidth = Math.max(bounds.width, 0) + padding * 2;
  const paddedHeight = Math.max(bounds.height, 0) + padding * 2;
  const longestSide = Math.max(paddedWidth, paddedHeight);

  let zoom = 1;
  if (longestSide > maxSide) zoom = maxSide / longestSide;

  const ratio = pixelRatio > 0 ? pixelRatio : 1;
  if (longestSide * zoom * ratio > MAX_DEVICE_SIDE) {
    zoom = MAX_DEVICE_SIDE / (longestSide * ratio);
  }

  return {
    width: Math.max(1, Math.round(paddedWidth * zoom)),
    height: Math.max(1, Math.round(paddedHeight * zoom)),
    viewport: {
      x: (padding - bounds.x) * zoom,
      y: (padding - bounds.y) * zoom,
      zoom,
    },
  };
}

function exportFilter(node: HTMLElement): boolean {
  if (typeof node.matches !== 'function') return true;
  return !EXCLUDED_SELECTORS.some((selector) => node.matches(selector));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Clearing the selection in the store only reaches the DOM once React commits,
 * which is not guaranteed within a single frame — so wait for the rendered
 * result rather than for a fixed delay, with a bounded number of attempts.
 */
async function waitForSelectionCleared(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    await nextFrame();
    if (!document.querySelector('.react-flow__node.selected, .react-flow__edge.selected')) return;
  }
}

/**
 * Renders the whole diagram to a PNG data URL, framed to its content rather
 * than to whatever the viewport happens to show. Returns null for an empty
 * diagram so callers can skip downloading a blank image.
 */
export async function renderDiagramPng(
  options: { pixelRatio?: number; background?: string } = {},
): Promise<string | null> {
  const { nodes, edges } = useDiagramStore.getState();
  if (nodes.length === 0) return null;

  const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!viewportEl) return null;

  const pixelRatio = options.pixelRatio ?? 2;
  const { width, height, viewport } = computeExportViewport(getNodesBounds(nodes), {
    padding: EXPORT_PADDING,
    pixelRatio,
  });

  // Selection rings and the handles they reveal are UI, not diagram. Clear the
  // selection for the capture and put it back afterwards — state only, so the
  // export never costs the user an undo step.
  const selectedNodeIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
  const selectedEdgeIds = new Set(edges.filter((e) => e.selected).map((e) => e.id));
  const hadSelection = selectedNodeIds.size > 0 || selectedEdgeIds.size > 0;

  // Shapes transition their box-shadow, so a selection ring fades out over
  // several frames and would be captured mid-fade. Freeze transitions first,
  // then the deselect lands in a single style recalculation.
  document.body.classList.add(EXPORTING_CLASS);

  if (hadSelection) {
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
      edges: s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
    }));
    await waitForSelectionCleared();
  }

  try {
    return await toPng(viewportEl, {
      width,
      height,
      backgroundColor: options.background ?? DEFAULT_BACKGROUND,
      pixelRatio,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      },
      filter: exportFilter,
    });
  } finally {
    document.body.classList.remove(EXPORTING_CLASS);
    if (hadSelection) {
      useDiagramStore.setState((s) => ({
        nodes: s.nodes.map((n) => (selectedNodeIds.has(n.id) ? { ...n, selected: true } : n)),
        edges: s.edges.map((e) => (selectedEdgeIds.has(e.id) ? { ...e, selected: true } : e)),
      }));
    }
  }
}
