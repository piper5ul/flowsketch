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
 */
import type { DiagramData, DiagramViewport, SerializedEdge, SerializedNode } from '../../shared/types.js';
import type { ArrowStyle, StrokeWidth } from '../types.js';
import { computeMarkers } from './edgeMarkers.js';
import { DEFAULT_EDGE_STROKE } from './defaults.js';

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

    const { markerStart, markerEnd } = computeMarkers({
      stroke: isNonEmptyString(data.stroke) ? data.stroke : DEFAULT_EDGE_STROKE,
      startArrowStyle: data.startArrowStyle as ArrowStyle,
      endArrowStyle: data.endArrowStyle as ArrowStyle,
      strokeWidth: data.strokeWidth as StrokeWidth | undefined,
    });

    const migrated: Bag = { ...edge, data };
    if (markerStart) migrated.markerStart = markerStart;
    else delete migrated.markerStart;
    if (markerEnd) migrated.markerEnd = markerEnd;
    else delete migrated.markerEnd;
    return migrated;
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
    edges: recordsOf(data.edges) as unknown as SerializedEdge[],
  };

  const viewport = viewportOf(data.viewport);
  if (viewport) migrated.viewport = viewport;
  else delete migrated.viewport;

  return migrated;
}
