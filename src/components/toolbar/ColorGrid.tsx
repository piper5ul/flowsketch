import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Plus } from 'lucide-react';
import { GRID_COLUMNS, isHex6 } from '../../lib/palette';
import type { SwatchColor } from '../../types';

interface ColorGridProps {
  label: string;
  swatches: readonly SwatchColor[];
  activeId: string | null;
  onPick: (swatch: SwatchColor) => void;
  onCustom?: (hex: string) => void;
  customValue?: string;
  onHoverName?: (name: string | null) => void;
}

/** Move a roving grid index by one key, keeping it within the available cells. */
export function gridMove(index: number, key: string, count: number, cols = GRID_COLUMNS): number {
  if (count <= 0 || cols <= 0) return 0;
  const current = Math.max(0, Math.min(index, count - 1));

  switch (key) {
    // Horizontal arrows follow row-major order. This keeps the documented
    // ArrowRight×4 path from White to Blue usable; only the grid's outer ends
    // clamp. Vertical arrows retain their column.
    case 'ArrowLeft':
      return Math.max(0, current - 1);
    case 'ArrowRight':
      return Math.min(count - 1, current + 1);
    case 'ArrowUp': {
      const row = Math.floor(current / cols);
      return row === 0 ? current : current - cols;
    }
    case 'ArrowDown': {
      const row = Math.floor(current / cols);
      if (row >= Math.floor((count - 1) / cols)) return current;
      const next = current + cols;
      return Math.min(count - 1, next);
    }
    case 'Home':
      return Math.floor(current / cols) * cols;
    case 'End':
      return Math.min(count - 1, Math.floor(current / cols) * cols + cols - 1);
    default:
      return current;
  }
}

export function ColorGrid({
  label,
  swatches,
  activeId,
  onPick,
  onCustom,
  customValue,
  onHoverName,
}: ColorGridProps) {
  const hasCustom = onCustom !== undefined;
  const count = swatches.length + (hasCustom ? 1 : 0);
  const activeIndex = swatches.findIndex((swatch) => swatch.id === activeId);
  const [focusIndex, setFocusIndex] = useState(activeIndex >= 0 ? activeIndex : 0);
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const [focusedName, setFocusedName] = useState<string | null>(null);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFocusIndex(activeIndex >= 0 ? activeIndex : 0);
  }, [activeIndex]);

  const setButton = (index: number) => (element: HTMLButtonElement | null) => {
    if (element) buttons.current.set(index, element);
    else buttons.current.delete(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Enter') {
      event.stopPropagation();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const next = gridMove(index, event.key, count);
    setFocusIndex(next);
    buttons.current.get(next)?.focus();
  };

  const changeFocus = (index: number, name: string) => {
    setFocusIndex(index);
    setFocusedName(name);
    if (hoveredName === null) onHoverName?.(name);
  };

  const setHover = (name: string | null) => {
    setHoveredName(name);
    onHoverName?.(name ?? focusedName);
  };

  const showCustomPicker = () => {
    const picker = input.current;
    if (!picker) return;
    if (picker.showPicker) picker.showPicker();
    else picker.click();
  };

  return (
    <div
      className="color-grid"
      role="group"
      aria-label={label}
      onMouseLeave={() => setHover(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusedName(null);
          if (hoveredName === null) onHoverName?.(null);
        }
      }}
    >
      {swatches.map((swatch, index) => {
        const active = activeId === swatch.id;
        return (
          <button
            key={swatch.id}
            ref={setButton(index)}
            type="button"
            aria-label={swatch.name}
            aria-pressed={active}
            tabIndex={focusIndex === index ? 0 : -1}
            className="color-cell"
            onClick={() => onPick(swatch)}
            onKeyDown={(event) => onKeyDown(event, index)}
            onMouseEnter={() => setHover(swatch.name)}
            onFocus={() => changeFocus(index, swatch.name)}
          >
            <span
              className="color-circle"
              data-white={swatch.id === 'white' ? 'true' : undefined}
              style={{ backgroundColor: swatch.fill }}
            />
          </button>
        );
      })}
      {hasCustom && (
        <div className="relative">
          <button
            ref={setButton(swatches.length)}
            type="button"
            aria-label="Custom colour"
            aria-pressed={false}
            tabIndex={focusIndex === swatches.length ? 0 : -1}
            className="color-cell"
            onClick={showCustomPicker}
            onKeyDown={(event) => onKeyDown(event, swatches.length)}
            onMouseEnter={() => setHover('Custom colour')}
            onFocus={() => changeFocus(swatches.length, 'Custom colour')}
          >
            <Plus size={14} strokeWidth={1.75} className="text-white/80" />
          </button>
          <input
            ref={input}
            type="color"
            aria-hidden="true"
            tabIndex={-1}
            data-testid="custom-colour-input"
            className="sr-only"
            value={isHex6(customValue ?? '') ? customValue : '#2987D7'}
            onChange={(event) => onCustom?.(event.currentTarget.value)}
          />
        </div>
      )}
    </div>
  );
}
