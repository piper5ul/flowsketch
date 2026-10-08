/**
 * The pure paint resolver shared by the node renderer and toolbar. It keeps
 * legacy `outline` shapes white while new Outline and Dash looks tint the
 * shape's stored fill; `transparent` can clear any look's inside without
 * changing its border.
 */
import type { FillStyle, ShapeData } from '../types';
import { isHex6, mix, TINT_AMOUNT } from './palette';
import { isAnchorNode } from './nodeKinds';

/** What a legacy outline shape puts behind its label. */
export const OUTLINE_FILL = '#FFFFFF';

/** The SVG dash rhythm; CSS boxes use `border-style: dashed`. */
export const DASH_ARRAY = '5 4';

/**
 * The line across a filled cylinder's shoulder. A cylinder is the one shape
 * whose silhouette is two surfaces rather than one: without its cap edge a
 * filled one reads as a rounded rectangle, so the seam survives the loss of the
 * outline as a hint of the fill's own shading rather than as a border.
 */
export const CYLINDER_SEAM = 'rgba(20, 20, 40, 0.14)';

type PaintData = Pick<ShapeData, 'shape' | 'fill' | 'stroke' | 'fillStyle' | 'transparent'>;

/** Unknown or absent values stay Fill so hand-edited JSON remains renderable. */
export function resolveFillStyle(data: Pick<ShapeData, 'fillStyle'>): FillStyle {
  switch (data.fillStyle as string | undefined) {
    case 'outline':
      return 'outline';
    case 'tinted':
      return 'tinted';
    case 'dashed':
      return 'dashed';
    case 'filled':
    default:
      return 'filled';
  }
}

export type FillLook = 'fill' | 'outline' | 'dash';

/** Maps stored looks to the three buttons shown by the toolbar. */
export function resolveFillLook(data: Pick<ShapeData, 'fillStyle'>): FillLook {
  const style = resolveFillStyle(data);
  if (style === 'dashed') return 'dash';
  if (style === 'outline' || style === 'tinted') return 'outline';
  return 'fill';
}

export interface ShapePaint {
  /** What fills the silhouette. */
  fill: string;
  /** The outline's colour, or `null` when the shape wears none. */
  stroke: string | null;
  /** Whether the stroke is rendered dashed. */
  dashed: boolean;
}

function tintedFill(fill: unknown): string {
  return isHex6(fill) ? mix(fill, '#FFFFFF', TINT_AMOUNT) : OUTLINE_FILL;
}

/** Resolve the shape's stored look into the fill and border the renderer draws. */
export function shapePaint(data: PaintData): ShapePaint {
  if (isAnchorNode(data)) return { fill: 'transparent', stroke: null, dashed: false };
  if (data.shape === 'text' || data.shape === 'image') {
    return { fill: data.fill, stroke: null, dashed: false };
  }

  const style = resolveFillStyle(data);
  let fill = data.fill;
  let stroke: string | null = null;
  let dashed = false;

  if (style === 'outline') {
    fill = OUTLINE_FILL;
    stroke = data.stroke;
  } else if (style === 'tinted' || style === 'dashed') {
    fill = tintedFill(data.fill);
    stroke = data.stroke;
    dashed = style === 'dashed';
  }

  if (data.transparent === true) fill = 'transparent';
  return { fill, stroke, dashed };
}
