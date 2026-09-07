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
 * `shape` is everything the user draws with a shape tool. Two of the others are
 * containers other nodes hang off through `parentId`: a `group` is an invisible
 * box that makes a handful of shapes move as one, and a `frame` is a titled
 * section shapes join by being dropped into it. A `table` is neither — it is one
 * object with a grid of editable cells inside it, whose box follows its own
 * columns and rows — and neither is `ink`, which is one freehand stroke: a pen
 * mark with a polyline for a body instead of a silhouette.
 *
 * A `wire` is one wireframe component — a button, a browser chrome, a toggle —
 * and it is one node type holding fourteen sketches rather than fourteen types,
 * because they differ in what they draw and not in what they are
 * (`src/lib/wireframe.ts`).
 *
 * All of them carry a `ShapeData` like any other node — the store's array is
 * homogeneous — so `type`, never the data, is what tells them apart
 * (`isGroupNode` / `isFrameNode` / `isTableNode` / `isInkNode` / `isWireNode` in
 * `src/lib/nodeKinds.ts`).
 */
export type DiagramNodeType = 'shape' | 'group' | 'frame' | 'table' | 'ink' | 'wire';
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
  | 'frame'
  // Nor is a table: it is a grid of cells, placed by `addTable`.
  | 'table'
  // The three freehand tools. None of them places a `ShapeKind` either: a
  // stroke is drawn by dragging (`addInk`), not dropped by clicking, and the
  // eraser places nothing at all. They are three tools rather than one tool
  // with a mode because `TOOL_COMMANDS` and the rail are both a list of tools,
  // and a mode would need a second piece of state for a keystroke to set.
  | 'pen'
  | 'highlighter'
  | 'eraser'
  // Nor is a wireframe component. **One tool value for all fourteen**, with the
  // one that is armed held beside it in the store as `wireComponent`: fourteen
  // tool ids would be fourteen rows in `TOOL_COMMANDS` for keystrokes none of
  // them has (W opens the rail's picker; the components themselves have no
  // keys), and every reader of `Tool` would have to parse a prefix instead of
  // comparing a name.
  | 'wire';

/**
 * One sample along a freehand stroke: x, y, and the pen pressure that drew it
 * where the pointer reported one.
 *
 * A tuple rather than an object, and deliberately so: a long stroke is hundreds
 * of these, they are written into the Yjs document on every commit, and
 * `{"x":1,"y":2}` is four times the JSON of `[1,2]`. The pressure is optional
 * because a mouse has none — nothing draws with it yet (see `InkData.width`),
 * and it is carried so a build that varies the width has it to read.
 */
export type InkPoint = [x: number, y: number, pressure?: number];

/** A marker draws a solid line; a highlighter a wide translucent one. */
export type InkKind = 'marker' | 'highlighter';

/**
 * A freehand stroke, as an `ink` node carries it.
 *
 * The points are **relative to the node's own top-left**, like every other
 * coordinate on a child, and the node's `width`/`height` are their bounding box
 * grown by half the pen width at each edge — so the box holds the drawn line
 * and not just its centre. The colour is not here: it is `ShapeData.stroke`,
 * which is what makes the ordinary palette work on a stroke unchanged.
 */
export interface InkData {
  points: InkPoint[];
  /** The pen's width in board pixels, at the size the stroke was drawn. */
  width: number;
  kind: InkKind;
}

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
import type { WireData } from './lib/wireframe.js';

export type { MindMapNodeData, WireData };

/**
 * The grid inside a `table` node: what is in each cell, how wide each column
 * is, and whether the first row is a header.
 *
 * Cell text is **plain text**. Rendering Markdown inside a cell is a follow-up;
 * a label does it (`src/lib/markdown.ts`) and a cell deliberately does not yet,
 * so what is typed is what is drawn and what search and export see.
 *
 * Every row holds one entry per column — `src/lib/table.ts` is the only place
 * this is edited, and every function there keeps that rectangle true.
 */
export interface TableData {
  /** One per column, left to right. `width` is in board pixels. */
  columns: { width: number }[];
  /** One per row, top to bottom, each with one string per column. */
  rows: { cells: string[] }[];
  /** Whether the first row is drawn as a header. */
  header: boolean;
}

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
  /**
   * Present on an **`ink` node** — one freehand stroke — and absent on every
   * other node, which is what every diagram written before the pen existed
   * already holds, so there is no migration step for it (see the note in
   * `diagramMigrations.ts`). It is the stroke's *body*; what makes the node an
   * ink node is still its `type`, as `isInkNode` reads it.
   */
  ink?: InkData;
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
  /**
   * The grid, on a node of type `table` and nowhere else. Optional and absent
   * everywhere else, which is why tables needed no migration: a diagram written
   * before they existed holds no node that would look for one.
   */
  table?: TableData;
  /**
   * Which wireframe component this is, on a node of type `wire` and nowhere
   * else. Optional and absent everywhere else, which is why wireframes needed
   * no migration: a diagram written before they existed holds no node that
   * would look for one. `wireComponentOf` in `src/lib/wireframe.ts` is the one
   * place a stored value is narrowed — the field arrives out of a free-form
   * JSON column, so a component name this build has never heard of is possible.
   */
  wire?: WireData;
  /**
   * The dots cast on this shape in the board's voting round, as voter id → how
   * many of their dots are on it.
   *
   * Absent is a shape nobody has voted for — which is every shape on every
   * diagram written before voting existed, so this needed no migration step.
   * The *round* the dots were cast in is board meta, not node data: see
   * `DiagramData.voting` and `src/lib/voting.ts`.
   */
  votes?: Record<string, number>;
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
