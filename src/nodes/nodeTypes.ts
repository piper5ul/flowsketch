import { ShapeNode } from './ShapeNode';
import { GroupNode } from './GroupNode';
import { FrameNode } from './FrameNode';

export const nodeTypes = {
  shape: ShapeNode,
  frame: FrameNode,
  // React Flow ships a `group` type of its own; ours replaces it, so a group is
  // drawn (and not drawn) the way this app means it.
  group: GroupNode,
};
