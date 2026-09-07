/**
 * Presenting a diagram: which frames are slides, in what order, and where the
 * mask that clips everything outside the current one has to be drawn.
 *
 * Pure and structural, the way `arrange.ts` and `search.ts` are: this is handed
 * plain nodes and a viewport rather than the store, so the ordering rule and
 * the mask geometry can be stated over plain objects and tested without a
 * diagram — or a browser — behind them. The store's `ShapeNode[]` satisfies
 * `SlideNode` as it stands.
 *
 * **A slide is a frame.** Whimsical presents one section per slide, and a frame
 * is our section; a nested frame is a slide of its own there too, so it is one
 * here. Nothing else on the board is a slide: a diagram with no frames cannot
 * be presented, which is what the `view.present` command is gated on.
 */

import { absolutePosition } from './nodeTree';
import { isFrameNode } from './nodeKinds';

/** Just enough of a node to work out whether it is a slide, and where. */
export interface SlideNode {
  id: string;
  type?: string;
  parentId?: string;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  measured?: { width?: number | null; height?: number | null };
  data: {
    label?: string;
    fill?: string;
    stroke?: string;
    /** Where this frame sits in the running order. See `slideOrderOf`. */
    slideOrder?: unknown;
  };
}

/** A box in board coordinates. */
export interface SlideRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A box in the flow container's coordinates — pixels, ready for CSS. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Slide {
  /** The frame's node id — what `fitView` is pointed at. */
  id: string;
  /** The frame's title, or `Frame n` for one that was never named. */
  title: string;
  /** The frame's box in **board** coordinates, ancestors folded in. */
  rect: SlideRect;
  /**
   * What the backdrop is painted with while this slide is up: the frame's own
   * colour, mixed exactly as `FrameNode` mixes it, so the slide reads as the
   * section it is rather than as a hole cut in the canvas.
   */
  background: string;
}

/** One `updateNodeData`-shaped patch, as `setSlideOrder` applies them. */
export interface SlideOrderPatch {
  id: string;
  data: { slideOrder: number };
}

/**
 * The stored running order of a frame, or `null` for one nobody has ordered.
 *
 * `data` is free-form JSON on a column older than this feature, so anything
 * that is not a real number reads as "not ordered" rather than sorting the
 * board into nonsense.
 */
