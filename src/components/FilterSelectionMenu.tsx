/**
 * "Filter selection": narrow a multi-selection to the shapes that share a
 * kind or a colour, so a sweep-select can become "every sticky" or "every
 * yellow thing" in one click and then be moved or restyled together.
 * Offered only while more than one shape is selected; the options are what is
 * actually in the selection (`filterOptions`), each with its count.
 */
import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Filter } from 'lucide-react';
import { useDiagramStore } from '../store/useDiagramStore';
import { filterOptions, isWireFilterKind, narrowedIds, wireComponentOfFilterKind } from '../lib/selectionFilter';
import type { FilterKind } from '../lib/selectionFilter';
import { SHAPE_ICONS, SHAPE_LABELS } from '../lib/shapeIcons';
import { WIRE_ICONS } from '../lib/wireIcons';
import { WIRE_LABELS } from '../lib/wireframe';
import { ChromePopover, ToolButton } from './toolbar/chrome';

/**
 * The icon and the name a bucket wears. Two tables rather than one, because a
 * wireframe component is not a shape kind — see `FilterKind`.
 */
function faceOf(kind: FilterKind): { Icon: React.ComponentType<{ size?: number }>; label: string } {
  if (isWireFilterKind(kind)) {
    const component = wireComponentOfFilterKind(kind);
    return { Icon: WIRE_ICONS[component], label: WIRE_LABELS[component] };
  }
  return { Icon: SHAPE_ICONS[kind], label: SHAPE_LABELS[kind] };
}

export function FilterSelectionMenu() {
  const [open, setOpen] = useState(false);
  const nodes = useDiagramStore((s) => s.nodes);
  const narrowSelection = useDiagramStore((s) => s.narrowSelection);
  const options = useMemo(() => filterOptions(nodes), [nodes]);

  const pick = (filter: Parameters<typeof narrowedIds>[1]) => {
    narrowSelection(narrowedIds(nodes, filter));
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <ToolButton label="Filter selection" popover active={open}>
          <Filter size={16} />
        </ToolButton>
      </Popover.Trigger>
      <ChromePopover label="Filter selection" side="bottom" sideOffset={9} width={224}>
        <div className="flex flex-col gap-2">
          <section>
            <h3 className="px-1 pb-1 text-[11px] font-medium text-white/50">By shape</h3>
            <ul className="flex flex-col">
              {options.shapes.map(({ value, count }) => {
                const { Icon, label } = faceOf(value);
                return (
                  <li key={value}>
                    <button
                      onClick={() => pick({ shape: value })}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-white/85 hover:bg-[var(--color-chrome-hover)]"
                    >
                      <Icon size={14} />
                      <span className="flex-1 text-left">{label}</span>
                      <span className="text-[11px] text-white/50">{count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          {options.fills.length > 0 && (
            <section>
              <h3 className="px-1 pb-1 text-[11px] font-medium text-white/50">By colour</h3>
              <div className="flex flex-wrap gap-1.5 px-1">
                {options.fills.map(({ value, count }) => (
                  <button
                    key={value}
                    aria-label={`Colour ${value} (${count})`}
                    title={`${count}`}
                    onClick={() => pick({ fill: value })}
                    className="relative h-6 w-6 rounded-md ring-1 ring-[var(--color-chrome-ring)] transition hover:scale-110"
                    style={{ backgroundColor: value }}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </ChromePopover>
    </Popover.Root>
  );
}
