import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Shapes } from 'lucide-react';
import { SHAPE_ICONS, SHAPE_LABELS, SWAPPABLE_SHAPE_KINDS } from '../../lib/shapeIcons';
import type { ShapeKind } from '../../types';
import { ChromePopover, ToolButton } from './chrome';

export function ShapePicker({
  current,
  onPick,
}: {
  current: ShapeKind | null;
  onPick: (kind: ShapeKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const TriggerIcon = current ? SHAPE_ICONS[current] : Shapes;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <ToolButton label="Change shape" popover active={open}>
          <TriggerIcon size={16} />
        </ToolButton>
      </Popover.Trigger>
      <ChromePopover label="Shape picker" side="top" sideOffset={9}>
        <div className="grid grid-cols-4 gap-0">
          {SWAPPABLE_SHAPE_KINDS.map((kind) => {
            const Icon = SHAPE_ICONS[kind];
            return (
              <Popover.Close asChild key={kind}>
                <button
                  type="button"
                  aria-label={SHAPE_LABELS[kind]}
                  aria-pressed={current === kind}
                  onClick={() => onPick(kind)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-white/80 transition hover:bg-[var(--color-chrome-hover)] aria-pressed:bg-[var(--color-chrome-selected)]"
                >
                  <Icon size={16} />
                </button>
              </Popover.Close>
            );
          })}
        </div>
      </ChromePopover>
    </Popover.Root>
  );
}
