import { useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { Baseline } from 'lucide-react';
import clsx from 'clsx';
import { isHex6, PALETTE } from '../../lib/palette';
import type { SwatchColor } from '../../types';
import { ChromePopover } from './chrome';
import { ColorGrid } from './ColorGrid';

interface ColorPickerProps {
  target: 'shape' | 'edge' | 'text';
  activeId: string | null;
  triggerColour: string | null;
  onPick: (swatch: SwatchColor) => void;
  onCustom: (hex: string) => void;
  keepEditorFocus?: boolean;
  extra?: ReactNode;
}

export function ColorPicker({
  target,
  activeId,
  triggerColour,
  onPick,
  onCustom,
  keepEditorFocus = false,
  extra,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [colorName, setColorName] = useState<string | null>(null);
  const label = target === 'text' ? 'Text colour' : 'Color';
  const textTarget = target === 'text';
  const displayColour = triggerColour ?? 'linear-gradient(135deg, #fff 0 50%, #8D4BF6 50% 100%)';
  const gridSwatches = target === 'edge' ? PALETTE.map((swatch) => ({ ...swatch, fill: swatch.stroke })) : PALETTE;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setTooltipOpen(false);
      }}
    >
      <RadixTooltip.Root
        delayDuration={250}
        open={tooltipOpen && !open}
        onOpenChange={setTooltipOpen}
      >
        <RadixTooltip.Trigger asChild>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label={label}
              aria-pressed={open}
              data-popover=""
              className="chrome-btn"
            >
              {textTarget ? (
                <>
                  <Baseline size={15} />
                  <span
                    className="absolute bottom-1 h-[3px] w-4 rounded-full"
                    style={{ background: triggerColour ?? 'currentColor' }}
                  />
                </>
              ) : (
                <span
                  className="h-5 w-5 rounded-full shadow-[inset_0_0_0_1px_var(--color-chrome-ring)]"
                  style={{ background: displayColour }}
                />
              )}
            </button>
          </Popover.Trigger>
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side="top"
            sideOffset={6}
            className="panel-in z-50 flex items-center gap-1.5 rounded-md bg-ink-950 px-2 py-1 text-[11px] font-medium text-white shadow-[0_4px_12px_-2px_rgba(10,10,25,0.4)]"
          >
            <span>{label}</span>
            <RadixTooltip.Arrow className="fill-ink-950" width={8} height={4} />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
      <ChromePopover
        label="Colors"
        side="top"
        sideOffset={9}
        keepEditorFocus={keepEditorFocus}
        width={126}
      >
        {colorName !== null && (
          <span className="swatch-name" aria-hidden="true">
            {colorName}
          </span>
        )}
        <div
          className={clsx('flex flex-col items-center', !extra && 'h-28 w-28')}
        >
          {extra && <Popover.Close asChild>{extra}</Popover.Close>}
          <ColorGrid
            label="Colors"
            swatches={gridSwatches}
            activeId={activeId}
            onPick={(swatch) => {
              onPick(swatch);
              setOpen(false);
            }}
            onCustom={onCustom}
            onHoverName={setColorName}
            customValue={isHex6(triggerColour ?? '') ? triggerColour ?? undefined : undefined}
          />
        </div>
      </ChromePopover>
    </Popover.Root>
  );
}
