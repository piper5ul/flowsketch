import { ShapeNode } from './ShapeNode';
import { GroupNode } from './GroupNode';

export const nodeTypes = {
  shape: ShapeNode,
  // React Flow ships a `group` type of its own; ours replaces it, so a group is
  // drawn (and not drawn) the way this app means it.
  group: GroupNode,
};
