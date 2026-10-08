import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

interface TooltipProps {
  label: string;
  shortcut?: string;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

export function Tooltip({ label, shortcut, children, side = 'right' }: TooltipProps) {
  return (
    <RadixTooltip.Root delayDuration={250} disableHoverableContent>
      {/* aria-label merges onto the child, so icon-only buttons get an accessible
          name for free; a child's own aria-label takes precedence. */}
      <RadixTooltip.Trigger asChild aria-label={label}>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          // A tooltip is a label, never a target: it can open over a neighbour
          // (a swatch's name sits on the row of swatches above it), and a click
          // meant for that neighbour has to reach it.
          className="app-tooltip panel-in pointer-events-none z-50 flex items-center gap-1.5 rounded-md bg-ink-950 px-2 py-1 text-[11px] font-medium text-white shadow-[0_4px_12px_-2px_rgba(10,10,25,0.4)]"
        >
          <span>{label}</span>
          {shortcut && (
            <span className="rounded bg-white/10 px-1 py-px text-[10px] font-semibold text-white/60">
              {shortcut}
            </span>
          )}
          <RadixTooltip.Arrow className="fill-ink-950" width={8} height={4} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider delayDuration={250} disableHoverableContent>{children}</RadixTooltip.Provider>;
}