function slideOrderOf(data: SlideNode['data']): number | null {
  const value = data.slideOrder;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sizeOf(node: SlideNode): { w: number; h: number } {
  return {
    w: node.width ?? node.measured?.width ?? 0,
    h: node.height ?? node.measured?.height ?? 0,
  };
}

/**
 * Reading order for two frames that have no stored order between them: down
 * the board, then across it, with the id breaking the last tie so the running
 * order never depends on where a frame happens to sit in the array.
 *
 * The positions compared are **board** coordinates — a frame inside another
 * frame stores an offset from it, and a running order that mixed the two
 * spellings would put a nested slide in a place nobody could predict.
 */
function byReadingOrder(a: SlideRect & { id: string }, b: SlideRect & { id: string }): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * How `FrameNode` paints a frame's ground, as a colour string.
 *
 * A frame with no colour of its own is the theme's panel; one the user
 * coloured wears a toned-down version of that colour. Kept here rather than
 * imported from the component so the presentation's backdrop cannot drift from
 * the frame's own — and so it can be asserted on.
 */
export function slideBackground(data: SlideNode['data']): string {
  // A missing colour is not a colour: `Diagram.data` is free-form JSON, and
  // `color-mix(in srgb, undefined 28%, …)` is not a declaration a browser keeps.
  const tinted =
    !!data.fill && !!data.stroke && data.fill !== 'transparent' && data.stroke !== 'transparent';
  return tinted ? `color-mix(in srgb, ${data.fill} 28%, var(--panel))` : 'var(--panel)';
}

/**
 * The board's frames as slides, in the order they are presented.
 *
 * **A frame carrying a `slideOrder` comes first**, sorted by that number;
 * frames nobody has ordered follow in reading order. That rule is what lets
 * "Arrange slides" say something without having to write a number onto every
 * frame on the board — an unordered frame added later joins the end rather
 * than shuffling into the middle of a deck somebody arranged.
 */
export function slidesOf(nodes: readonly SlideNode[]): Slide[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const entries = nodes
    .filter((node) => isFrameNode(node))
    .map((node) => {
      const { x, y } = absolutePosition(node, byId);
      return { node, order: slideOrderOf(node.data), rect: { x, y, ...sizeOf(node) } };
    });

  entries.sort((a, b) => {
    if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
    if (a.order !== null && b.order === null) return -1;
    if (a.order === null && b.order !== null) return 1;
    return byReadingOrder({ ...a.rect, id: a.node.id }, { ...b.rect, id: b.node.id });
  });

  return entries.map(({ node, rect }, index) => ({
    id: node.id,
    // A frame is drawn with a placeholder title until it is named, so an
    // unnamed one is numbered by where it sits in the deck.
    title: node.data.label?.trim() || `Frame ${index + 1}`,
    rect,
    background: slideBackground(node.data),
  }));
}

/**
 * The patches that make `orderedIds` the running order: `slideOrder` 0…n-1,
 * and nothing at all for a frame already carrying the number it would be given.
 *
 * Ids that name no frame — and any id repeated — are skipped rather than
 * counted, so a stale list from a panel rendered before a frame was deleted
 * still produces a contiguous order. A frame the caller left out keeps whatever
 * order it had; "Arrange slides" always lists every frame, so a partial list is
 * a deliberate act on the caller's part and not something to guess about.
 */
export function reorderSlides(
  nodes: readonly SlideNode[],
  orderedIds: readonly string[],
): SlideOrderPatch[] {
  const frames = new Map(nodes.filter((node) => isFrameNode(node)).map((n) => [n.id, n] as const));
  const seen = new Set<string>();
  const patches: SlideOrderPatch[] = [];
  let next = 0;
  for (const id of orderedIds) {
    const frame = frames.get(id);
    if (!frame || seen.has(id)) continue;
    seen.add(id);
    const order = next++;
    if (slideOrderOf(frame.data) !== order) patches.push({ id, data: { slideOrder: order } });
  }
  return patches;
}

/** `ids` with the entry at `index` swapped with its neighbour `delta` away. */
export function moveSlide(ids: readonly string[], index: number, delta: 1 | -1): string[] {
  const target = index + delta;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return [...ids];
  const out = [...ids];
  [out[index], out[target]] = [out[target], out[index]];
  return out;
}

/**
 * A slide's box in the flow container's pixels, under the live viewport
 * transform — the same transform React Flow applies to the board itself, so
 * the mask lands exactly on the frame however the fit animation is progressing.
 */
export function slideScreenRect(
  rect: SlideRect,
  viewport: { x: number; y: number; zoom: number },
): ScreenRect {
  return {
    left: rect.x * viewport.zoom + viewport.x,
    top: rect.y * viewport.zoom + viewport.y,
    width: rect.w * viewport.zoom,
    height: rect.h * viewport.zoom,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The four bands covering everything in `container` except `hole` — top, bottom,
 * left, right — which is how "anything outside the section is clipped" is drawn.
 *
 * Four opaque rects rather than a `clip-path` with a reversed inner polygon:
 * the arithmetic is the same either way, and this way it is four numbers per
 * band that a test can read. Every band is clamped to the container, so a slide
 * scrolled half off screen (or larger than the window) paints no negative box.
 */
export function maskRects(hole: ScreenRect, container: { width: number; height: number }): ScreenRect[] {
  const { width, height } = container;
  const left = clamp(hole.left, 0, width);
  const right = clamp(hole.left + hole.width, 0, width);
  const top = clamp(hole.top, 0, height);
  const bottom = clamp(hole.top + hole.height, 0, height);
  const bandHeight = Math.max(0, bottom - top);
  return [
    { left: 0, top: 0, width, height: top },
    { left: 0, top: bottom, width, height: Math.max(0, height - bottom) },
    { left: 0, top, width: left, height: bandHeight },
    { left: right, top, width: Math.max(0, width - right), height: bandHeight },
  ];
}
