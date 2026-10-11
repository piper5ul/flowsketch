/**
 * The preview line the connector tool draws while a connector is dragged out.
 *
 * It used to be React state on `Canvas`, which re-rendered the whole canvas —
 * and every piece of chrome under it — on every pointer move of the gesture.
 * The draft is now a tiny store of its own that only this component reads, so
 * a move redraws one `<line>`.
 */
import { ViewportPortal } from '@xyflow/react';
import { useStore } from 'zustand';
import type { ConnectorDraftStore } from '../lib/connectorDraft';

export function ConnectorDraftLine({ store }: { store: ConnectorDraftStore }) {
  const draft = useStore(store, (s) => s.draft);
  if (!draft) return null;
  return (
    <ViewportPortal>
      <svg
        aria-hidden="true"
        data-testid="connector-draft"
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        {draft.endArrow && (
          <defs>
            <marker
              id="connector-draft-arrow"
              viewBox="0 0 10 10"
              refX={2}
              refY={5}
              markerWidth={13}
              markerHeight={13}
              orient="auto-start-reverse"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 2.5 0.5 L 9.5 5 L 2.5 9.5 Z"
                fill={draft.stroke}
                stroke={draft.stroke}
                strokeWidth={1}
                strokeLinejoin="round"
              />
            </marker>
          </defs>
        )}
        <line
          x1={draft.from.x}
          y1={draft.from.y}
          x2={draft.to.x}
          y2={draft.to.y}
          stroke={draft.stroke}
          strokeWidth={draft.strokePx}
          strokeLinecap="round"
          markerEnd={draft.endArrow ? 'url(#connector-draft-arrow)' : undefined}
        />
      </svg>
    </ViewportPortal>
  );
}
