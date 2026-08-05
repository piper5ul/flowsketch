import { useStore } from '@xyflow/react';
import { useDiagramStore, type GuideLine } from '../store/useDiagramStore';

export function AlignmentGuides() {
  const guides = useDiagramStore((s) => s.guides);
  const transform = useStore((s) => s.transform);

  if (guides.length === 0) return null;

  const [tx, ty, zoom] = transform;
  const deduped = dedupeGuides(guides);

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[9999] h-full w-full overflow-visible"
    >
      <g transform={`translate(${tx}, ${ty}) scale(${zoom})`}>
        {deduped.map((g, i) =>
          g.axis === 'x' ? (
            <line key={i} x1={g.pos} y1={g.from} x2={g.pos} y2={g.to} className="alignment-guide" />
          ) : (
            <line key={i} x1={g.from} y1={g.pos} x2={g.to} y2={g.pos} className="alignment-guide" />
          ),
        )}
      </g>
    </svg>
  );
}

function dedupeGuides(guides: GuideLine[]): GuideLine[] {
  const seen = new Set<string>();
  return guides.filter((g) => {
    const key = `${g.axis}:${Math.round(g.pos)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
