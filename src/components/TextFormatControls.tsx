import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Bold,
  Italic,
  Link2,
  Minus,
  Plus,
  Strikethrough,
  Underline,
} from 'lucide-react';
import clsx from 'clsx';
import { ColorGrid } from './toolbar/ColorGrid';
import { ChromePopover, Segmented, Separator, ToolButton } from './toolbar/chrome';
import { FONT_SIZE_PRESETS, fontSizeLabel, nextFontSize, resolveFontSize } from '../lib/text';
import type { TextFormatValue } from '../lib/text';
import { isHex6, PALETTE } from '../lib/palette';
import { consumeSuppressBlur } from '../store/useDiagramStore';
import type { FontSize } from '../types';

export type { TextFormatValue } from '../lib/text';

const CONNECTOR_SIZES: FontSize[] = ['small', 'medium', 'large'];
const CONNECTOR_LABEL: Record<FontSize, string> = { small: 'S', medium: 'M', large: 'L' };

interface TextFormatControlsProps {
  value: TextFormatValue;
  onChange: (patch: Partial<TextFormatValue>) => void;
  target: 'shape' | 'connectorLabel';
  keepEditorFocus: boolean;
  link: { active: boolean; onOpen: () => void } | null;
}

function SizeControl({
  value,
  target,
  keepEditorFocus,
  onChange,
}: Pick<TextFormatControlsProps, 'target' | 'keepEditorFocus' | 'onChange'> & { value: TextFormatValue }) {
  const [open, setOpen] = useState(false);
  const shape = target === 'shape';
  const px = resolveFontSize(value.fontSize);
  const connectorIndex = CONNECTOR_SIZES.indexOf(value.fontSize as FontSize);
  const sizeName = shape ? fontSizeLabel(px) : CONNECTOR_LABEL[value.fontSize as FontSize];
  const decrease = () => {
    if (shape) onChange({ fontSize: nextFontSize(value.fontSize, -1) });
    else onChange({ fontSize: CONNECTOR_SIZES[Math.max(0, connectorIndex - 1)] });
  };
  const increase = () => {
    if (shape) onChange({ fontSize: nextFontSize(value.fontSize, 1) });
    else onChange({ fontSize: CONNECTOR_SIZES[Math.min(CONNECTOR_SIZES.length - 1, connectorIndex + 1)] });
  };
  const atMin = shape ? px <= 10 : connectorIndex <= 0;
  const atMax = shape ? px >= 48 : connectorIndex >= CONNECTOR_SIZES.length - 1;

  return (
    <Segmented label="Text size">
      <ToolButton label="Decrease size" disabled={atMin} onClick={decrease}>
        <Minus size={14} />
      </ToolButton>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <ToolButton label="Text size" popover active={open} className="text-xs font-semibold tabular-nums">
            {sizeName}
          </ToolButton>
        </Popover.Trigger>
        <ChromePopover label="Text size" side="top" sideOffset={9} keepEditorFocus={keepEditorFocus} width={120}>
          <div role="group" aria-label="Text size presets" className="flex flex-col gap-0.5">
            {shape ? FONT_SIZE_PRESETS.map(([label, size]) => (
              <Popover.Close asChild key={label}>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={px === size}
                  onClick={() => onChange({ fontSize: size })}
                  className="flex h-7 items-center justify-between rounded-md px-2 text-left text-[13px] text-white/90 transition hover:bg-[var(--color-chrome-hover)] aria-pressed:bg-[var(--color-chrome-selected)]"
                >
                  <span>{label}</span><span className="text-xs text-[var(--color-chrome-text-muted)]">{size}px</span>
                </button>
              </Popover.Close>
            )) : CONNECTOR_SIZES.map((size) => (
              <Popover.Close asChild key={size}>
                <button
                  type="button"
                  aria-label={CONNECTOR_LABEL[size]}
                  aria-pressed={value.fontSize === size}
                  onClick={() => onChange({ fontSize: size })}
                  className="flex h-7 items-center justify-between rounded-md px-2 text-left text-[13px] text-white/90 transition hover:bg-[var(--color-chrome-hover)] aria-pressed:bg-[var(--color-chrome-selected)]"
                >
                  <span>{CONNECTOR_LABEL[size]}</span><span className="text-xs text-[var(--color-chrome-text-muted)]">{resolveFontSize(size)}px</span>
                </button>
              </Popover.Close>
            ))}
          </div>
        </ChromePopover>
      </Popover.Root>
      <ToolButton label="Increase size" disabled={atMax} onClick={increase}>
        <Plus size={14} />
      </ToolButton>
    </Segmented>
  );
}

