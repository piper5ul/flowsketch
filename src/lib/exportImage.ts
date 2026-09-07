import { toPng, toSvg } from 'html-to-image';
import type { Options as HtmlToImageOptions } from 'html-to-image/lib/types';
import { useDiagramStore } from '../store/useDiagramStore';
import { boardRect, type HitNode } from './connectorGesture';
import { subtreeIds } from './nodeTree';
import { pinLightTheme } from './theme';

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

/**
 * The light canvas, spelled out rather than read from `--canvas`: an export is
 * always captured in the light theme (see `pinLightTheme`), so this is a
 * constant of the file format and not of whatever the app is wearing.
 */
/** The light theme's `--canvas`, spelled out because an export cannot read a CSS variable. */
const DEFAULT_BACKGROUND = '#eaeff4';

/** Suppresses transitions while capturing — see the rule in `index.css`. */
const EXPORTING_CLASS = 'is-exporting-image';

/**
 * Selection rings live on the nodes themselves, but these chrome elements are
 * always drawn and would otherwise be baked into the exported image.
 */
const EXCLUDED_SELECTORS = [
  // A comment pin lives inside the viewport so it pans and zooms with the
  // board, which puts it inside what is captured. A discussion about the
  // drawing is not part of the drawing.
  '.comment-pin',
  // Likewise a peer's cursor: it is in the viewport so it pans with the board,
  // and who happened to be looking is not part of the drawing.
  '.presence-cursor',
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

export interface CaptureOptions {
  pixelRatio?: number;
  /** A CSS colour, or `null` for a transparent image. */
  background?: string | null;
  maxSide?: number;
  /**
   * Only the selected shapes (with whatever is inside them) and the
   * connectors that join two of them, framed by their own bounds. With
   * nothing selected it is the whole board, so a caller can pass the user's
   * preference through without checking.
   */
  selectionOnly?: boolean;
  /**
   * Keeps the user's selection on screen during the capture. Clearing it is
   * right for an export the user asked for, but a background capture (the
   * dashboard thumbnail) must not make the selection ring and the floating
   * toolbar blink mid-edit — a ring baked into a 480 px preview is the
   * cheaper of the two costs.
   */
  preserveSelection?: boolean;
}

/** What an export subset needs to know about a connector: its two ends. */
export interface SubsetEdge {
  id: string;
  source: string;
  target: string;
  selected?: boolean;
}

/**
 * What an export draws: every node, or — for a selection-only export with
 * something selected — the selected nodes with their subtrees, and only the
 * connectors that join two nodes in that set. `bounds` frames them in board
 * coordinates (a child's stored position is relative to its parent, so this
 * goes through `boardRect`); it is `null` when there is nothing to draw.
 */
export function exportSubset<N extends HitNode & { selected?: boolean }, E extends SubsetEdge>(
  nodes: readonly N[],
  edges: readonly E[],
  selectionOnly: boolean,
): { nodes: N[]; edgeIds: Set<string>; bounds: Rect | null } {
  const selected = selectionOnly ? nodes.filter((n) => n.selected).map((n) => n.id) : [];
  const keep = selected.length > 0 ? subtreeIds(nodes, selected) : null;
  const subset = keep ? nodes.filter((n) => keep.has(n.id)) : [...nodes];
  const ids = new Set(subset.map((n) => n.id));
  const edgeIds = new Set(edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => e.id));

  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  let bounds: Rect | null = null;
  for (const node of subset) {
    const r = boardRect(node, byId);
    if (!r) continue;
    bounds = bounds
      ? {
          x: Math.min(bounds.x, r.x),
          y: Math.min(bounds.y, r.y),
          width: Math.max(bounds.x + bounds.width, r.x + r.width) - Math.min(bounds.x, r.x),
          height: Math.max(bounds.y + bounds.height, r.y + r.height) - Math.min(bounds.y, r.y),
        }
      : { ...r };
  }
  return { nodes: subset, edgeIds, bounds };
}

/**
 * The capture filter for a subset: the usual chrome exclusions, plus any node
 * or connector element that is not in it.
 */
function subsetFilter(nodeIds: Set<string>, edgeIds: Set<string>, everything: boolean) {
  return (el: HTMLElement): boolean => {
    if (!exportFilter(el)) return false;
    if (everything || typeof el.matches !== 'function') return true;
    const id = el.getAttribute('data-id');
    if (id && el.matches('.react-flow__node')) return nodeIds.has(id);
    if (id && el.matches('.react-flow__edge')) return edgeIds.has(id);
    return true;
  };
}

/** `toPng` / `toSvg`: what the shared capture hands the framed viewport to. */
type Renderer = (node: HTMLElement, options: HtmlToImageOptions) => Promise<string>;

