import { useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { ShapeNode as ShapeNodeType } from '../store/useDiagramStore';

/**
 * A group: an invisible box that makes the shapes inside it move as one.
 *
 * It draws nothing at all until you are pointing at it or it is selected, and
 * then only a dashed outline — a group is a way of handling shapes, not a mark
 * on the diagram, and anything more would be a second rectangle the user did
 * not draw. That is also why it needs no exclusion from the image export: with
 * the selection cleared for the capture, there is nothing there to capture.
 *
 * No label, no connector handles, no quick-add: a connector belongs to a shape,
 * and a group is not one. What it does have is a body — the margin around its
 * contents — which is what the user grabs to drag the whole thing.
 */
export function GroupNode({ selected }: NodeProps<ShapeNodeType>) {
  const [hovered, setHovered] = useState(false);
  const outlined = selected || hovered;

  return (
    <div
      data-node-type="group"
      className="h-full w-full rounded-lg"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        // An outline rather than a border: it is drawn outside the box, so the
        // group's contents sit exactly where they were put.
        outline: outlined ? '1.5px dashed var(--color-accent-500)' : undefined,
        outlineOffset: 2,
        opacity: selected ? 1 : hovered ? 0.6 : undefined,
      }}
    />
  );
}
