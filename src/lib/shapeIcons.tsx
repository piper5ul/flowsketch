import type { ComponentType } from 'react';
import {
  Circle,
  Cloud,
  Database,
  Diamond,
  Hexagon,
  Image as ImageIcon,
  MessageSquare,
  Square,
  StickyNote,
  Star,
  Triangle,
  Type,
} from 'lucide-react';
import type { ShapeKind } from '../types';

/**
 * One icon per shape kind, shared by the left rail's tool buttons and the
 * floating toolbar's shape swapper so the same shape never wears two faces.
 */
export type ShapeIcon = ComponentType<{ size?: number }>;

/**
 * lucide has no pill, so it is drawn here — in lucide's own 24-unit stroked
 * geometry, so a grid mixing the two reads as a single set rather than as one
 * icon that wandered in from somewhere else.
 */
function outlineIcon(displayName: string, d: string): ShapeIcon {
  // The fast-refresh rule wants a file to export either components or values.
  // This one exports a *map* of components on purpose — the whole point is that
  // the rail and the toolbar read the same table — so there is no HMR boundary
  // here to keep clean.
  // eslint-disable-next-line react/only-export-components
  function OutlineIcon({ size = 18 }: { size?: number }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={d} />
      </svg>
    );
  }
  OutlineIcon.displayName = displayName;
  return OutlineIcon;
}

export const SHAPE_ICONS: Record<ShapeKind, ShapeIcon> = {
  rectangle: Square,
  ellipse: Circle,
  diamond: Diamond,
  pill: outlineIcon('PillIcon', 'M7 7h10a5 5 0 0 1 0 10H7a5 5 0 0 1 0-10z'),
  triangle: Triangle,
  hexagon: Hexagon,
  cylinder: Database,
  sticky: StickyNote,
  text: Type,
  image: ImageIcon,
  parallelogram: outlineIcon('ParallelogramIcon', 'M8 5h13l-5 14H3z'),
  document: outlineIcon('DocumentIcon', 'M4 4h16v12c-2.7 2.7-5.3-2.7-8 0s-5.3 2.7-8 0z'),
  cloud: Cloud,
  star: Star,
  callout: MessageSquare,
  arrow: outlineIcon('BlockArrowIcon', 'M3 9h10V4l8 8-8 8v-5H3z'),
};

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  pill: 'Pill',
  triangle: 'Triangle',
  hexagon: 'Hexagon',
  cylinder: 'Cylinder',
  sticky: 'Sticky note',
  text: 'Text',
  image: 'Image',
  parallelogram: 'Parallelogram',
  document: 'Document',
  cloud: 'Cloud',
  star: 'Star',
  callout: 'Callout',
  arrow: 'Arrow',
};

/**
 * The kinds the shape swapper offers, in the order they are shown. `text` and
 * `image` are left out for the same reason `canSwapShapeKind` refuses them.
 */
export const SWAPPABLE_SHAPE_KINDS: ShapeKind[] = [
  'rectangle',
  'ellipse',
  'diamond',
  'pill',
  'triangle',
  'hexagon',
  'cylinder',
  'sticky',
  'parallelogram',
  'document',
  'cloud',
  'star',
  'callout',
  'arrow',
];
