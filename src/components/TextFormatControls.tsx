import {
  Minus,
  Plus,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
} from 'lucide-react';
import clsx from 'clsx';
import { Tooltip } from './Tooltip';
import type { FontSize, TextAlign, VerticalAlign } from '../types';

const FONT_SIZES: FontSize[] = ['small', 'medium', 'large'];
const FONT_SIZE_LABEL: Record<FontSize, string> = { small: 'S', medium: 'M', large: 'L' };

const BUTTON_CLASS =
  'flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-30';
const ACTIVE_CLASS = 'bg-accent-500 text-white hover:bg-accent-500';

/** The formatting the controls display. Callers map it onto whatever they edit. */
export interface TextFormatValue {
  fontSize: FontSize;
  bold: boolean;
  italic: boolean;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
}

interface TextFormatControlsProps {
  value: TextFormatValue;
  onChange: (patch: Partial<TextFormatValue>) => void;
  /**
   * Whether to offer the alignment rows. A connector label sits on the path and
   * has no box to align inside, so its bar shows size, bold and italic only.
   */
  showAlignment?: boolean;
}

/**
 * The text formatting buttons themselves — no state, no store, no positioning.
 * Both bars that offer formatting render this: the one that appears while a
 * single label is being edited, and the selection toolbar, which applies the
 * same patch to everything selected. Keeping the markup in one place is what
 * stops the two from drifting apart.
 */
export function TextFormatControls({ value, onChange, showAlignment = true }: TextFormatControlsProps) {
  const sizeIndex = FONT_SIZES.indexOf(value.fontSize);

  const cycleSize = (dir: -1 | 1) => {
    onChange({ fontSize: FONT_SIZES[Math.max(0, Math.min(FONT_SIZES.length - 1, sizeIndex + dir))] });
  };

  return (
    <>
      <Tooltip label="Decrease size" side="top">
        <button onClick={() => cycleSize(-1)} disabled={sizeIndex === 0} className={BUTTON_CLASS}>
          <Minus size={14} />
        </button>
      </Tooltip>
      <span className="w-6 text-center text-xs font-semibold text-white/80">
        {FONT_SIZE_LABEL[value.fontSize]}
      </span>
      <Tooltip label="Increase size" side="top">
        <button
          onClick={() => cycleSize(1)}
          disabled={sizeIndex === FONT_SIZES.length - 1}
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

      {showAlignment && (
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
