/**
 * Versioned diagram JSON.
 *
 * `Diagram.data` is a free-form JSON column, so every row the server hands back
 * is only as trustworthy as the client that wrote it: rows predate the version
 * field, predate `type` discriminators, and may come from a *newer* build after
 * a rollback. `migrateDiagramData` is the single door into the store — it takes
 * anything and either returns data at `CURRENT_DIAGRAM_VERSION` or throws.
 *
 * Adding a version: bump `CURRENT_DIAGRAM_VERSION`, add a `vN -> vN+1` step to
 * `MIGRATIONS`, and leave the earlier steps alone.
 *
 * Not every new field is a version. `ShapeData.fillStyle` is optional and an
 * absent one reads as `'filled'` (`resolveFillStyle` in `src/lib/shapeStyle.ts`),
 * so every diagram written before it existed is already correct and there is no
 * step here for it — a field is only worth a version when the *old* spelling
 * would be misread without one. `DiagramData.defaults` (the board's "save as
 * default style") is the same case: absent means "no board defaults" and the
 * built-in ones apply, which is what every diagram written before it already
 * wants. It is *narrowed* rather than migrated — see `sanitizeDefaults`. So is
 * `DiagramData.thumbnailNodeIds` ("set as board thumbnail"), where an absent
 * field means the dashboard card is the automatic picture of the whole board —
 * again what every older diagram wants — and `sanitizeThumbnailIds` is the
 * narrowing.
 *
 * **Mind maps are the same case again**: `ShapeData.mindMap` and
 * `ConnectorData.role` are optional, and absent means "an ordinary shape" and
 * "an ordinary connector" — which is exactly what every diagram written before
 * mind maps existed holds. There is no step here for them either.
 *
 * **Freehand strokes are the same case once more**: an `ink` node's `data.ink`
 * is optional and absent on every other node, which is what every diagram
 * written before the pen existed holds — a node with no `ink` simply is not a
 * stroke, and its `type` says so first. No step here for it either.
 *
 * **Sequence diagrams are the same case yet again**: `ShapeData.sequence` and
 * `ConnectorData.sequence` say which piece of a pasted sequence diagram a shape
 * or a connector is (`src/lib/sequenceLayout.ts`), and absent means "an
 * ordinary shape" and "an ordinary connector" — what every diagram written
 * before they existed holds. Nothing *draws* from either field: a participant is
 * a rectangle and a lifeline's far end is the same invisible 1×1 anchor a
 * floating arrow already hangs off, so a row without them is not merely
 * readable but identical. No step here for them.
 *
 * What a mind map does *not* store is `hidden`: folding a branch away sets `collapsed` in
 * the data, and `hidden` is derived from it on load (see `deriveMindMapHidden`
 * in the store), so the JSON stays a description of the map rather than a cache
 * of what is on screen.
 *
 * **`ShapeData.table` is the same case once more**: only a node of type `table`
 * carries one, and a diagram written before tables existed holds no such node,
 * so there is nothing an older spelling could be misread as. Like `defaults` it
 * is squared up rather than migrated — `normalizeTable`, applied in
 * `loadDiagram`, where a ragged grid out of the free-form JSON column would
 * otherwise reach the canvas.
 *
 * **`ShapeData.wire` is the same case once more, and then some**: only a node
 * of type `wire` carries one, and a diagram written before wireframes existed
 * holds no such node — so there is nothing an older spelling could be misread
 * as, and no step here for it. It is narrowed where it is *read*
 * (`wireComponentOf` in `src/lib/wireframe.ts`) rather than on load, for the
 * reason `votes` is: `data` is a free-form bag everywhere else too, a component
 * name from a newer build is a real possibility, and a node whose component
 * this build cannot name simply draws nothing.
 *
 * **Dot voting and the board timer are the case yet again.** `ShapeData.votes`
 * is absent on every shape nobody has voted for, and `DiagramData.voting` /
 * `DiagramData.timer` are absent on a board that has never run a round or
 * started a countdown — which is what every diagram written before they existed
 * holds, so there is no step for any of the three. The two board-level fields
 * are *narrowed* here the way `defaults` and `thumbnailNodeIds` are
 * (`sanitizeVotingSession` in `src/lib/voting.ts`, `sanitizeTimer` in
 * `src/lib/timer.ts`); the per-node `votes` are narrowed where they are counted
 * instead (`votesOf`), because a shape's `data` is a free-form bag everywhere
 * else too and there is no reason to make loading a board walk every node for
 * this one field.
 */
