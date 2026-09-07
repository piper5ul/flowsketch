/**
 * ⌥-hover measuring: with one shape selected, holding ⌥ and pointing at another
 * draws the gap between them with its size in px — Whimsical's "Measure
 * distance between objects". Drawn through `ViewportPortal` so it pans and
 * zooms with the board (and is on the export exclusion list for that reason).
 */
import { ViewportPortal } from '@xyflow/react';
import { useMemo } from 'react';
import { useDiagramStore } from '../store/useDiagramStore';
import { boardRect } from '../lib/connectorGesture';
import { measureGaps } from '../lib/measure';

export function MeasureOverlay({ fromId, toId }: { fromId: string; toId: string }) {
  const nodes = useDiagramStore((s) => s.nodes);
  const gaps = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    const a = byId.get(fromId);
    const b = byId.get(toId);
    const ra = a && boardRect(a, byId);
    const rb = b && boardRect(b, byId);
    return ra && rb ? measureGaps(ra, rb) : [];
  }, [nodes, fromId, toId]);

  if (gaps.length === 0) return null;
  return (
    <ViewportPortal>
      <svg
        className="measure-overlay"
        data-testid="measure"
        aria-hidden="true"
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        {gaps.map((g, i) => (
          <g key={i}>
            <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="var(--color-accent-500)" strokeWidth={1.5} strokeDasharray="4 3" />
            <rect
              x={(g.x1 + g.x2) / 2 - 18}
              y={(g.y1 + g.y2) / 2 - 9}
              width={36}
              height={18}
              rx={4}
              fill="var(--color-accent-500)"
            />
            <text
              x={(g.x1 + g.x2) / 2}
              y={(g.y1 + g.y2) / 2 + 4}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill="#fff"
            >
              {g.label}
            </text>
          </g>
        ))}
      </svg>
    </ViewportPortal>
  );
}
