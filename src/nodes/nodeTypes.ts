import { ShapeNode } from './ShapeNode';
import { GroupNode } from './GroupNode';
import { FrameNode } from './FrameNode';
import { InkNode } from './InkNode';

export const nodeTypes = {
  shape: ShapeNode,
  frame: FrameNode,
  // One freehand pen stroke. A node of its own rather than a shape kind: it is
  // drawn by dragging rather than dropped by clicking, its body is a polyline
  // instead of a silhouette, and it has no label, handles or quick-add.
  ink: InkNode,
  // React Flow ships a `group` type of its own; ours replaces it, so a group is
  // drawn (and not drawn) the way this app means it.
  group: GroupNode,
};