import type { DiagramData, DiagramViewport, SerializedEdge, SerializedNode } from '../../shared/types.js';
import type { ArrowStyle, StrokeWidth } from '../types.js';
import { computeMarkers } from './edgeMarkers.js';
import { DEFAULT_EDGE_STROKE } from './defaults.js';
import { sanitizeDefaults } from './defaultStyle.js';
import { sanitizeThumbnailIds } from './boardThumbnail.js';
import { sanitizeVotingSession } from './voting.js';
import { sanitizeTimer } from './timer.js';

/** The version this build writes. Bump it when the shape of a diagram changes. */
export const CURRENT_DIAGRAM_VERSION = 3;

type Bag = Record<string, unknown>;

function isRecord(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function recordsOf(value: unknown): Bag[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * The stored viewport, if it is one. Whatever comes back here is handed
 * straight to React Flow as its `defaultViewport`, so a half-written or
 * hand-edited value is dropped in favour of framing the content instead.
 */
function viewportOf(value: unknown): DiagramViewport | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y, zoom } = value;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof zoom !== 'number') return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return undefined;
  return { x, y, zoom };
}

function emptyDiagram(): DiagramData {
  return { version: CURRENT_DIAGRAM_VERSION, nodes: [], edges: [] };
}

/**
 * v0 (anything written before the version field existed) -> v1.
 *
 * v0 rows may be missing the React Flow `type` discriminators and may have no
 * `data` bag at all. Entries without the ids the API requires are dropped
 * rather than carried forward into a body the server would reject.
 *
 * They may also carry arrowhead markers that disagree with their data, or
 * none. That is left to v1 -> v2, which recomputes every edge's markers.
 */
function v0ToV1(raw: Bag): Bag {
  const nodes = recordsOf(raw.nodes)
    .filter((node) => isNonEmptyString(node.id))
    .map((node) => ({
      ...node,
      type: isNonEmptyString(node.type) ? node.type : 'shape',
      position: isRecord(node.position) ? node.position : { x: 0, y: 0 },
      data: isRecord(node.data) ? node.data : {},
    }));

  const edges = recordsOf(raw.edges)
    .filter((edge) => isNonEmptyString(edge.id) && isNonEmptyString(edge.source) && isNonEmptyString(edge.target))
    .map((edge) => ({
      ...edge,
      type: isNonEmptyString(edge.type) ? edge.type : 'connector',
      data: isRecord(edge.data) ? edge.data : {},
    }));

  return { ...raw, version: 1, nodes, edges };
}

/**
 * `edge` wearing the marker ids this build's `<marker>` defs answer to.
 *
 * A marker id is derived state — style, colour and size folded into a name —
 * and the size steps have changed between builds, so an id saved by an older
 * one points at a def that is no longer rendered and the arrowhead silently
 * vanishes. Recomputing from the styles on every load is what keeps a stored
 * id from ever being load-bearing; it also covers an edge that arrived through
 * the API with no ids at all.
 */
function withCurrentMarkers(edge: Bag): Bag {
  const data = isRecord(edge.data) ? edge.data : {};
  const { markerStart, markerEnd } = computeMarkers({
    stroke: isNonEmptyString(data.stroke) ? data.stroke : DEFAULT_EDGE_STROKE,
    startArrowStyle: data.startArrowStyle as ArrowStyle | undefined,
    endArrowStyle: data.endArrowStyle as ArrowStyle | undefined,
    strokeWidth: data.strokeWidth as StrokeWidth | undefined,
  });
  const out: Bag = { ...edge };
  if (markerStart) out.markerStart = markerStart;
  else delete out.markerStart;
  if (markerEnd) out.markerEnd = markerEnd;
  else delete out.markerEnd;
  return out;
}

/**
 * v1 -> v2: the two arrowhead booleans become the five-way styles.
 *
 * `endArrow: true` was the plain filled arrowhead and `false` was a bare end,
 * which is exactly `'arrow'` and `'none'`. The booleans are dropped rather
 * than kept in step, so there is one field per end and no way to read a stale
 * one; markers are derived state and are recomputed from the styles, which
 * also repoints v0/v1 rows at this build's own `<marker>` defs.
 */
