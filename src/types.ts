/**
 * `image` is not a drawing tool: images are inserted (paste, drop, file
 * picker), never drawn, so it has no `Tool` counterpart and no rail shortcut.
 */
export type ShapeKind = 'rectangle' | 'ellipse' | 'diamond' | 'sticky' | 'text' | 'pill' | 'triangle' | 'hexagon' | 'cylinder' | 'image';
export type ConnectorKind = 'straight' | 'elbow';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
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
  | 'cylinder';

export interface SwatchColor {
  id: string;
  fill: string;
  stroke: string;
}

export type FontSize = 'small' | 'medium' | 'large';
export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

export interface ShapeData {
  label: string;
  shape: ShapeKind;
  fill: string;
  stroke: string;
  fontSize?: FontSize;
  bold?: boolean;
  italic?: boolean;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  link?: string;
  locked?: boolean;
  imageSrc?: string;
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
  label: string;
  labelFontSize?: FontSize;
  labelBold?: boolean;
  labelItalic?: boolean;
  /** 0–1 position of the label along the path (0 = source, 1 = target). */
  labelT?: number;
  startArrow: boolean;
  endArrow: boolean;
  /** A single user-dragged waypoint the routed path is pulled through. */
  waypoint?: { x: number; y: number } | null;
  sourceAnchor?: EdgeAnchor | null;
  targetAnchor?: EdgeAnchor | null;
  [key: string]: unknown;
}
