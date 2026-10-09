import { useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { SlidersHorizontal } from 'lucide-react';
import clsx from 'clsx';
import type { ShapeData } from '../../types';
import { ChromePopover, ToolButton } from './chrome';

const CORNER_RADIUS_MAX = 40;
const OPACITY_MIN = 0.1;

function StyleSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onPreview,
  onCommit,
  onDragStart,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  onDragStart: () => void;
}) {
  const dragging = useRef(false);
  return (
    <label className="flex flex-col gap-1 px-1 py-1">
      <span className="flex items-center justify-between text-[11px] font-medium text-[var(--color-chrome-text-muted)]">
        {label}<span className="tabular-nums text-white/80">{format(value)}</span>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => { dragging.current = true; onDragStart(); }}
        onPointerUp={() => { dragging.current = false; }}
        onLostPointerCapture={() => { dragging.current = false; }}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (dragging.current) onPreview(next);
          else onCommit(next);
        }}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-accent-500"
      />
    </label>
  );
}

export function StylePopover({
  cornerRadius,
  opacity,
  shadow,
  showCornerRadius,
  onPreview,
  onCommit,
  onDragStart,
}: {
  cornerRadius: number;
  opacity: number;
  shadow: boolean;
  showCornerRadius: boolean;
  onPreview: (patch: Partial<ShapeData>) => void;
  onCommit: (patch: Partial<ShapeData>) => void;
  onDragStart: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <ToolButton label="Style" popover active={open}>
          <SlidersHorizontal size={16} />
        </ToolButton>
      </Popover.Trigger>
      <ChromePopover label="Style" side="top" sideOffset={9} width={208}>
        <div className="flex flex-col gap-1">
          {showCornerRadius && (
            <StyleSlider
              label="Corner radius" value={cornerRadius} min={0} max={CORNER_RADIUS_MAX} step={1}
              format={(value) => `${value}px`} onDragStart={onDragStart}
              onPreview={(value) => onPreview({ cornerRadius: value })}
              onCommit={(value) => onCommit({ cornerRadius: value })}
            />
          )}
          <StyleSlider
            label="Opacity" value={opacity} min={OPACITY_MIN} max={1} step={0.05}
            format={(value) => `${Math.round(value * 100)}%`} onDragStart={onDragStart}
            onPreview={(value) => onPreview({ opacity: value })}
            onCommit={(value) => onCommit({ opacity: value })}
          />
          <button
            type="button"
            aria-pressed={shadow}
            onClick={() => onCommit({ shadow: !shadow })}
            className={clsx('mt-0.5 flex h-[30px] items-center justify-between rounded-md px-2 text-left text-sm text-white/90 transition hover:bg-[var(--color-chrome-hover)]', shadow && 'bg-[var(--color-chrome-selected)]')}
          >
            Drop shadow<span className="text-xs text-[var(--color-chrome-text-muted)]">{shadow ? 'On' : 'Off'}</span>
          </button>
        </div>
      </ChromePopover>
    </Popover.Root>
  );
}