function MoreTextStyles({
  value,
  onChange,
  keepEditorFocus,
}: Pick<TextFormatControlsProps, 'value' | 'onChange' | 'keepEditorFocus'>) {
  const [open, setOpen] = useState(false);
  const [colorName, setColorName] = useState<string | null>(null);
  const activeId = PALETTE.find((swatch) => swatch.fill.toUpperCase() === value.textColor?.toUpperCase())?.id ?? null;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <ToolButton label="More text styles" popover active={open}>
          <span aria-hidden="true" className="text-base leading-none">⋮</span>
        </ToolButton>
      </Popover.Trigger>
      <ChromePopover label="More text styles" side="top" sideOffset={9} keepEditorFocus={keepEditorFocus} width={140}>
        {colorName !== null && <span className="swatch-name" aria-hidden="true">{colorName}</span>}
        <div className="flex flex-col gap-1">
          {([
            ['Underline', Underline, value.underline, () => onChange({ underline: !value.underline })],
            ['Strikethrough', Strikethrough, value.strikethrough, () => onChange({ strikethrough: !value.strikethrough })],
          ] as const).map(([label, Icon, active, run]) => (
            <Popover.Close asChild key={label}>
              <button
                type="button"
                aria-label={label}
                aria-pressed={active}
                onClick={run}
                className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-[13px] text-white/90 transition hover:bg-[var(--color-chrome-hover)] aria-pressed:bg-[var(--color-chrome-selected)]"
              >
                <Icon size={14} />{label}
              </button>
            </Popover.Close>
          ))}
          <div className="px-1 pt-1 text-[11px] font-medium text-[var(--color-chrome-text-muted)]">Text colour</div>
          <ColorGrid
            label="Colors"
            swatches={PALETTE}
            activeId={activeId}
            customValue={isHex6(value.textColor ?? '') ? value.textColor : undefined}
            onPick={(swatch) => {
              onChange({ textColor: swatch.fill });
              setOpen(false);
            }}
            onCustom={(hex) => onChange({ textColor: hex.toUpperCase() })}
            onHoverName={setColorName}
          />
          <Popover.Close asChild>
            <button
              type="button"
              aria-label="Auto"
              aria-pressed={value.textColor === undefined}
              onClick={() => onChange({ textColor: undefined })}
              className={clsx('h-7 w-28 self-center rounded-md text-[11px] font-semibold text-white/80 transition hover:bg-[var(--color-chrome-hover)] aria-pressed:bg-[var(--color-chrome-selected)]')}
            >Auto</button>
          </Popover.Close>
        </div>
      </ChromePopover>
    </Popover.Root>
  );
}

/** The text-mode controls shared by shape labels and connector labels. */
export function TextFormatControls({ value, onChange, target, keepEditorFocus, link }: TextFormatControlsProps) {
  const isShape = target === 'shape';
  return (
    <>
      <SizeControl value={value} target={target} keepEditorFocus={keepEditorFocus} onChange={onChange} />
      <Separator />
      <Segmented label="Text style">
        <ToolButton label="Bold" active={value.bold} onClick={() => onChange({ bold: !value.bold })}>
          <Bold size={15} />
        </ToolButton>
        <ToolButton label="Italic" active={value.italic} onClick={() => onChange({ italic: !value.italic })}>
          <Italic size={15} />
        </ToolButton>
        {isShape && <MoreTextStyles value={value} onChange={onChange} keepEditorFocus={keepEditorFocus} />}
      </Segmented>
      {(link || isShape) && <Separator />}
      {link && (
        <ToolButton
          label="Link"
          active={link.active}
          onMouseDown={(event) => {
            if (!keepEditorFocus) return;
            event.stopPropagation();
            event.preventDefault();
            consumeSuppressBlur();
          }}
          onClick={link.onOpen}
        >
          <Link2 size={15} />
        </ToolButton>
      )}
      {isShape && (
        <>
          {link && <Separator />}
          <Segmented label="Horizontal align">
            {([
              ['Left', AlignLeft, 'left'], ['Center', AlignCenter, 'center'], ['Right', AlignRight, 'right'],
            ] as const).map(([label, Icon, align]) => (
              <ToolButton key={align} label={label} active={value.textAlign === align} onClick={() => onChange({ textAlign: align })}>
                <Icon size={15} />
              </ToolButton>
            ))}
          </Segmented>
          <Segmented label="Vertical align">
            {([
              ['Top', AlignVerticalJustifyStart, 'top'], ['Middle', AlignVerticalJustifyCenter, 'middle'], ['Bottom', AlignVerticalJustifyEnd, 'bottom'],
            ] as const).map(([label, Icon, align]) => (
              <ToolButton key={align} label={label} active={value.verticalAlign === align} onClick={() => onChange({ verticalAlign: align })}>
                <Icon size={15} />
              </ToolButton>
            ))}
          </Segmented>
        </>
      )}
    </>
  );
}
