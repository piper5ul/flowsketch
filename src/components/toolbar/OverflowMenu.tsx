import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { detectPlatform } from '../../commands/registry';
import type { CommandContext } from '../../commands/types';
import { EDGE_OVERFLOW, NODE_OVERFLOW, resolveOverflow } from '../../lib/overflowMenu';
import { registry } from '../../commands/commands';
import { ToolButton } from './chrome';

const ROW = 'flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-sm font-normal text-white outline-none data-[highlighted]:bg-[var(--color-chrome-hover)] disabled:opacity-40';

function ShortcutChips({ chips }: { chips: string[] }) {
  if (!chips.length) return null;
  return (
    <span aria-hidden="true" className="ml-auto flex items-center gap-[3px]">
      {chips.map((chip, index) => (
        <kbd key={`${chip}-${index}`} className="flex h-5 min-w-5 items-center justify-center rounded bg-[var(--color-chrome-track)] px-[5px] text-xs font-medium leading-none text-[var(--color-chrome-text-muted)]">
          {chip}
        </kbd>
      ))}
    </span>
  );
}

export function OverflowMenu({
  ctx,
  target,
  onRun,
}: {
  ctx: CommandContext;
  target: 'node' | 'edge';
  onRun: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const sections = resolveOverflow(target === 'edge' ? EDGE_OVERFLOW : NODE_OVERFLOW, registry, ctx, detectPlatform());

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <ToolButton label="More actions" popover active={open}>
          <MoreHorizontal size={16} />
        </ToolButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side="bottom"
          sideOffset={9}
          aria-label="More actions"
          className="chrome-pop z-50 flex flex-col"
          style={{ width: 272, padding: 6 }}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          {sections.map((section, sectionIndex) => {
            const hasChecks = section.some((entry) => entry.kind === 'item' && entry.checked !== undefined);
            return (
              <div key={sectionIndex} className={sectionIndex > 0 ? 'mt-1 border-t border-[var(--color-chrome-ring)] pt-1' : ''}>
                {section.map((entry) => {
                  if (entry.kind === 'submenu') {
                    const childHasChecks = entry.items.some((item) => item.kind === 'item' && item.checked !== undefined);
                    return (
                      <DropdownMenu.Sub key={entry.title}>
                        <DropdownMenu.SubTrigger className={`${ROW} overflow-subtrigger relative`}>
                          {hasChecks && <span aria-hidden="true" className="flex h-5 w-5 flex-none" />}
                          <span className="flex-1">{entry.title}</span>
                          <ChevronRight size={16} className="text-[var(--color-chrome-text-muted)]" />
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.SubContent
                            className="chrome-pop overflow-submenu z-50 flex flex-col"
                            style={{ width: 240, padding: 6 }}
                            sideOffset={4}
                          >
                            {entry.items.map((item, index) => item.kind === 'sep' ? (
                              <DropdownMenu.Separator key={`sep-${index}`} className="my-1 h-px bg-[var(--color-chrome-ring)]" />
                            ) : (
                              <OverflowItem key={item.id} item={item} onRun={onRun} reserveCheck={childHasChecks} />
                            ))}
                          </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Sub>
                    );
                  }
                  return <OverflowItem key={entry.id} item={entry} onRun={onRun} reserveCheck={hasChecks} />;
                })}
              </div>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function OverflowItem({
  item,
  onRun,
  reserveCheck,
}: {
  item: { id: string; title: string; chips: string[]; enabled: boolean; checked?: boolean };
  onRun: (id: string) => void;
  reserveCheck: boolean;
}) {
  const leading = reserveCheck ? (
    <span className="flex h-5 w-5 flex-none items-center justify-center">
      {item.checked && <Check size={16} />}
    </span>
  ) : null;

  if (item.checked !== undefined) {
    return (
      <DropdownMenu.CheckboxItem
        className={ROW}
        checked={item.checked}
        disabled={!item.enabled}
        onSelect={() => onRun(item.id)}
      >
        {leading}
        <span className="flex-1">{item.title}</span>
        <ShortcutChips chips={item.chips} />
      </DropdownMenu.CheckboxItem>
    );
  }

  return (
    <DropdownMenu.Item
      className={ROW}
      disabled={!item.enabled}
      onSelect={() => onRun(item.id)}
    >
      {leading}
      <span className="flex-1">{item.title}</span>
      <ShortcutChips chips={item.chips} />
    </DropdownMenu.Item>
  );
}
