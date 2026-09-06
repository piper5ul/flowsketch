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

/**
 * What a user may do with a diagram, weakest first.
 *
 * `owner` is `Diagram.userId` and is never a `DiagramMember` row; `editor` and
 * `viewer` are. The order is total — a check is "at least this role" — so a new
 * role has to be given a rank in `server/access.ts` rather than just a name.
 */
export type DiagramRole = 'owner' | 'editor' | 'viewer';

/** The roles an invitation can grant. Ownership is not transferable today. */
export type DiagramMemberRole = Exclude<DiagramRole, 'owner'>;

/** One entry of `GET /api/diagrams/:id/members` — the owner included, first. */
export interface DiagramMemberInfo {
  userId: string;
  name: string;
  email: string;
  role: DiagramRole;
}

/**
 * `GET /api/shared/:token`: a diagram behind a public link, read with no
 * session at all. Deliberately narrower than the authenticated read — no
 * owner, no members, no `shareToken`, nothing a viewer of the link has not
 * been given.
 */
export interface SharedDiagram {
  id: string;
  title: string;
  data: unknown;
  updatedAt: string;
}

/**
 * One entry of `GET /api/diagrams/:id/versions`: a snapshot's identity, not its
 * contents. The listing is deliberately without `data` — a history panel shows
 * fifty of these, and fifty diagram bodies is megabytes nobody is going to look
 * at. `GET …/versions/:versionId` fetches the one the user picks.
 */
export interface DiagramVersionMeta {
  id: string;
  /** When the snapshot was taken, ISO 8601. */
  createdAt: string;
  /** The diagram's title *in this version*, which a restore puts back. */
  title: string;
  /** `null` on an automatic snapshot; set on a manual one and on 'Before restore'. */
  label: string | null;
  /** Absent when the snapshot has no author left (a deleted account). */
  createdBy?: { name: string };
}

/** A single version with its body, as `GET …/versions/:versionId` returns it. */
export interface DiagramVersion extends DiagramVersionMeta {
  /**
   * `unknown` for the same reason `getDiagram` returns it so: a snapshot may
   * hold any diagram format this app has ever written, and only
   * `migrateDiagramData` may say what it is.
   */
  data: unknown;
}

export interface DiagramMeta {
  id: string;
  title: string;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
  thumbnail: string | null;
  /** What the *listing* user may do with it. Their own diagrams are `owner`. */
  role: DiagramRole;
  /** Who owns it, when that is somebody else. Absent on an owned diagram. */
  ownerName?: string;
}

/** The path a share token is served at. The client route mirrors it. */
export function sharedDiagramPath(token: string): string {
  return `/s/${token}`;
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
