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
    <RadixTooltip.Root delayDuration={250}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="panel-in z-50 flex items-center gap-1.5 rounded-md bg-ink-950 px-2 py-1 text-[11px] font-medium text-white shadow-[0_4px_12px_-2px_rgba(10,10,25,0.4)]"
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
  return <RadixTooltip.Provider delayDuration={250}>{children}</RadixTooltip.Provider>;
}
