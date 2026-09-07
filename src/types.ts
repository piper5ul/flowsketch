/**
 * `image` is not a drawing tool: images are inserted (paste, drop, file
 * picker), never drawn, so it has no `Tool` counterpart and no rail shortcut.
 */
export type ShapeKind =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'sticky'
  | 'text'
  | 'pill'
  | 'triangle'
  | 'hexagon'
  | 'cylinder'
  | 'image'
  | 'parallelogram'
  | 'document'
  | 'cloud'
  | 'star'
  | 'callout'
  | 'arrow';
/**
 * What a node *is*, as React Flow's `type` discriminator spells it.
 *
 * `shape` is everything the user draws. The other two are containers other
 * nodes hang off through `parentId`: a `group` is an invisible box that makes a
 * handful of shapes move as one, and a `frame` is a titled section shapes join
 * by being dropped into it. Both carry a `ShapeData` like any other node — the
 * store's array is homogeneous — so `type`, never the data, is what tells them
 * apart (`isGroupNode` / `isFrameNode` in `src/lib/nodeKinds.ts`).
 */
export type DiagramNodeType = 'shape' | 'group' | 'frame';
export type ConnectorKind = 'straight' | 'elbow' | 'curved';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
/** Thin, regular, bold. The pixel each maps to is `CONNECTOR_STROKE_PX`. */
export type StrokeWidth = 1 | 2 | 3;
/** What either end of a connector wears. `none` is a bare line. */
export type ArrowStyle = 'none' | 'arrow' | 'open' | 'circle' | 'diamond' | 'bar' | 'halfcircle' | 'dot';
export type Direction = 'top' | 'right' | 'bottom' | 'left';
export type Tool =
  | 'select'
  | 'pan'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'sticky'
  | 'text'
  | 'connector'
  | 'pill'
  | 'triangle'
  | 'hexagon'
  | 'cylinder'
  | 'parallelogram'
  | 'document'
  | 'cloud'
  | 'star'
  | 'callout'
  | 'arrow'
  // Not a `ShapeKind`: a frame is a container, not a silhouette, so it has no
  // entry in the shape tables and is placed by `addFrame` rather than `addShape`.
  | 'frame';

export interface SwatchColor {
  id: string;
  fill: string;
  stroke: string;
}

/**
 * The label sizes shapes were drawn at before `fontSize` became a number of
 * pixels. Still the only spelling a *connector* label has, and still readable
 * on a shape — `src/lib/text.ts` is where the two meet.
 */
export type FontSize = 'small' | 'medium' | 'large';
export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

/**
 * Which of a shape's two colours is drawn. `filled` paints the fill and no
 * outline; `outline` paints white and draws the stroke around it. Absent means
 * `filled` — see `src/lib/shapeStyle.ts`, which is where the choice is resolved.
 */
export type FillStyle = 'filled' | 'outline';

// `.js` on purpose: the server compiles this file under `nodenext`, where an
// extensionless relative import is not a legal specifier — see the note on
// `src/lib/diagramMigrations.ts` in CLAUDE.md.
import type { MindMapNodeData } from './lib/mindMap.js';

export type { MindMapNodeData };

export interface ShapeData {
  label: string;
  shape: ShapeKind;
  fill: string;
  stroke: string;
  /**
   * Which of the two above is drawn. Absent — as it is on every shape saved
   * before this existed — reads as `'filled'`: the fill, and no outline at all.
   * `'outline'` paints white and draws `stroke` around it. Neither spelling
   * rewrites the pair, so the toggle is lossless.
   */
  fillStyle?: FillStyle;
  /**
   * The label's size in pixels. Diagrams saved before the scale existed hold
   * one of the three preset names instead; `resolveFontSize` reads both, which
   * is why there is no migration step for this.
   */
  fontSize?: FontSize | number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  /**
   * The label's colour, as a hex string. Absent means "pick one for me": the
   * label is drawn light or dark to contrast with the fill, which is what every
   * shape saved before this existed still wants.
   */
  textColor?: string;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  /**
   * How far the corners are rounded, in px. Only the kinds CSS draws as a box
   * with corners have any — `canRoundCorners` is the list.
   */
  cornerRadius?: number;
  /** 0.1–1. Absent is fully opaque, which is what every older shape wants. */
  opacity?: number;
  /** Whether the shape casts a drop shadow. */
  shadow?: boolean;
  /**
   * Present on a **mind-map node** and absent on every other shape — which is
   * the whole of what makes a shape part of a map. `root` names the map (the
   * root's own entry points at itself) and `collapsed` folds its descendants
   * away; the parent/child structure is the connectors, not this. See
   * `src/lib/mindMap.ts`.
   */
  mindMap?: MindMapNodeData;
  link?: string;
  locked?: boolean;
  /**
   * Where this frame sits in the running order when the diagram is presented —
   * one slide per frame, see `src/lib/presentation.ts`. Only a frame carries
   * one, and **absent means "not ordered"**: such a frame is presented after
   * every ordered one, in reading order, so a section added to an arranged deck
   * joins the end instead of shuffling into the middle of it.
   */
  slideOrder?: number;
  imageSrc?: string;
  /** Set on an `image` node whose bytes are still uploading. */
  uploading?: boolean;
  [key: string]: unknown;
}

export interface EdgeAnchor {
  side: Direction;
  /** Fraction along that side, 0 = one corner, 1 = the other, 0.5 = midpoint. */
  t: number;
}

/**
 * What a connector *is for*, where that is more than a line between two shapes.
 * Absent on every connector anyone has ever drawn, which is what "no role" is.
 * `'mindmap'` makes it a branch of a mind map, running parent → child.
 */
export type ConnectorRole = 'mindmap';

export interface ConnectorData {
  connectorType: ConnectorKind;
  /** See `ConnectorRole`. Absent on an ordinary connector. */
  role?: ConnectorRole;
  stroke: string;
  strokeStyle: StrokeStyle;
  /** Absent on connectors saved before widths existed; they read as regular. */
  strokeWidth?: StrokeWidth;
  label: string;
  labelFontSize?: FontSize;
  labelBold?: boolean;
  labelItalic?: boolean;
  /** 0–1 position of the label along the path (0 = source, 1 = target). */
  labelT?: number;
  /**
   * The arrowheads. Absent on a connector written before v2 of the diagram
   * format, which carried `startArrow`/`endArrow` booleans instead —
   * `migrateDiagramData` rewrites those, so nothing downstream reads them.
   */
  startArrowStyle?: ArrowStyle;
  endArrowStyle?: ArrowStyle;
  /**
   * The user-dragged bends the path is pulled through, in order from the
   * source end to the target end. Absent (or empty) is a route nobody has
   * touched; diagrams written before v3 of the format held a single `waypoint`
   * instead, which `migrateDiagramData` rewrites as a one-entry list.
   */
  waypoints?: { x: number; y: number }[];
  sourceAnchor?: EdgeAnchor | null;
  targetAnchor?: EdgeAnchor | null;
  [key: string]: unknown;
}
