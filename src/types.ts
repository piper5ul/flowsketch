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
export type ConnectorKind = 'straight' | 'elbow' | 'curved';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
/** Thin, regular, bold. The pixel each maps to is `CONNECTOR_STROKE_PX`. */
export type StrokeWidth = 1 | 2 | 3;
/** What either end of a connector wears. `none` is a bare line. */
export type ArrowStyle = 'none' | 'arrow' | 'open' | 'circle' | 'diamond';
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
  | 'arrow';

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

export interface ShapeData {
  label: string;
  shape: ShapeKind;
  fill: string;
  stroke: string;
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
  link?: string;
  locked?: boolean;
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

export interface ConnectorData {
  connectorType: ConnectorKind;
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
  /** A single user-dragged waypoint the routed path is pulled through. */
  waypoint?: { x: number; y: number } | null;
  sourceAnchor?: EdgeAnchor | null;
  targetAnchor?: EdgeAnchor | null;
  [key: string]: unknown;
}
