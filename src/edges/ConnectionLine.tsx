import { useMemo } from 'react';
import type { ConnectionLineComponentProps } from '@xyflow/react';
import { useDiagramStore } from '../store/useDiagramStore';
import { CONNECTOR_STROKE_PX } from '../lib/defaults';

export function ConnectionLine({ fromX, fromY, toX, toY }: ConnectionLineComponentProps) {
  const newConnectorData = useDiagramStore((s) => s.newConnectorData);
  const style = useMemo(() => {
    const cd = newConnectorData();
    return {
      stroke: cd.stroke ?? '#788896',
      strokePx: CONNECTOR_STROKE_PX[cd.strokeWidth ?? 2],
      endArrow: (cd.endArrowStyle ?? 'arrow') !== 'none',
    };
  }, [newConnectorData]);

  return (
    <g>
      {style.endArrow && (
        <defs>
          <marker
            id="connection-line-arrow"
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
              fill={style.stroke}
              stroke={style.stroke}
              strokeWidth={1}
              strokeLinejoin="round"
            />
          </marker>
        </defs>
      )}
      <line
        x1={fromX}
        y1={fromY}
        x2={toX}
        y2={toY}
        stroke={style.stroke}
        strokeWidth={style.strokePx}
        strokeLinecap="round"
        markerEnd={style.endArrow ? 'url(#connection-line-arrow)' : undefined}
      />
    </g>
  );
}
