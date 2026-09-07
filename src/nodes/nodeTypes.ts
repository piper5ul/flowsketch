import { ShapeNode } from './ShapeNode';
import { GroupNode } from './GroupNode';
import { FrameNode } from './FrameNode';
import { InkNode } from './InkNode';
import { TableNode } from './TableNode';

export const nodeTypes = {
  shape: ShapeNode,
  frame: FrameNode,
  // A grid of editable cells. Not a container — nothing hangs off it — and not
  // a shape: its box is its grid, so it is its own `type`.
  table: TableNode,
  // One freehand pen stroke. A node of its own rather than a shape kind: it is
  // drawn by dragging rather than dropped by clicking, its body is a polyline
  // instead of a silhouette, and it has no label, handles or quick-add.
  ink: InkNode,
  // React Flow ships a `group` type of its own; ours replaces it, so a group is
  // drawn (and not drawn) the way this app means it.
  group: GroupNode,
};