/**
 * Frames the whole diagram by its content rather than by whatever the viewport
 * happens to show, hides the editing chrome, and hands the result to `render`.
 * Returns null for an empty diagram, so callers can skip downloading a blank
 * image. Every format goes through here, so they all frame identically.
 */
async function captureDiagram(render: Renderer, options: CaptureOptions): Promise<string | null> {
  const { nodes, edges } = useDiagramStore.getState();
  const subset = exportSubset(nodes, edges, options.selectionOnly ?? false);
  if (!subset.bounds) return null;

  const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!viewportEl) return null;

  const pixelRatio = options.pixelRatio ?? 2;
  const { width, height, viewport } = computeExportViewport(subset.bounds, {
    padding: EXPORT_PADDING,
    pixelRatio,
    maxSide: options.maxSide,
  });

  // Selection rings and the handles they reveal are UI, not diagram. Clear the
  // selection for the capture and put it back afterwards — state only, so the
  // export never costs the user an undo step.
  const selectedNodeIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
  const selectedEdgeIds = new Set(edges.filter((e) => e.selected).map((e) => e.id));
  const hadSelection =
    !options.preserveSelection && (selectedNodeIds.size > 0 || selectedEdgeIds.size > 0);

  // Shapes transition their box-shadow, so a selection ring fades out over
  // several frames and would be captured mid-fade. Freeze transitions first,
  // then the deselect lands in a single style recalculation.
  document.body.classList.add(EXPORTING_CLASS);

  // An exported diagram is a document, not a screenshot of the editor: it is
  // captured in the light theme however the app is being viewed. Set before
  // the frames below, so the recalculation lands in the same settle.
  const restoreTheme = pinLightTheme(document.documentElement);

  if (hadSelection) {
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
      edges: s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
    }));
    await waitForSelectionCleared();
  }

  try {
    return await render(viewportEl, {
      width,
      height,
      // `undefined` leaves the PNG transparent.
      backgroundColor: options.background === null ? undefined : (options.background ?? DEFAULT_BACKGROUND),
      pixelRatio,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      },
      filter: subsetFilter(new Set(subset.nodes.map((n) => n.id)), subset.edgeIds, subset.nodes.length === nodes.length),
    });
  } finally {
    restoreTheme();
    document.body.classList.remove(EXPORTING_CLASS);
    if (hadSelection) {
      useDiagramStore.setState((s) => ({
        nodes: s.nodes.map((n) => (selectedNodeIds.has(n.id) ? { ...n, selected: true } : n)),
        edges: s.edges.map((e) => (selectedEdgeIds.has(e.id) ? { ...e, selected: true } : e)),
      }));
    }
  }
}

/** The diagram as a PNG data URL. */
export function renderDiagramPng(options: CaptureOptions = {}): Promise<string | null> {
  return captureDiagram(toPng, options);
}

/** The data URL prefix `html-to-image`'s `toSvg` produces. */
const SVG_DATA_URL_PREFIX = 'data:image/svg+xml;charset=utf-8,';

/**
 * Paints `color` behind an SVG data URL.
 *
 * `toSvg` puts `backgroundColor` on the cloned node, which the export then
 * translates and scales to frame the diagram — so the fill lands somewhere
 * inside the image instead of behind all of it. A `<rect>` in the SVG's own
 * coordinate system covers the document however the contents are transformed.
 */
export function insertSvgBackground(dataUrl: string, color: string): string {
  if (!dataUrl.startsWith(SVG_DATA_URL_PREFIX)) return dataUrl;
  const svg = decodeURIComponent(dataUrl.slice(SVG_DATA_URL_PREFIX.length));
  const rootTagEnd = svg.indexOf('>');
  if (!svg.startsWith('<svg') || rootTagEnd === -1) return dataUrl;
  const painted =
    svg.slice(0, rootTagEnd + 1) +
    `<rect width="100%" height="100%" fill="${color}"/>` +
    svg.slice(rootTagEnd + 1);
  return SVG_DATA_URL_PREFIX + encodeURIComponent(painted);
}

/**
 * The diagram as an SVG data URL.
 *
 * `html-to-image` builds this by wrapping the cloned DOM in a `foreignObject`,
 * so it is a browser-renderable document rather than editable vector art —
 * good for embedding in a page or a wiki, not for opening in Illustrator.
 */
export async function renderDiagramSvg(options: CaptureOptions = {}): Promise<string | null> {
  // The capture leaves the background off and it is painted in afterwards, in
  // the SVG's own coordinates. See `insertSvgBackground`.
  const dataUrl = await captureDiagram(toSvg, { ...options, background: 'transparent' });
  if (dataUrl === null) return null;
  if (options.background === null) return dataUrl;
  return insertSvgBackground(dataUrl, options.background ?? DEFAULT_BACKGROUND);
}
