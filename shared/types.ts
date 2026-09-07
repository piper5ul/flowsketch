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
  /**
   * The style new elements are drawn in **on this board** — what ⌘⇧D saves.
   *
   * Absent on every diagram saved before board defaults existed, and on one
   * nobody has set a default on, which is why it needed no version bump: an
   * absent field means "no board defaults" and the built-in ones apply, exactly
   * as they always did. The values are style keys and only style keys —
   * `src/lib/defaultStyle.ts` holds the whitelist, and is the one place a
   * stored `defaults` is narrowed before anything acts on it.
   */
  defaults?: DiagramDefaults;
  /**
   * The shapes that stand for this board on the dashboard card — what "Set as
   * board thumbnail" saves.
   *
   * Absent means **automatic**: the card shows a picture of the whole board,
   * which is what every diagram written before this existed already wants, so
   * it needed no version bump either. The ids name nodes in `nodes`, but
   * nothing enforces that — a shape can be deleted while its id is still here,
   * and the renderer falls back to the whole board rather than to nothing.
   * `src/lib/boardThumbnail.ts` is the one place a stored value is narrowed.
   */
  thumbnailNodeIds?: string[];
  /**
   * The round of dot voting the board is in, if it is in one.
   *
   * Absent means **no round has ever been run here**, which is what every
   * diagram written before voting existed already wants, so this needed no
   * version bump either. The dots themselves are node data
   * (`ShapeData.votes`); this is the round they were cast in.
   * `src/lib/voting.ts` is the one place a stored value is narrowed.
   */
  voting?: VotingSession;
  /**
   * The shared countdown, if one is running.
   *
   * An **end time**, never a number of seconds left: every window computes the
   * remaining time from its own clock, so nothing has to tick through the
   * document. Absent means no timer, which again is every older diagram.
   * `src/lib/timer.ts` is where a stored value is narrowed.
   */
  timer?: BoardTimer;
}

/**
 * A round of dot voting on the board — Whimsical's "voting on sticky notes".
 *
 * A property of the *board* rather than of the window it was started in, which
 * is why it rides in the collaborative document's `meta` map beside `defaults`
 * and `thumbnailNodeIds` and is read back out of it: everybody on the board is
 * in the same round, with the same budget, seeing the totals at the same
 * moment.
 *
 * `active` and `revealed` are two questions rather than one state, because a
 * round has three of them: open with the totals hidden (`active`), closed with
 * them shown (`revealed`), and — after "Clear votes" — neither.
 */
export interface VotingSession {
  /** Whether dots can still be placed. */
  active: boolean;
  /** How many dots each person gets, across the whole board. */
  dotsPerPerson: number;
  /** Whether the totals are shown. Until then a voter sees only their own dots. */
  revealed: boolean;
  /** Who opened the round. Recorded, not enforced: anyone on the board may close it. */
  startedById: string;
}

/** The board's shared countdown. See `src/lib/timer.ts` for why it is an end time. */
export interface BoardTimer {
  /** When it runs out, ISO 8601. */
  endsAt: string;
  /** Who started it. Anyone on the board may stop it. */
  startedById: string;
  /** What it is for, if whoever started it said. */
  label?: string;
}

/**
 * Board defaults as the JSON column holds them: one loose bag per kind.
 *
 * Deliberately not typed as `Partial<ShapeData>` here — `shared/` describes the
 * wire format and knows nothing about the client's shape types, the same reason
 * `SerializedNode.data` is a `Record`. `sanitizeDefaults` is what turns one of
 * these into something typed.
 */
export interface DiagramDefaults {
  shape?: Record<string, unknown>;
  sticky?: Record<string, unknown>;
  text?: Record<string, unknown>;
  connector?: Record<string, unknown>;
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
  /**
   * Relative to the node's parent when it has one — a container moves what is
   * inside it, so a child's position is an offset, not a place on the board.
   */
  position: { x: number; y: number };
  width?: number;
  height?: number;
  /**
   * The group or frame this node belongs to. A parent is always written before
   * its children, which is the order React Flow has to read them in.
   */
  parentId?: string;
  /** React Flow's containment rule for a child, when one has been set. */
  extent?: 'parent' | [[number, number], [number, number]];
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

/**
 * The person a comment or thread is attributed to. Deliberately not the
 * member shape: an address is what you type to *invite* somebody, and there is
 * no reason for a viewer reading a discussion to be handed everyone's email.
 */
export interface CommentAuthor {
  id: string;
  name: string;
}

/** One message in a thread, as the API returns it. */
export interface CommentInfo {
  id: string;
  body: string;
  /** ISO 8601. */
  createdAt: string;
  /** `null` until the author rewrites it; the UI shows "edited" when set. */
  editedAt: string | null;
  author: CommentAuthor;
}

/**
 * One conversation pinned to a diagram, with every comment in it.
 *
 * A thread is anchored either to a shape (`nodeId`) or to a canvas position
 * (`x`+`y`) — never both, never neither. The other pair is `null`, so a client
 * decides how to draw the pin by asking which one is set.
 *
 * `comments` is never empty: creating a thread posts its first comment, and
 * deleting the last comment deletes the thread with it.
 */
export interface CommentThreadInfo {
  id: string;
  /** The node the pin is attached to, or `null` on a positioned thread. */
  nodeId: string | null;
  /** Diagram coordinates, or `null` on a node-anchored thread. */
  x: number | null;
  y: number | null;
  resolved: boolean;
  /** ISO 8601. */
  createdAt: string;
  createdBy: CommentAuthor;
  /** Oldest first, as the conversation reads. */
  comments: CommentInfo[];
}

/** What `GET /api/diagrams/:id/threads` may be asked for. Default `open`. */
export type CommentThreadFilter = 'all' | 'open' | 'resolved';

/** Ceiling on a comment body, in characters. Shared so the client can count too. */
export const MAX_COMMENT_CHARS = 4000;

/**
 * One of the caller's own folders, as `GET /api/folders` lists them.
 *
 * `diagramCount` is what the sidebar shows next to the name, and it counts
 * *the owner's* diagrams: a folder is personal filing, so nothing anyone else
 * owns is ever in one.
 */
export interface FolderInfo {
  id: string;
  name: string;
  /** ISO 8601. The listing is oldest first, which is this ascending. */
  createdAt: string;
  diagramCount: number;
}

/** Ceiling on a folder name. A label on a drawer, not a sentence. */
export const MAX_FOLDER_NAME_CHARS = 80;

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
  /**
   * The folder it is filed in, or `null` for the root of the dashboard.
   *
   * Only ever set on a diagram the caller *owns*: folders are personal, so a
   * diagram somebody shared with this user reads `null` here however its owner
   * has filed it.
   */
  folderId: string | null;
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
