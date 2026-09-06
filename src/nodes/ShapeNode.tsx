import { useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import clsx from 'clsx';
import type { ShapeNode as ShapeNodeType } from '../store/useDiagramStore';
import { useDiagramStore, consumeSuppressBlur } from '../store/useDiagramStore';
import type { Direction, FontSize, VerticalAlign } from '../types';
import { isDarkFill } from '../lib/palette';

const FONT_SIZE_PX: Record<FontSize, number> = { small: 12, medium: 14, large: 18 };

/** Text shapes never shrink below the height they are created at. */
const TEXT_MIN_HEIGHT = 40;

const HANDLES: { id: string; position: Position; style: React.CSSProperties }[] = [
  { id: 'top', position: Position.Top, style: { top: -5, left: '50%', transform: 'translateX(-50%)' } },
  { id: 'right', position: Position.Right, style: { right: -5, top: '50%', transform: 'translateY(-50%)' } },
  { id: 'bottom', position: Position.Bottom, style: { bottom: -5, left: '50%', transform: 'translateX(-50%)' } },
  { id: 'left', position: Position.Left, style: { left: -5, top: '50%', transform: 'translateY(-50%)' } },
];

const QUICK_ADD: { direction: Direction; style: React.CSSProperties }[] = [
  { direction: 'top', style: { top: -12, left: '50%', transform: 'translateX(-50%)' } },
  { direction: 'right', style: { right: -12, top: '50%', transform: 'translateY(-50%)' } },
  { direction: 'bottom', style: { bottom: -12, left: '50%', transform: 'translateX(-50%)' } },
  { direction: 'left', style: { left: -12, top: '50%', transform: 'translateY(-50%)' } },
];

export function ShapeNode({ id, data, height, selected }: NodeProps<ShapeNodeType>) {
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
  const setNodeSizeTransient = useDiagramStore((s) => s.setNodeSizeTransient);
  const addConnectedShape = useDiagramStore((s) => s.addConnectedShape);
  const editingNodeId = useDiagramStore((s) => s.editingNodeId);
  const setEditingNodeId = useDiagramStore((s) => s.setEditingNodeId);
  const editing = editingNodeId === id;
  const ref = useRef<HTMLDivElement>(null);
  const shapeRef = useRef<HTMLDivElement>(null);

  const isTextShape = data.shape === 'text';

  /**
   * Text shapes size themselves to their content: the width stays under the
   * user's control via the resizer and the text wraps, but the height follows
   * whatever is typed. The update is transient so growing never lands in the
   * undo stack.
   */
  const syncTextHeight = useCallback(() => {
    if (!isTextShape) return;
    const content = ref.current;
    const shape = shapeRef.current;
    if (!content || !shape) return;

    const style = window.getComputedStyle(shape);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const next = Math.max(TEXT_MIN_HEIGHT, content.scrollHeight + padding);
    if (height === undefined || Math.abs(next - height) > 1) {
      setNodeSizeTransient(id, { height: next });
    }
  }, [id, isTextShape, height, setNodeSizeTransient]);

  // Runs on mount (so labels restored from the server get their height) and
  // whenever the committed text or its typography changes.
  useLayoutEffect(() => {
    syncTextHeight();
  }, [syncTextHeight, data.label, data.fontSize, data.bold, data.italic]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [editing]);

  const commit = useCallback(() => {
    if (consumeSuppressBlur()) return;
    setEditingNodeId(null);
    updateNodeData(id, { label: ref.current?.innerText ?? '' });
    syncTextHeight();
  }, [id, updateNodeData, setEditingNodeId, syncTextHeight]);

  // Floating arrows hang off 1×1 rectangles with transparent fill and stroke.
  // Text shapes are transparent too, so they must be excluded explicitly or
  // they render as an empty anchor box with no editable text at all.
  const isAnchor =
    data.shape !== 'text' && data.fill === 'transparent' && data.stroke === 'transparent';
  if (isAnchor) {
    return (
      <div className="relative h-full w-full">
        {HANDLES.map((h) => (
          <Handle key={h.id} id={h.id} type="source" position={h.position} style={h.style} />
        ))}
      </div>
    );
  }

  const isText = isTextShape;
  const isSticky = data.shape === 'sticky';
  const isDiamond = data.shape === 'diamond';
  const isEllipse = data.shape === 'ellipse';
  const isPill = data.shape === 'pill';
  const isTriangle = data.shape === 'triangle';
  const isHexagon = data.shape === 'hexagon';
  const isCylinder = data.shape === 'cylinder';
  const hasClipShape = isDiamond || isTriangle || isHexagon;
  const isLocked = !!data.locked;

  const textAlign = data.textAlign ?? (isText ? 'left' : 'center');
  const verticalAlign: VerticalAlign = data.verticalAlign ?? 'middle';
  const fontSizePx = FONT_SIZE_PX[data.fontSize ?? 'medium'];
  const darkBg = isDarkFill(data.fill);

  const svgPaths: Record<string, string> = {
    diamond: 'M 50 0 L 100 50 L 50 100 L 0 50 Z',
    triangle: 'M 50 0 L 100 100 L 0 100 Z',
    hexagon: 'M 25 0 L 75 0 L 100 50 L 75 100 L 25 100 L 0 50 Z',
  };

  const shapeClass = clsx(
    'relative h-full w-full flex justify-center px-3 transition-shadow',
    verticalAlign === 'top' && 'items-start pt-2',
    verticalAlign === 'middle' && 'items-center',
    verticalAlign === 'bottom' && 'items-end pb-2',
    textAlign === 'left' && 'text-left',
    textAlign === 'center' && 'text-center',
    textAlign === 'right' && 'text-right',
    !isText && !hasClipShape && !isCylinder && 'border-[1.5px]',
    isEllipse && 'rounded-full',
    isPill && 'rounded-full',
    isSticky && 'rounded-md shadow-[0_10px_20px_-8px_rgba(30,20,0,0.25)]',
    !isEllipse && !isSticky && !hasClipShape && !isText && !isPill && !isCylinder && 'rounded-md',
  );

  return (
    <div
      className={clsx('shape-wrapper relative h-full w-full', selected && 'is-selected')}
      onDoubleClick={() => { if (!editing && !isLocked) setEditingNodeId(id); }}
    >
      <div
        ref={shapeRef}
        className={shapeClass}
        style={{
          background: hasClipShape || isCylinder ? 'transparent' : data.fill,
          borderColor: data.stroke,
          boxShadow: hasClipShape || isCylinder
            ? undefined
            : selected
              ? '0 0 0 1.5px var(--color-accent-500), 0 6px 16px -8px rgba(30,20,60,0.22)'
              : !isText && !isSticky
                ? '0 1px 2px rgba(20, 20, 40, 0.06)'
                : undefined,
        }}
      >
        {hasClipShape && (
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" overflow="visible">
            <path
              d={svgPaths[data.shape]}
              fill={data.fill}
              stroke={data.stroke}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </svg>
        )}

        {isCylinder && (
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 120 130" preserveAspectRatio="none" overflow="visible">
            <path
              d="M0,20 Q0,0 60,0 Q120,0 120,20 L120,110 Q120,130 60,130 Q0,130 0,110 Z"
              fill={data.fill}
              stroke="none"
            />
            <path
              d="M0,20 L0,110 Q0,130 60,130 Q120,130 120,110 L120,20"
              fill="none"
              stroke={data.stroke}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
            <ellipse cx="60" cy="20" rx="60" ry="20" fill={data.fill} stroke={data.stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>
        )}

        {data.imageSrc ? (
          <img
            src={data.imageSrc}
            alt=""
            className="relative z-[1] max-h-full max-w-full object-contain"
            draggable={false}
          />
        ) : (
          <div
            ref={ref}
            contentEditable={editing}
            suppressContentEditableWarning
            data-placeholder={isText ? 'Text' : 'Add text'}
            onBlur={commit}
            onInput={syncTextHeight}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.currentTarget.blur();
              }
            }}
            style={{
              fontSize: fontSizePx,
              fontWeight: data.bold ? 700 : 500,
              fontStyle: data.italic ? 'italic' : 'normal',
              color: darkBg ? '#fff' : undefined,
            }}
            className={clsx(
              'relative z-[1] w-full break-words whitespace-pre-wrap leading-snug outline-none',
              // Other shapes have a fixed size and clip; a text shape grows to
              // fit instead, so clipping it would hide what was just typed.
              !isText && 'max-h-full overflow-hidden',
              !darkBg && 'text-ink-900',
            )}
          >
            {data.label || null}
          </div>
        )}

        {data.link && !editing && (
          <a
            href={data.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded bg-black/10 text-ink-700/60 opacity-0 transition hover:bg-black/20 hover:text-ink-900"
            style={{ opacity: selected ? 0.7 : undefined }}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" />
              <path d="M10 2h4v4" />
              <path d="M14 2 7 9" />
            </svg>
          </a>
        )}

        {isLocked && selected && (
          <div className="absolute bottom-1 left-1 z-10 flex h-5 w-5 items-center justify-center rounded bg-black/10 text-ink-700/60">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12 7V5a4 4 0 00-8 0v2H3a1 1 0 00-1 1v6a1 1 0 001 1h10a1 1 0 001-1V8a1 1 0 00-1-1h-1zm-2 0H6V5a2 2 0 114 0v2zM7 10v2h2v-2H7z" />
            </svg>
          </div>
        )}
      </div>

      <NodeResizer
        isVisible={selected && !isLocked}
        minWidth={60}
        minHeight={40}
        lineStyle={{ borderColor: 'transparent', borderWidth: 6 }}
        handleStyle={{
          width: 0,
          height: 0,
          opacity: 0,
          border: 'none',
          background: 'transparent',
          pointerEvents: 'none',
        }}
      />

      {!isText &&
        HANDLES.map((h) => (
          <Handle
            key={h.id}
            id={h.id}
            type="source"
            position={h.position}
            className="shape-handle"
            style={h.style}
          />
        ))}

      {!isText &&
        !editing &&
        QUICK_ADD.map(({ direction, style }) => (
          <button
            key={direction}
            type="button"
            className="quick-add-btn nodrag nopan"
            style={style}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              addConnectedShape(id, direction);
            }}
          />
        ))}
    </div>
  );
}
