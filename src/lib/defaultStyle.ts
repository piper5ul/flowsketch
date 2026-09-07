/**
 * Board defaults — the style every new shape, sticky note, text shape and
 * connector on *this* diagram is drawn in.
 *
 * "Save as default style" (⌘⇧D) takes the one selected element and remembers
 * how it looks, so the next thing of that kind starts out the same. What is
 * remembered is **style and nothing else**: the two whitelists below are the
 * whole of it, and everything about an element that is not style — its label,
 * its link, its lock, its image, its `shape` kind, its size and its position —
 * has no way in. That is not a nicety. `Diagram.data` is free-form JSON written
 * by other browsers, so a default carrying `imageSrc` or `locked` would be a
 * defaults object that could stamp somebody else's picture, or a lock, onto
 * every shape a collaborator drew afterwards.
 *
 * The module is pure and knows nothing about the store, React or Yjs, which is
 * what lets `migrateDiagramData` (a stored row), `server/collab/render.ts` (a
 * document rendered to JSON) and `src/lib/collab/binding.ts` (a peer's write)
 * all narrow the same untrusted value through the same `sanitizeDefaults`.
 *
 * Relative imports spell out `.js` because the server compiles this under
 * `nodenext` — see the note on `diagramMigrations.ts` in CLAUDE.md.
 */
import type { ConnectorData, ShapeData } from '../types.js';

/**
 * The four things a board can hold a default for.
 *
 * A sticky note and a text shape are `ShapeKind`s like any other, but they are
 * their own kind here because they are their own kind to the person drawing
 * them: a yellow sticky must not become the colour of the last rectangle
 * somebody styled, which is exactly what one shared "shape" default would do.
 */
export type DefaultStyleKind = 'shape' | 'sticky' | 'text' | 'connector';

/** Every kind, for the callers that have to walk them all. */
export const DEFAULT_STYLE_KINDS: readonly DefaultStyleKind[] = ['shape', 'sticky', 'text', 'connector'];

/** How a kind is named in a message to the user ("…as default for shapes"). */
export const DEFAULT_STYLE_KIND_LABELS: Record<DefaultStyleKind, string> = {
  shape: 'shapes',
  sticky: 'sticky notes',
  text: 'text',
  connector: 'connectors',
};

/**
 * The style keys a shape's default keeps: the fill and outline, which of the
 * two is painted, and the whole of the label's typography. Deliberately not
 * `shape` (a default says how a thing looks, never what it is), not `label`,
 * `link`, `locked`, `imageSrc` or `uploading`, and not width or height —
 * Whimsical's own default style is not a size either.
 */
export const SHAPE_STYLE_KEYS = [
  'fill',
  'stroke',
  'fillStyle',
  'fontSize',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'textColor',
  'textAlign',
  'verticalAlign',
  'cornerRadius',
  'opacity',
  'shadow',
] as const;

/**
 * The style keys a connector's default keeps: the line, both arrowheads and
 * which of the three kinds it is routed as. Not the label, not the waypoints
 * (a route is drawn for two particular shapes) and not the anchors.
 */
export const CONNECTOR_STYLE_KEYS = [
  'connectorType',
  'stroke',
  'strokeStyle',
  'strokeWidth',
  'startArrowStyle',
  'endArrowStyle',
] as const;

