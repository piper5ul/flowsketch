import {
  Minus,
  Plus,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
} from 'lucide-react';
import clsx from 'clsx';
import { Tooltip } from './Tooltip';
import { ColorPicker } from './toolbar/ColorPicker';
import { PALETTE } from '../lib/palette';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, nextFontSize, resolveFontSize } from '../lib/text';
import type { FontSize, TextAlign, VerticalAlign } from '../types';

const FONT_SIZES: FontSize[] = ['small', 'medium', 'large'];
const FONT_SIZE_LABEL: Record<FontSize, string> = { small: 'S', medium: 'M', large: 'L' };

const BUTTON_CLASS =
  'flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-30';
const ACTIVE_CLASS = 'bg-accent-500 text-white hover:bg-accent-500';

/** The formatting the controls display. Callers map it onto whatever they edit. */
export interface TextFormatValue {
  /** Pixels on a shape; one of the three names on a connector's label. */
  fontSize: FontSize | number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  /** Absent when the label takes its colour from the fill it sits on. */
  textColor?: string;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
}

interface TextFormatControlsProps {
  value: TextFormatValue;
  onChange: (patch: Partial<TextFormatValue>) => void;
  /**
   * What is being formatted. A connector's label sits on the path rather than
   * in a box, so it has nothing to align inside — and it keeps its formatting
   * under its own `label*` keys, which carry size, bold and italic only.
   */
  target?: 'shape' | 'connectorLabel';
  /** Preserve a live label editor while interacting with a portalled picker. */
  keepEditorFocus?: boolean;
}

/**
 * The text formatting buttons themselves — no state, no store, no positioning.
 * Both bars that offer formatting render this: the one that appears while a
 * single label is being edited, and the selection toolbar, which applies the
 * same patch to everything selected. Keeping the markup in one place is what
 * stops the two from drifting apart.
 */
export function TextFormatControls({
  value,
  onChange,
  target = 'shape',
  keepEditorFocus = false,
}: TextFormatControlsProps) {
  const isShape = target === 'shape';

  // A shape's label is sized in pixels; a connector's still wears one of the
  // three names, so its stepper walks that list instead of the scale.
  const presetIndex = FONT_SIZES.indexOf(value.fontSize as FontSize);
  const sizePx = resolveFontSize(value.fontSize);

  const stepSize = (direction: -1 | 1) => {
    if (isShape) {
      onChange({ fontSize: nextFontSize(value.fontSize, direction) });
      return;
    }
    const next = Math.max(0, Math.min(FONT_SIZES.length - 1, presetIndex + direction));
    onChange({ fontSize: FONT_SIZES[next] });
  };

  const atMin = isShape ? sizePx <= FONT_SIZE_MIN : presetIndex === 0;
  const atMax = isShape ? sizePx >= FONT_SIZE_MAX : presetIndex === FONT_SIZES.length - 1;

  return (
    <>
      <Tooltip label="Decrease size" side="top">
        <button
          aria-label="Decrease size"
          onClick={() => stepSize(-1)}
          disabled={atMin}
          className={BUTTON_CLASS}
        >
          <Minus size={14} />
        </button>
      </Tooltip>
      <span className="w-6 text-center text-xs font-semibold tabular-nums text-white/80">
        {isShape ? sizePx : FONT_SIZE_LABEL[value.fontSize as FontSize]}
      </span>
      <Tooltip label="Increase size" side="top">
        <button
          aria-label="Increase size"
          onClick={() => stepSize(1)}
          disabled={atMax}
          className={BUTTON_CLASS}
        >
          <Plus size={14} />
        </button>
      </Tooltip>

      <div className="mx-0.5 h-6 w-px bg-white/10" />

      <Tooltip label="Bold" side="top">
        <button
          onClick={() => onChange({ bold: !value.bold })}
          className={clsx(BUTTON_CLASS, value.bold && ACTIVE_CLASS)}
        >
          <Bold size={15} />
        </button>
      </Tooltip>
      <Tooltip label="Italic" side="top">
        <button
          onClick={() => onChange({ italic: !value.italic })}
          className={clsx(BUTTON_CLASS, value.italic && ACTIVE_CLASS)}
        >
          <Italic size={15} />
        </button>
      </Tooltip>

      {/* A connector's label carries size, bold and italic and nothing else. */}
      {isShape && (
        <>
          <Tooltip label="Underline" side="top">
            <button
              aria-label="Underline"
              onClick={() => onChange({ underline: !value.underline })}
              className={clsx(BUTTON_CLASS, value.underline && ACTIVE_CLASS)}
            >
              <Underline size={15} />
            </button>
          </Tooltip>
          <Tooltip label="Strikethrough" side="top">
            <button
              aria-label="Strikethrough"
              onClick={() => onChange({ strikethrough: !value.strikethrough })}
              className={clsx(BUTTON_CLASS, value.strikethrough && ACTIVE_CLASS)}
            >
              <Strikethrough size={15} />
            </button>
          </Tooltip>
          <ColorPicker
            target="text"
            activeId={
              PALETTE.find((swatch) => swatch.fill.toUpperCase() === value.textColor?.toUpperCase())?.id ?? null
            }
            triggerColour={value.textColor ?? null}
            onPick={(swatch) => onChange({ textColor: swatch.fill })}
            onCustom={(hex) => onChange({ textColor: hex })}
            keepEditorFocus={keepEditorFocus}
            extra={
              <button
                type="button"
                aria-label="Auto"
                aria-pressed={value.textColor === undefined}
                className={clsx(
                  'h-7 w-28 rounded-md text-[11px] font-semibold text-white/70 transition hover:bg-white/10 hover:text-white',
                  value.textColor === undefined && ACTIVE_CLASS,
                )}
                onClick={() => onChange({ textColor: undefined })}
              >
                Auto
              </button>
            }
          />
        </>
      )}

      {isShape && (
        <>
          <div className="mx-0.5 h-6 w-px bg-white/10" />
          {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(
            ([align, Icon]) => (
              <Tooltip key={align} label={align[0].toUpperCase() + align.slice(1)} side="top">
                <button
                  onClick={() => onChange({ textAlign: align })}
                  className={clsx(BUTTON_CLASS, value.textAlign === align && ACTIVE_CLASS)}
                >
                  <Icon size={15} />
                </button>
              </Tooltip>
            ),
          )}
          <div className="mx-0.5 h-6 w-px bg-white/10" />
          {([['top', AlignVerticalJustifyStart], ['middle', AlignVerticalJustifyCenter], ['bottom', AlignVerticalJustifyEnd]] as const).map(
            ([align, Icon]) => (
              <Tooltip key={align} label={align[0].toUpperCase() + align.slice(1)} side="top">
                <button
                  onClick={() => onChange({ verticalAlign: align })}
                  className={clsx(BUTTON_CLASS, value.verticalAlign === align && ACTIVE_CLASS)}
                >
                  <Icon size={15} />
                </button>
              </Tooltip>
            ),
          )}
        </>
      )}
    </>
  );
}
