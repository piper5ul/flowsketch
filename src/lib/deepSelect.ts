/**
 * Deep select: ⌘-click (Ctrl elsewhere) reaching *inside* a group.
 *
 * A group is a way of handling shapes, and the two gestures it needs are in
 * tension: picking the whole thing, and picking one member of it without
 * taking the group apart. Whimsical settles that with ⌘-click, and so does
 * this — but ⌘ is already React Flow's `multiSelectionKeyCode` here (the
 * default is `Meta` on a Mac and `Control` everywhere else, and `Canvas` does
 * not override it), so the two meanings have to be told apart rather than one
 * replacing the other.
 *
 * **The rule**: a ⌘-click deep-selects the node it landed on — and *only* that
 * node — when the node lives in a group and nothing is selected but that
 * node's own ancestors. Anything else selected means the user is building a
 * multi-selection, which is what ⌘ has always meant here, so this stands down
 * and React Flow's toggle is left as it was.
 *
 * That reads as: click the group, ⌘-click the member you meant. It cannot
 * shadow the multi-select toggle, because the moment a second thing is
 * selected the answer is `null`.
 *
 * Structural and pure like `arrange.ts` and `nodeTree.ts`: ids, parents and
 * which of them is selected, never the store.
 */

import { isGroupNode } from './nodeKinds';

/** Just enough of a node to decide what a click on it selects. */
export interface DeepSelectNode {
  id: string;
  type?: string;
  parentId?: string;
  selected?: boolean;
}

/**
 * The modifier flags of the click, named as `MouseEvent` names them so the
 * event itself can be handed straight over.
 */
export interface ClickModifiers {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * The id a click should leave selected on its own, or `null` to leave the
 * click to React Flow.
 *
 * `connectorSelected` is the one thing this cannot read off `nodes`: a
 * selected connector is a selection like any other, and ⌘-clicking a shape
 * while one is selected is a multi-selection rather than a drill-in — so the
 * caller passes it rather than this quietly clearing it.
 */
export function deepSelectTarget(
  nodes: readonly DeepSelectNode[],
  clickedId: string,
  modifiers: ClickModifiers,
  connectorSelected = false,
): string | null {
  // ⌘ alone. ⇧ is React Flow's selection key and ⌥ is the measure gesture;
  // neither has ever meant "reach inside", and claiming them here would take a
  // combination away from something that already uses it.
  if (!(modifiers.metaKey || modifiers.ctrlKey)) return null;
  if (modifiers.shiftKey || modifiers.altKey) return null;
  if (connectorSelected) return null;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const clicked = byId.get(clickedId);
  if (!clicked) return null;

  const ancestors = ancestorIds(clicked, byId);
  // A shape sitting on the board — or only inside a frame — is not something a
  // click has to reach into: clicking it already selects it, and ⌘ keeps its
  // multi-select meaning there. A frame is part of the drawing and its
  // contents are selected by clicking them; a group is the box that is not.
  if (!hasGroupAncestor(ancestors, byId)) return null;

  // Nothing selected but this node's own containers. A selected sibling, or
  // any shape from elsewhere on the board, means a multi-selection is being
  // built and this stands down.
  for (const node of nodes) {
    if (!node.selected || node.id === clickedId) continue;
    if (!ancestors.has(node.id)) return null;
  }

  return clickedId;
}

/**
 * Every container `node` hangs off, however deep. Stops on a cycle rather than
 * spinning — stored JSON can express one, exactly as `absolutePosition` has to
 * survive meeting one.
 */
function ancestorIds(node: DeepSelectNode, byId: ReadonlyMap<string, DeepSelectNode>): Set<string> {
  const out = new Set<string>();
  let parentId = node.parentId;
  while (parentId !== undefined && !out.has(parentId) && parentId !== node.id) {
    out.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  return out;
}

function hasGroupAncestor(ancestors: ReadonlySet<string>, byId: ReadonlyMap<string, DeepSelectNode>): boolean {
  for (const id of ancestors) {
    const node = byId.get(id);
    if (node && isGroupNode(node)) return true;
  }
  return false;
}