/** A board's saved defaults, one entry per kind that has ever been saved. */
export interface BoardDefaults {
  shape?: Partial<ShapeData>;
  sticky?: Partial<ShapeData>;
  text?: Partial<ShapeData>;
  connector?: Partial<ConnectorData>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `data` narrowed to `keys`, dropping anything absent or explicitly undefined. */
function pick(data: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = data[key];
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/** The style a shape, sticky note or text shape hands to the next one of its kind. */
export function pickShapeStyle(data: Record<string, unknown>): Partial<ShapeData> {
  return pick(data, SHAPE_STYLE_KEYS) as Partial<ShapeData>;
}

/** The style a connector hands to the next one. */
export function pickConnectorStyle(data: Record<string, unknown>): Partial<ConnectorData> {
  return pick(data, CONNECTOR_STYLE_KEYS) as Partial<ConnectorData>;
}

/**
 * Which default a node is an example of, or `null` when it is not an example of
 * any: a group and a frame paint themselves from the theme rather than from a
 * fill and a stroke, and an image has no style to copy at all.
 *
 * `type` is what tells a container from a shape — never the data, which a
 * container carries like any other node (see `nodeKinds.ts`).
 */
export function kindOf(node: { type?: string; data?: { shape?: unknown } }): DefaultStyleKind | null {
  // A container has no style to copy, and neither has a freehand stroke: its
  // only style is a colour, and "make this the default shape" would carry a
  // pen's ink onto every box drawn after it.
  if (node.type === 'group' || node.type === 'frame' || node.type === 'ink') return null;
  const shape = node.data?.shape;
  if (shape === 'image') return null;
  if (shape === 'sticky') return 'sticky';
  if (shape === 'text') return 'text';
  return 'shape';
}

/**
 * Whatever arrived, as board defaults this build is willing to apply.
 *
 * Everything here comes from somewhere that cannot be trusted — a JSON column,
 * a Yjs document another browser wrote — so each kind is narrowed to its own
 * whitelist and an entry that survives with nothing in it is dropped, as is the
 * whole object when no kind survives. `undefined` rather than `{}` is what
 * "this board has no defaults" is spelled as, so an old diagram's JSON is
 * unchanged and `serializeDiagram` has a value it can leave out.
 */
export function sanitizeDefaults(raw: unknown): BoardDefaults | undefined {
  if (!isRecord(raw)) return undefined;
  const out: BoardDefaults = {};
  let any = false;
  for (const kind of DEFAULT_STYLE_KINDS) {
    const value = raw[kind];
    if (!isRecord(value)) continue;
    const style = kind === 'connector' ? pickConnectorStyle(value) : pickShapeStyle(value);
    if (Object.keys(style).length === 0) continue;
    // The cast is the union collapsing: `connector` took the connector branch.
    (out as Record<string, unknown>)[kind] = style;
    any = true;
  }
  return any ? out : undefined;
}

/**
 * The style a new element of `kind` starts from.
 *
 * Two layers, and the order is the point. `board` is what somebody pressed
 * ⌘⇧D to say and is saved with the diagram; `session` is the colour or
 * connector kind this tab last *used*, which Whimsical carries over to the next
 * shape and which belongs to nobody but this browser. The session layer wins
 * because it is always the more recent of the two — saving a board default
 * clears it for that kind, so pressing ⌘⇧D is never quietly overruled by a
 * swatch picked ten minutes earlier.
 */
export function resolveDefaultStyle(
  board: BoardDefaults | undefined,
  session: BoardDefaults | undefined,
  kind: 'connector',
): Partial<ConnectorData>;
export function resolveDefaultStyle(
  board: BoardDefaults | undefined,
  session: BoardDefaults | undefined,
  kind: Exclude<DefaultStyleKind, 'connector'>,
): Partial<ShapeData>;
export function resolveDefaultStyle(
  board: BoardDefaults | undefined,
  session: BoardDefaults | undefined,
  kind: DefaultStyleKind,
): Partial<ShapeData> | Partial<ConnectorData>;
export function resolveDefaultStyle(
  board: BoardDefaults | undefined,
  session: BoardDefaults | undefined,
  kind: DefaultStyleKind,
): Partial<ShapeData> | Partial<ConnectorData> {
  return { ...board?.[kind], ...session?.[kind] };
}

/**
 * `defaults` with `kind` set to `style`, or removed when there is no style left
 * to keep. Returns `undefined` when nothing is set at all, which is the spelling
 * `serializeDiagram` leaves out of the JSON.
 */
export function withDefault(
  defaults: BoardDefaults | undefined,
  kind: DefaultStyleKind,
  style: Partial<ShapeData> | Partial<ConnectorData> | undefined,
): BoardDefaults | undefined {
  const next: BoardDefaults = { ...defaults };
  if (style && Object.keys(style).length > 0) (next as Record<string, unknown>)[kind] = style;
  else delete next[kind];
  return Object.keys(next).length > 0 ? next : undefined;
}
