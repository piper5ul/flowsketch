import { useMemo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import clsx from 'clsx';
import type { ShapeNode as ShapeNodeType } from '../store/useDiagramStore';
import { peerOutlineStyle, usePeerSelection } from '../store/useCollabStore';
import { HIGHLIGHTER_OPACITY, inkBounds, inkPath } from '../lib/ink';

/**
 * One freehand stroke.
 *
 * The whole node is a single `<path>` in an `<svg>` filling it, and the two
 * pens differ only in what they hand that path: a marker is the colour at full
 * strength with a round cap, a highlighter the same colour at
 * `HIGHLIGHTER_OPACITY` with a square one — a real highlighter has a chisel tip
 * and leaves a squared-off end.
 *
 * **The stroke scales with the node.** The `viewBox` is the box the points were
 * captured in and the `<svg>` is sized by the node, so dragging a corner
 * redraws the same curve larger — deliberately *without*
 * `vectorEffect="non-scaling-stroke"`, which is what a connector wants (a line
 * between two shapes keeps its weight when they move apart) and what a drawing
 * does not: a scaled-up scribble drawn with a hairline would look like a
 * different pen. Nothing is rewritten on resize, so there is no commit to make
 * and no history entry to push.
 *
 * No label, no text editing, no handles and no quick-add: a stroke is a mark,
 * not a shape, and a connector belongs to a shape.
 */
export function InkNode({ id, data, selected, parentId }: NodeProps<ShapeNodeType>) {
  // The collaborator holding this stroke, if anyone is — the same outline every
  // other node wears, in their own colour.
  const peerSelection = usePeerSelection(id);
  const ink = data.ink;

  // The box these points were captured in: `inkBounds` of an already-normalised
  // stroke is that stroke's natural size, which is what the `viewBox` needs —
  // the node's own width and height are whatever it has since been resized to.
  const natural = useMemo(
    () => (ink ? inkBounds(ink.points, ink.width) : null),
    [ink],
  );
  const d = useMemo(() => (ink ? inkPath(ink.points) : ''), [ink]);

  // `Diagram.data` is free-form JSON and the document is written by other
  // browsers: a node typed `ink` with nothing to draw is possible, and drawing
  // nothing is the right answer to it.
  if (!ink || !natural || !d) return null;

  const highlighter = ink.kind === 'highlighter';

  return (
    <div
      data-node-type="ink"
      data-ink-kind={ink.kind}
      data-parent-id={parentId}
      data-peer-selected={peerSelection?.name}
      className={clsx('relative h-full w-full', selected && 'is-selected')}
      style={{
        opacity: data.opacity,
        // An outline rather than a ring inside the box, as a group's is: it is
        // drawn outside, so the stroke keeps exactly the room it was given.
        ...(selected ? { outline: '1.5px solid var(--color-accent-500)', outlineOffset: 2 } : {}),
        ...peerOutlineStyle(peerSelection),
      }}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${natural.width} ${natural.height}`}
        preserveAspectRatio="none"
        overflow="visible"
      >
        <path
          d={d}
          fill="none"
          stroke={data.stroke}
          strokeWidth={ink.width}
          strokeOpacity={highlighter ? HIGHLIGHTER_OPACITY : undefined}
          strokeLinecap={highlighter ? 'square' : 'round'}
          strokeLinejoin="round"
        />
      </svg>

      <NodeResizer
        isVisible={!!selected && !data.locked}
        minWidth={8}
        minHeight={8}
        lineStyle={{ borderColor: 'transparent', borderWidth: 6 }}
        handleStyle={{
          width: 0,
          height: 0,
          opacity: 0,
          border: 'none',
          background: 'transparent',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
