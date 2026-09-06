export interface DiagramData {
  nodes: SerializedNode[];
  edges: SerializedEdge[];
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
  updatedAt: string;
  thumbnail: string | null;
}
