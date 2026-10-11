import { useEffect, useRef } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Direction } from '../types';
import { useDiagramStore } from '../store/useDiagramStore';
import { isDotClick } from '../lib/connectorGesture';

/**
 * How far each handle's box is pushed past the border (CSS `top`/`right`/…, so
 * it places the box's outer edge, not its centre). A dot that quick-adds is
 * centred 8 px clear of the border, where Whimsical puts it: its 28 px box
 * (`.shape-handle-outer`) reaches 6 px back over the shape, so the pointer never
 * crosses a gap on the way out to it. One that only connects keeps the old
 * 20 px box on the border, which is where a mind-map node's fold button does
 * not reach.
 */
const OUTER = 8 + 28 / 2;
const INNER = 5;

const SIDES: { id: Direction; position: Position; style: (offset: number) => React.CSSProperties }[] = [
  { id: 'top', position: Position.Top, style: (o) => ({ top: -o, left: '50%', transform: 'translateX(-50%)' }) },
  { id: 'right', position: Position.Right, style: (o) => ({ right: -o, top: '50%', transform: 'translateY(-50%)' }) },
  { id: 'bottom', position: Position.Bottom, style: (o) => ({ bottom: -o, left: '50%', transform: 'translateX(-50%)' }) },
  { id: 'left', position: Position.Left, style: (o) => ({ left: -o, top: '50%', transform: 'translateY(-50%)' }) },
];

/**
 * The four dots a hovered shape offers — **one per side, and each is two
 * gestures**. Pressing and dragging is React Flow's own connection from that
 * handle, so `onConnect` / `onConnectEnd` in `Canvas` pin it or leave it free
 * exactly as they always have; a click that never travelled is quick-add
 * (`addConnectedShape`), offered only when the caller says `quickAdd` — which
 * is `canQuickAddFrom`, the predicate the ⌥+arrow keys are gated on too.
 *
 * Every press is exactly one of the two. The furthest the pointer got from the
 * press is tracked until the release, and `isDotClick` asks it the question
 * React Flow asks of `connectionDragThreshold` — so a drag that came back to
 * the dot is still only a drag. `connectOnClick` is off on the canvas, or a
 * click would also begin React Flow's click-to-connect. With the connector tool
 * held a click is not quick-add either: it falls through to the shape, to the
 * tool's own click-click flow, the way a dot that only connects always has.
 *
 * `isConnectable` is the node's NodeProp, and it has to be passed through:
 * React Flow's `Handle` defaults it to `true` whatever `nodesConnectable`
 * says, and its `.connectable` class is what `index.css` shows a dot for — so
 * this is what keeps a read-only board and a presentation free of dots, and of
 * "Add shape" buttons in the accessibility tree.
 *
 * A quick-add dot is a button to the keyboard as well, and focusing it reveals
 * it (`.shape-handle:focus-visible` in `index.css`); a dot that only connects
 * is a pointer gesture and stays out of the tab order, as handles always were.
 */
export function SideHandles({
  nodeId,
  isConnectable,
  quickAdd = false,
}: {
  nodeId: string;
  isConnectable: boolean;
  quickAdd?: boolean;
}) {
  const addConnectedShape = useDiagramStore((s) => s.addConnectedShape);
  // The furthest the pointer has been from the current press, or `null` when
  // there is no press to speak of.
  const travelRef = useRef<number | null>(null);
  const offersQuickAdd = quickAdd && isConnectable;
  const offset = quickAdd ? OUTER : INNER;

  // Removes the current press's listeners. A release outside the window (the
  // user switched apps mid-press) never reaches `mouseup`, so the next press,
  // the window losing focus and unmounting all end the press too — otherwise a
  // stale listener would measure the next gesture from the old press.
  const endPressRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endPressRef.current?.(), []);

  const onMouseDown = (e: React.MouseEvent) => {
    endPressRef.current?.();
    const from = { x: e.clientX, y: e.clientY };
    travelRef.current = 0;
    const onMove = (m: MouseEvent) => {
      const d = Math.hypot(m.clientX - from.x, m.clientY - from.y);
      if (travelRef.current !== null && d > travelRef.current) travelRef.current = d;
    };
    const end = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('blur', end);
      if (endPressRef.current === end) endPressRef.current = null;
    };
    endPressRef.current = end;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', end);
    window.addEventListener('blur', end);
  };

  return SIDES.map((side) => (
    <Handle
      key={side.id}
      id={side.id}
      type="source"
      position={side.position}
      isConnectable={isConnectable}
      className={quickAdd ? 'shape-handle shape-handle-outer' : 'shape-handle'}
      style={side.style(offset)}
      {...(offersQuickAdd && {
        role: 'button',
        tabIndex: 0,
        'aria-label': `Add shape ${side.id}`,
        onMouseDown,
        onClick: (e: React.MouseEvent) => {
          const travel = travelRef.current;
          travelRef.current = null;
          if (useDiagramStore.getState().tool === 'connector') return;
          // A click on the dot is not a click on the shape: it must not select it.
          e.stopPropagation();
          if (travel !== null && !isDotClick(travel)) return;
          addConnectedShape(nodeId, side.id);
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          // Kept from the canvas, where Enter would open the label.
          e.preventDefault();
          e.stopPropagation();
          addConnectedShape(nodeId, side.id);
        },
      })}
    />
  ));
}
