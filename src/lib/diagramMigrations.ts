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
import type { DiagramData, SerializedEdge, SerializedNode } from '../../shared/types';
import { computeMarkers } from './edgeMarkers';

/** The version this build writes. Bump it when the shape of a diagram changes. */
export const CURRENT_DIAGRAM_VERSION = 1;

/** Same value as `DEFAULT_EDGE_STROKE`; inlined until that constant exists. */
const LEGACY_EDGE_STROKE = '#6B7080';

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

function emptyDiagram(): DiagramData {
  return { version: CURRENT_DIAGRAM_VERSION, nodes: [], edges: [] };
}

/**
 * v0 (anything written before the version field existed) -> v1.
 *
 * v0 rows may be missing the React Flow `type` discriminators, may have no
 * `data` bag at all, and may carry arrowhead markers that disagree with their
 * data (or none). Entries without the ids the API requires are dropped rather
 * than carried forward into a body the server would reject.
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
    .map((edge) => {
      const data = isRecord(edge.data) ? edge.data : {};
      // Markers are derived state; recompute them so a v0 row with stale or
      // missing arrowheads renders the arrows its data actually asks for.
      const { markerStart, markerEnd } = computeMarkers({
        stroke: isNonEmptyString(data.stroke) ? data.stroke : LEGACY_EDGE_STROKE,
        startArrow: data.startArrow === true,
        // An end arrow is the app default, so only an explicit `false` removes it.
        endArrow: data.endArrow !== false,
      });
      const migrated: Bag = { ...edge, type: isNonEmptyString(edge.type) ? edge.type : 'connector', data };
      if (markerStart) migrated.markerStart = markerStart;
      else delete migrated.markerStart;
      if (markerEnd) migrated.markerEnd = markerEnd;
      else delete migrated.markerEnd;
      return migrated;
    });

  return { ...raw, version: 1, nodes, edges };
}

/** `MIGRATIONS[n]` upgrades a v`n` payload to v`n+1`. */
const MIGRATIONS: ((raw: Bag) => Bag)[] = [v0ToV1];

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

  return {
    ...data,
    version: CURRENT_DIAGRAM_VERSION,
    nodes: recordsOf(data.nodes) as unknown as SerializedNode[],
    edges: recordsOf(data.edges) as unknown as SerializedEdge[],
  };
}
