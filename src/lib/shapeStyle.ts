/**
 * How a shape is painted: what fills its silhouette and what (if anything)
 * outlines it. A filled shape wears no outline and no shadow — the board's
 * grey (`--canvas`) is what a white shape stands out against, the way
 * Whimsical's does — so the drawing stays flat.
 *
 * A shape carries a `fill` *and* a `stroke` — the palette hands out both as one
 * swatch — but only one of them is drawn at a time. `fillStyle` says which:
 * `'filled'` (the default, and what an absent field means) paints the fill and
 * no outline at all, `'outline'` paints white behind the label and draws the
 * stroke around it. Nothing rewrites the stored pair, so toggling back and
 * forth is lossless and no diagram had to be migrated for the field to exist.
 *
 * This is the pure half — `ShapeNode` renders what it returns and holds no
 * opinion of its own about which colour goes where.
 */
import type { FillStyle, ShapeData } from '../types';
import { isAnchorNode } from './nodeKinds';

/** What an outline shape puts behind its label. */
export const OUTLINE_FILL = '#FFFFFF';

/**
 * The line across a filled cylinder's shoulder. A cylinder is the one shape
 * whose silhouette is two surfaces rather than one: without its cap edge a
 * filled one reads as a rounded rectangle, so the seam survives the loss of the
 * outline as a hint of the fill's own shading rather than as a border.
 */
export const CYLINDER_SEAM = 'rgba(20, 20, 40, 0.14)';

type PaintData = Pick<ShapeData, 'shape' | 'fill' | 'stroke' | 'fillStyle'>;

/** `'filled'` unless the shape says otherwise — an absent field is the default. */
export function resolveFillStyle(data: Pick<ShapeData, 'fillStyle'>): FillStyle {
  return data.fillStyle === 'outline' ? 'outline' : 'filled';
}

export interface ShapePaint {
  /** What fills the silhouette. */
  fill: string;
  /** The outline's colour, or `null` when the shape wears none. */
  stroke: string | null;
}

/**
 * What to paint a shape with.
 *
 * Two kinds answer for themselves whatever the field says. A floating arrow's
 * endpoint is a 1×1 node with a transparent fill *and* stroke (see
 * `isAnchorNode`), and giving it a white box would put a speck on the board
 * that nothing selected; a text shape draws no outline at all, and a white
 * background behind it would be a box the user never asked for.
 */
export function shapePaint(data: PaintData): ShapePaint {
  if (isAnchorNode(data)) return { fill: 'transparent', stroke: null };
  if (data.shape === 'text' || data.shape === 'image') return { fill: data.fill, stroke: null };
  if (resolveFillStyle(data) === 'outline') return { fill: OUTLINE_FILL, stroke: data.stroke };
  return { fill: data.fill, stroke: null };
}
