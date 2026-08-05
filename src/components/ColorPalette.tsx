import * as Popover from '@radix-ui/react-popover';
import clsx from 'clsx';
import { PALETTE, COLS } from '../lib/palette';
import { Tooltip } from './Tooltip';
import type { SwatchColor } from '../types';

interface ColorPaletteProps {
  activeStroke: string;
  onSelect: (swatch: SwatchColor) => void;
  swatchClassName?: string;
}

export function ColorPalette({ activeStroke, onSelect, swatchClassName }: ColorPaletteProps) {
  return (
    <Popover.Root>
      <Tooltip label="Color">
        <Popover.Trigger asChild>
          <button
            className={clsx(
              'flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/10',
              swatchClassName,
            )}
          >
            <span
              className="h-4 w-4 rounded-full border-2"
              style={{ backgroundColor: activeStroke, borderColor: 'rgba(255,255,255,0.35)' }}
            />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          sideOffset={12}
          className="panel-in z-50 rounded-2xl bg-ink-950 p-3 shadow-[0_20px_45px_-12px_rgba(10,10,25,0.55)]"
        >
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
            {PALETTE.map((swatch) => (
              <Tooltip key={swatch.id} label={swatch.id} side="top">
                <button
                  onClick={() => onSelect(swatch)}
                  className="relative flex h-6 w-6 items-center justify-center rounded-md transition hover:scale-110"
                  style={{ backgroundColor: swatch.fill, border: `1.5px solid ${swatch.stroke}` }}
                >
                  {activeStroke === swatch.stroke && (
                    <span className="absolute inset-[-4px] rounded-lg border-2 border-white" />
                  )}
                </button>
              </Tooltip>
            ))}
          </div>
          <Popover.Arrow className="fill-ink-950" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
