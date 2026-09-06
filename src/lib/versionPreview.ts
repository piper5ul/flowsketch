/**
 * A thumbnail of a stored version, computed from that version's own JSON.
 *
 * Deliberately not React Flow. `ConnectorEdge` looks its endpoints up in the
 * **live** diagram store — that is how it routes around the obstacles on the
 * board — so a React Flow preview of a past version would draw that version's
 * connectors against today's node positions, and draw nothing at all for a
 * shape that has since been deleted. A preview whose whole job is to answer
 * "is this the state I want back?" cannot be quietly wrong about that.
 *
 * So this reduces a version to boxes and centre-to-centre lines in the
 * diagram's own coordinates, and lets an SVG `viewBox` do the scaling. It is
 * pure, and it reads nothing but the version it was handed.
 */
import type { DiagramData, SerializedEdge, SerializedNode } from '../../shared/types';
import { DEFAULT_EDGE_STROKE } from './defaults';

/** Box a node is drawn at when the stored row does not say — v0 rows may not. */
const FALLBACK_WIDTH = 180;
const FALLBACK_HEIGHT = 100;

/** Air left around the content, as a fraction of the longer side. */
const PADDING_RATIO = 0.08;

/** Floor on that padding, for a diagram of one small shape. */
const MIN_PADDING = 16;

export interface PreviewBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
}

export interface PreviewLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
}

export interface VersionPreviewGeometry {
  /** `min-x min-y width height`, framing every node with a little air. */
  viewBox: string;
  boxes: PreviewBox[];
  /** Only the connectors whose endpoints are both in this version. */
  lines: PreviewLine[];
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value !== '' ? value : fallback;
}

function boxOf(node: SerializedNode): PreviewBox {
  return {
    id: node.id,
    x: node.position?.x ?? 0,
    y: node.position?.y ?? 0,
    w: node.width ?? FALLBACK_WIDTH,
    h: node.height ?? FALLBACK_HEIGHT,
    // A transparent fill or stroke is a real value here (text shapes, and the
    // 1×1 anchors a floating arrow hangs off), so it is carried through.
    fill: stringOr(node.data?.fill, '#FFFFFF'),
    stroke: stringOr(node.data?.stroke, '#94A3B8'),
  };
}

function lineOf(edge: SerializedEdge, byId: Map<string, PreviewBox>): PreviewLine | null {
  const source = byId.get(edge.source);
  const target = byId.get(edge.target);
  // An endpoint this version does not have is a connector that cannot be
  // drawn — which is a thing stored diagrams do contain, not an error.
  if (!source || !target) return null;
  return {
    id: edge.id,
    x1: source.x + source.w / 2,
    y1: source.y + source.h / 2,
    x2: target.x + target.w / 2,
    y2: target.y + target.h / 2,
    stroke: stringOr(edge.data?.stroke, DEFAULT_EDGE_STROKE),
  };
}

/**
 * `data` as boxes and lines, or `null` when there is nothing to draw — an
 * empty diagram has no bounds to frame, and the caller says so in words
 * rather than showing an empty rectangle.
 */
export function buildVersionPreview(data: DiagramData): VersionPreviewGeometry | null {
  const boxes = data.nodes.map(boxOf);
  if (boxes.length === 0) return null;

  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));

  const width = maxX - minX;
  const height = maxY - minY;
  const padding = Math.max(MIN_PADDING, Math.max(width, height) * PADDING_RATIO);

  const byId = new Map(boxes.map((b) => [b.id, b]));
  const lines = data.edges
    .map((edge) => lineOf(edge, byId))
    .filter((line): line is PreviewLine => line !== null);

  return {
    viewBox: [minX - padding, minY - padding, width + padding * 2, height + padding * 2].join(' '),
    boxes,
    lines,
  };
}
