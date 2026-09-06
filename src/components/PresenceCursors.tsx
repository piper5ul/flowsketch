/**
 * Other people's pointers, drawn on the board where they are.
 *
 * Rendered through `ViewportPortal` for the same reason comment pins are: a
 * cursor lives inside `.react-flow__viewport` and is panned and zoomed by the
 * same transform as the shapes, so a peer's cursor stays on the shape they are
 * pointing at however either window is framed. Positions travel in flow
 * coordinates precisely so that this works.
 *
 * And, like a pin, being inside the viewport means being inside what the image
 * export captures — hence `presence-cursor`, which is on the export's exclusion
 * list. Who was looking at the diagram is not part of the diagram.
 */
import { ViewportPortal } from '@xyflow/react';
import { useCollabStore } from '../store/useCollabStore';

export function PresenceCursors() {
  const peers = useCollabStore((s) => s.peers);

  return (
    <ViewportPortal>
      {peers.map((peer) => {
        // Nothing to draw for someone whose pointer is not on the canvas. They
        // are still in the "who's here" strip: present, just not pointing.
        if (!peer.cursor) return null;
        return (
          <div
            key={peer.clientId}
            className="presence-cursor"
            // The colour is a custom property rather than `color`, so both the
            // arrow and the chip can reach it: a chip that set its own `color`
            // for its white text would otherwise take `currentColor` from
            // itself and paint its background white too.
            style={
              {
                left: peer.cursor.x,
                top: peer.cursor.y,
                '--peer-color': peer.color,
              } as React.CSSProperties
            }
            // Not `role="img"`: this is a live report of where somebody is, and
            // a screen reader is told who rather than shown an arrow.
            aria-label={`${peer.name}'s cursor`}
          >
            {/* The arrow, filled with the peer's colour through `currentColor`
                so the chip below and the pointer above can never disagree. */}
            <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
              <path
                d="M1 1 L1 14.5 L4.7 11.2 L7.2 16.6 L9.9 15.3 L7.4 10.1 L12.3 9.6 Z"
                fill="currentColor"
                stroke="#fff"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span className="presence-cursor__name">{peer.name}</span>
          </div>
        );
      })}
    </ViewportPortal>
  );
}
