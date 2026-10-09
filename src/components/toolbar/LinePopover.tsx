import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import type { StrokeStyle, StrokeWidth } from '../../types';
import { CONNECTOR_STROKE_PX } from '../../lib/defaults';
import { ChromePopover, Segmented, ToolButton } from './chrome';

const DASH: Record<StrokeStyle, string | undefined> = {
  solid: undefined,
  dashed: '6 3.5',
  dotted: '1 4',
};

function LineSample({ style, width = 2 }: { style?: StrokeStyle; width?: number }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <line x1="2" y1="10" x2="18" y2="10" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeDasharray={style ? DASH[style] : undefined} />
    </svg>
  );
}

export function LinePopover({
  strokeStyle,
  strokeWidth,
  onChange,
}: {
  strokeStyle: StrokeStyle;
  strokeWidth: StrokeWidth;
  onChange: (patch: { strokeStyle?: StrokeStyle; strokeWidth?: StrokeWidth }) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <ToolButton label="Line" popover active={open}>
          <LineSample style={strokeStyle} width={CONNECTOR_STROKE_PX[strokeWidth]} />
        </ToolButton>
      </Popover.Trigger>
      <ChromePopover label="Line" side="top" sideOffset={9} width={110}>
        <div className="line-pop flex flex-col gap-1">
          <Segmented label="Line style" className="line-pop-track">
            {(['solid', 'dashed', 'dotted'] as StrokeStyle[]).map((style) => {
              const label = style[0].toUpperCase() + style.slice(1);
              return (
                <ToolButton key={style} label={label} active={strokeStyle === style} onClick={() => onChange({ strokeStyle: style })}>
                  <LineSample style={style} />
                </ToolButton>
              );
            })}
          </Segmented>
          <Segmented label="Line width" className="line-pop-track">
            {([[1, 'Thin line'], [2, 'Regular line'], [3, 'Bold line']] as const).map(([width, label]) => (
              <ToolButton key={width} label={label} active={strokeWidth === width} onClick={() => onChange({ strokeWidth: width })}>
                <LineSample width={CONNECTOR_STROKE_PX[width]} />
              </ToolButton>
            ))}
          </Segmented>
        </div>
      </ChromePopover>
    </Popover.Root>
  );
}