function v1ToV2(raw: Bag): Bag {
  const edges = recordsOf(raw.edges).map((edge) => {
    const { startArrow, endArrow, ...rest } = isRecord(edge.data) ? edge.data : {};
    const data: Bag = {
      ...rest,
      startArrowStyle: startArrow === true ? 'arrow' : 'none',
      // An end arrow is the app default, so only an explicit `false` removes it.
      endArrowStyle: endArrow === false ? 'none' : 'arrow',
    };
    return withCurrentMarkers({ ...edge, data });
  });

  return { ...raw, version: 2, edges };
}

/** A stored point, if it is one — a free-form JSON column holds anything. */
function pointOf(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) return null;
  const { x, y } = value;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * v2 -> v3: the one dragged bend becomes a list of them.
 *
 * A stored `waypoint` is the single entry of the new `waypoints`; a `null` or
 * absent one leaves the connector with no list at all, which is what a route
 * nobody has touched holds. The old key is dropped rather than kept in step, so
 * there is no second place a bend can be read from.
 */
function v2ToV3(raw: Bag): Bag {
  const edges = recordsOf(raw.edges).map((edge) => {
    if (!isRecord(edge.data) || !('waypoint' in edge.data)) return edge;
    const { waypoint, ...rest } = edge.data;
    const data: Bag = { ...rest };
    const point = pointOf(waypoint);
    if (point) data.waypoints = [point];
    return { ...edge, data };
  });

  return { ...raw, version: 3, edges };
}

/** `MIGRATIONS[n]` upgrades a v`n` payload to v`n+1`. */
const MIGRATIONS: ((raw: Bag) => Bag)[] = [v0ToV1, v1ToV2, v2ToV3];

/**
 * Normalizes whatever the API returned into a `DiagramData` this build
 * understands. Unknown top-level and per-element keys are preserved, so a field
 * a newer build added is not silently dropped by an older one.
 *
 * @throws when the payload was written by a newer version of the app.
 */
export function migrateDiagramData(raw: unknown): DiagramData {
  if (!isRecord(raw)) return emptyDiagram();

  const version = typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : 0;
  if (version > CURRENT_DIAGRAM_VERSION) {
    throw new Error(
      `This diagram was saved by a newer version of FlowSketch (format v${version}; this build reads up to v${CURRENT_DIAGRAM_VERSION}).`,
    );
  }

  let data = raw;
  for (let v = Math.max(version, 0); v < CURRENT_DIAGRAM_VERSION; v++) {
    data = MIGRATIONS[v](data);
  }

  const migrated: DiagramData = {
    ...data,
    version: CURRENT_DIAGRAM_VERSION,
    nodes: recordsOf(data.nodes) as unknown as SerializedNode[],
    // Whatever version it came in at: see `withCurrentMarkers`.
    edges: recordsOf(data.edges).map(withCurrentMarkers) as unknown as SerializedEdge[],
  };

  const viewport = viewportOf(data.viewport);
  if (viewport) migrated.viewport = viewport;
  else delete migrated.viewport;

  // Narrowed on the way in, whatever version the payload came in at: the column
  // is free-form JSON, and a `defaults` carrying a label, a lock or an image
  // would stamp it on every shape drawn after it.
  const defaults = sanitizeDefaults(data.defaults);
  if (defaults) migrated.defaults = defaults;
  else delete migrated.defaults;

  // Narrowed on the way in for the same reason: the ids decide what the
  // dashboard card draws, and a value that is not a list of them is no
  // thumbnail at all — which is to say the automatic one.
  const thumbnailNodeIds = sanitizeThumbnailIds(data.thumbnailNodeIds);
  if (thumbnailNodeIds) migrated.thumbnailNodeIds = thumbnailNodeIds;
  else delete migrated.thumbnailNodeIds;

  // The round of voting and the countdown, narrowed on the way in for the same
  // reason: a half-written round would leave a board where dots cannot be cast
  // and cannot be revealed, and a timer whose end time does not parse would
  // show a countdown that never moves.
  const voting = sanitizeVotingSession(data.voting);
  if (voting) migrated.voting = voting;
  else delete migrated.voting;

  const timer = sanitizeTimer(data.timer);
  if (timer) migrated.timer = timer;
  else delete migrated.timer;

  return migrated;
}
