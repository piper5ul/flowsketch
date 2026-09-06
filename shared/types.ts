export interface DiagramData {
  /**
   * Format version, written by `CURRENT_DIAGRAM_VERSION`. Absent on rows
   * saved before versioning existed — `migrateDiagramData` reads those as v0.
   */
  version?: number;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
  /**
   * Where the canvas was left. Absent on every diagram saved before this was
   * stored, and on one that has never been panned, which is why it needed no
   * version bump: the canvas frames the content itself when it is missing.
   */
  viewport?: DiagramViewport;
}

/** A React Flow viewport, as `onMoveEnd` reports it. */
export interface DiagramViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface SerializedNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  data: Record<string, unknown>;
}

export interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  zIndex?: number;
  markerStart?: unknown;
  markerEnd?: unknown;
  data?: Record<string, unknown>;
}

/** Response of `POST /api/images`. `url` is what a node's `data.imageSrc` stores. */
export interface ImageMeta {
  id: string;
  url: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface DiagramMeta {
  id: string;
  title: string;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
  thumbnail: string | null;
}

/**
 * A dashboard thumbnail is stored inline on the diagram row rather than in the
 * image table: it is derived, disposable, and wanted by the same query that
 * lists the cards. Both ends agree on the format so the client never spends an
 * upload on a value the server is going to reject.
 */
export const THUMBNAIL_DATA_URL_PREFIX = 'data:image/png;base64,';

/** Ceiling on a stored thumbnail data URL, in characters (~200 KB). */
export const MAX_THUMBNAIL_CHARS = 200 * 1024;
