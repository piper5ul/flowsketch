import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import type { ArrowStyle } from '../../types';
import { ChromePopover, ToolButton } from './chrome';

const STYLES: [ArrowStyle, string][] = [
  ['none', 'None'], ['arrow', 'Arrow'], ['open', 'Open'], ['circle', 'Circle'],
  ['diamond', 'Diamond'], ['bar', 'Bar'], ['halfcircle', 'Half circle'], ['dot', 'Dot'],
];

function ArrowHead({ style, side }: { style: ArrowStyle; side: 'start' | 'end' }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <g transform={side === 'start' ? 'translate(20 0) scale(-1 1)' : undefined}>
        <line x1="2" y1="10" x2={style === 'none' ? 18 : 14} y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        {style === 'arrow' && <path d="M14 5 19 10l-5 5z" fill="currentColor" />}
        {style === 'open' && <path d="m14 5 4.5 5-4.5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {style === 'circle' && <circle cx="15.5" cy="10" r="3.5" fill="currentColor" />}
        {style === 'diamond' && <path d="m12 10 3.5-3.5L19 10l-3.5 3.5z" fill="currentColor" />}
        {style === 'bar' && <line x1="16.5" y1="5" x2="16.5" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
        {style === 'halfcircle' && <path d="M14 5a5 5 0 0 1 0 10z" fill="currentColor" />}
        {style === 'dot' && <circle cx="16.5" cy="10" r="2.5" fill="currentColor" />}
      </g>
    </svg>
  );
}

export function ArrowStylePicker({
  side,
  value,
  onChange,
}: {
  side: 'start' | 'end';
  value: ArrowStyle;
  onChange: (style: ArrowStyle) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = side === 'start' ? 'Start arrowhead' : 'End arrowhead';
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <ToolButton label={label} popover active={open}>
          <ArrowHead style={value} side={side} />
        </ToolButton>
      </Popover.Trigger>
      <ChromePopover label={label} side="top" sideOffset={9} width={126}>
        <div className="grid grid-cols-4 gap-0">
          {STYLES.map(([style, styleLabel]) => (
            <Popover.Close asChild key={style}>
              <button
                type="button"
                aria-label={styleLabel}
                aria-pressed={value === style}
                onClick={() => onChange(style)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-white/80 transition hover:bg-[var(--color-chrome-hover)] aria-pressed:bg-[var(--color-chrome-selected)]"
              >
                <ArrowHead style={style} side={side} />
              </button>
            </Popover.Close>
          ))}
        </div>
      </ChromePopover>
    </Popover.Root>
  );
}
