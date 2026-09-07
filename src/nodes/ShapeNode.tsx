import { useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import clsx from 'clsx';
import type { ShapeNode as ShapeNodeType } from '../store/useDiagramStore';
import { useDiagramStore, consumeSuppressBlur } from '../store/useDiagramStore';
import { useSearchHighlight } from '../store/useSearchStore';
import { peerOutlineStyle, usePeerSelection } from '../store/useCollabStore';
import type { Direction, VerticalAlign } from '../types';
import { resolveFontSize } from '../lib/text';
import { isDarkFill } from '../lib/palette';
import { canRoundCorners, isAnchorNode } from '../lib/nodeKinds';
import { hasMarkdown, parseMarkdown } from '../lib/markdown';
import { MarkdownLabel } from '../components/MarkdownLabel';
import {
  CYLINDER_SEAM,
  shapePaint,
} from '../lib/shapeStyle';
import { isClipShape, svgPaths, textInset } from '../lib/shapePaths';
import { childCount, foldedCount } from '../lib/mindMap';
import { useShiftKey } from '../lib/useShiftKey';

/** Text shapes never shrink below the height they are created at. */
const TEXT_MIN_HEIGHT = 40;

/**
 * The breathing room every label gets, before the shape's own silhouette asks
 * for more. The vertical half is only spent when the text is pushed against
 * that edge — a middle-aligned label needs no gap above it.
 */
const LABEL_PADDING_X = 12;
const LABEL_PADDING_Y = 8;

/** The drop shadow a shape casts when it is asked to, boxed and un-boxed. */
const SHAPE_SHADOW = '0 12px 28px -10px rgba(20, 20, 50, 0.55)';
const SHAPE_SHADOW_FILTER = 'drop-shadow(0 8px 10px rgba(20, 20, 50, 0.35))';

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

export function ShapeNode({ id, data, width, height, selected, parentId }: NodeProps<ShapeNodeType>) {
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
  const setNodeSizeTransient = useDiagramStore((s) => s.setNodeSizeTransient);
  const addConnectedShape = useDiagramStore((s) => s.addConnectedShape);
  const editingNodeId = useDiagramStore((s) => s.editingNodeId);
  const setEditingNodeId = useDiagramStore((s) => s.setEditingNodeId);
  const editing = editingNodeId === id;
  const mindMapToggleCollapse = useDiagramStore((s) => s.mindMapToggleCollapse);
  // A mind-map node's own chrome: the fold button, and the number it shows when
  // a branch is folded away. Both selectors return a *number*, never an object —
  // a fresh object per call would re-render every node on every store update.
  // They are also the reason the counts are cheap to ask for: a board with no
  // mind map on it never gets past `data.mindMap`.
  const branchCount = useDiagramStore((s) => (data.mindMap ? childCount(s.edges, id) : 0));
  const folded = useDiagramStore((s) =>
    data.mindMap?.collapsed ? foldedCount(s.nodes, s.edges, id) : 0,
  );
  // `undefined` unless a search is running and this shape is one of its hits;
  // `'active'` on the one the find bar is currently pointing at. Read as a
  // string so a shape the search never matched does not re-render as it is
  // typed. The ring itself is CSS — see `[data-search-hit]` in `index.css`.
  const searchHit = useSearchHighlight('node', id);
  // The collaborator holding this shape, if anyone is. Drawn as an outline in
  // their own colour — see `[data-peer-selected]` in `index.css`.
  const peerSelection = usePeerSelection(id);
  // Holding ⇧ while dragging a corner locks the aspect ratio, as in every
  // other design tool. Image nodes are locked whether or not it is held.
  const shiftHeld = useShiftKey();
  const ref = useRef<HTMLDivElement>(null);
  const shapeRef = useRef<HTMLDivElement>(null);

  const isTextShape = data.shape === 'text';
  const isImageNode = data.shape === 'image';

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

  // Markdown in the label renders only while it is not being edited: the
  // source stays what is stored, and editing shows it so the markers can be
  // reached. Plain text — the usual case — never pays for a parse.
  const markdown = useMemo(() => (!editing && hasMarkdown(data.label) ? parseMarkdown(data.label) : null), [editing, data.label]);

  const commit = useCallback(() => {
    if (consumeSuppressBlur()) return;
    // Ending the editing is only this node's to do while it is still the node
    // being edited. A mind-map keystroke moves the editor on to the node it has
    // just made *before* this one loses focus, and closing it then would cancel
    // the label the user is already typing into. The text is written either way.
    if (useDiagramStore.getState().editingNodeId === id) setEditingNodeId(null);
    updateNodeData(id, { label: ref.current?.innerText ?? '' });
    syncTextHeight();
  }, [id, updateNodeData, setEditingNodeId, syncTextHeight]);

  // A grey box holding the image's place while its bytes upload. No handles
  // and no resizer: it is about to be replaced by the real thing.
  if (isImageNode && data.uploading) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-md border-[1.5px] border-dashed border-ink-600/30 bg-hover-soft text-[13px] font-medium text-ink-600/60">
        Uploading…
      </div>
    );
  }

  // An image node is the image and nothing else: no border, no fill, no label
  // to edit and no quick-add buttons — connectors still attach through the
  // same handles every other shape uses.
  if (isImageNode) {
    return (
      <div
        data-node-type="shape"
        data-parent-id={parentId}
        data-search-hit={searchHit}
        data-peer-selected={peerSelection?.name}
        style={peerOutlineStyle(peerSelection)}
        className={clsx('shape-wrapper relative h-full w-full', selected && 'is-selected')}
      >
        <img
          src={data.imageSrc}
          alt=""
          className="h-full w-full object-contain"
          draggable={false}
          style={{
            outline: selected ? '1.5px solid var(--color-accent-500)' : undefined,
            outlineOffset: 2,
          }}
        />
        <NodeResizer
          isVisible={selected && !data.locked}
          keepAspectRatio
          minWidth={20}
          minHeight={20}
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
        {HANDLES.map((h) => (
          <Handle
            key={h.id}
            id={h.id}
            type="source"
            position={h.position}
            className="shape-handle"
            style={h.style}
          />
        ))}
      </div>
    );
  }

  // Floating arrows hang off 1×1 rectangles with transparent fill and stroke;
  // those render as bare handles, with no shape chrome around them.
  if (isAnchorNode(data)) {
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
  const isEllipse = data.shape === 'ellipse';
  const isPill = data.shape === 'pill';
  const isCylinder = data.shape === 'cylinder';
  const hasClipShape = isClipShape(data.shape);
  const isLocked = !!data.locked;

  const textAlign = data.textAlign ?? (isText ? 'left' : 'center');
  const verticalAlign: VerticalAlign = data.verticalAlign ?? 'middle';
  const fontSizePx = resolveFontSize(data.fontSize);
  // Which of the shape's two colours is actually drawn. A filled shape wears no
  // outline at all — and no shadow: the board's grey is what it stands on — while
  // an outline one is white with its stroke around it. Neither reads the stored pair differently — see
  // `src/lib/shapeStyle.ts`.
  const paint = shapePaint(data);
  // The contrast that decides the label's colour is against what is *painted*,
  // so an outline shape takes dark text however deep its stored fill is.
  const darkBg = isDarkFill(paint.fill);
  // Both decorations can be worn at once, and CSS spells that as one property.
  const textDecoration = [data.underline && 'underline', data.strikethrough && 'line-through']
    .filter(Boolean)
    .join(' ');

  // A silhouette holds less text than the box it is drawn in — a star is mostly
  // points, an arrow mostly head — so the label is padded away from the edges
  // the outline actually cuts. The insets are proportions of the node's own box
  // (as the paths are), which is why they are resolved against its size here
  // rather than handed to CSS: a percentage padding resolves against the
  // *width* on all four sides, which would be wrong for the vertical pair.
  const inset = textInset(data.shape);
  const labelPadding: React.CSSProperties = {
    paddingLeft: LABEL_PADDING_X + ((width ?? 0) * inset.left) / 100,
    paddingRight: LABEL_PADDING_X + ((width ?? 0) * inset.right) / 100,
    paddingTop: (verticalAlign === 'top' ? LABEL_PADDING_Y : 0) + ((height ?? 0) * inset.top) / 100,
    paddingBottom:
      (verticalAlign === 'bottom' ? LABEL_PADDING_Y : 0) + ((height ?? 0) * inset.bottom) / 100,
  };

  // Opacity and the drop shadow belong to the whole node rather than to the box
  // inside it, so they go on the wrapper — where they leave the selection ring
  // alone. A silhouette has no box for a shadow to trace, so it casts one
  // through its alpha with a filter instead of a rectangle nothing drew.
  const wrapperStyle: React.CSSProperties = {
    opacity: data.opacity,
    ...peerOutlineStyle(peerSelection),
    ...(data.shadow
      ? hasClipShape || isCylinder
        ? { filter: SHAPE_SHADOW_FILTER }
        : { boxShadow: SHAPE_SHADOW }
      : {}),
  };

  const shapeClass = clsx(
    'relative h-full w-full flex justify-center transition-shadow',
    verticalAlign === 'top' && 'items-start',
    verticalAlign === 'middle' && 'items-center',
    verticalAlign === 'bottom' && 'items-end',
    textAlign === 'left' && 'text-left',
    textAlign === 'center' && 'text-center',
    textAlign === 'right' && 'text-right',
    // The border is the outline style's alone: a filled shape has none, which
    // is why the box below sets a width of 0 rather than a transparent colour.
    !isText && !hasClipShape && !isCylinder && 'border-solid',
    isEllipse && 'rounded-full',
    isPill && 'rounded-full',
    isSticky && 'rounded-md shadow-[0_10px_20px_-8px_rgba(30,20,0,0.25)]',
    !isEllipse && !isSticky && !hasClipShape && !isText && !isPill && !isCylinder && 'rounded-md',
  );

  return (
    <div
      data-shape={data.shape}
      // The container this shape belongs to, if any — absent when it sits on
      // the board itself. Rendered so a test can read the parenting a drop into
      // a frame produced without reaching into the store.
      data-node-type="shape"
      data-parent-id={parentId}
      data-search-hit={searchHit}
      data-peer-selected={peerSelection?.name}
      // Whether this shape is part of a mind map, and whether its branch is
      // folded — read by the tests, and by nothing else.
      data-mind-map={data.mindMap ? (data.mindMap.collapsed ? 'collapsed' : 'open') : undefined}
      className={clsx('shape-wrapper relative h-full w-full', selected && 'is-selected')}
      style={wrapperStyle}
      onDoubleClick={() => { if (!editing && !isLocked) setEditingNodeId(id); }}
    >
      <div
        ref={shapeRef}
        className={shapeClass}
        style={{
          ...labelPadding,
          borderRadius: canRoundCorners(data.shape) ? data.cornerRadius : undefined,
          background: hasClipShape || isCylinder ? 'transparent' : paint.fill,
          borderColor: paint.stroke ?? 'transparent',
          borderWidth: paint.stroke ? 1.5 : 0,
          boxShadow: hasClipShape || isCylinder
            ? undefined
            : selected
              ? '0 0 0 1.5px var(--color-accent-500), 0 6px 16px -8px rgba(30,20,60,0.22)'
              : undefined,
        }}
      >
        {isClipShape(data.shape) && (
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            overflow="visible"
          >
            <path
              d={svgPaths[data.shape]}
              fill={paint.fill}
              stroke={paint.stroke ?? 'none'}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </svg>
        )}

        {isCylinder && (
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 120 130"
            preserveAspectRatio="none"
            overflow="visible"
          >
            <path
              d="M0,20 Q0,0 60,0 Q120,0 120,20 L120,110 Q120,130 60,130 Q0,130 0,110 Z"
              fill={paint.fill}
              stroke="none"
            />
            <path
              d="M0,20 L0,110 Q0,130 60,130 Q120,130 120,110 L120,20"
              fill="none"
              stroke={paint.stroke ?? 'none'}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
            {/* The cap. A cylinder is the one silhouette made of two surfaces,
                so a filled one keeps a hairline across its shoulder — without it
                the shape reads as a rounded rectangle. */}
            <ellipse
              cx="60"
              cy="20"
              rx="60"
              ry="20"
              fill={paint.fill}
              stroke={paint.stroke ?? CYLINDER_SEAM}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
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
              textDecoration: textDecoration || undefined,
              // A colour the user picked outranks the automatic one; without
              // it the label goes white on a dark fill and dark on a light one.
              color: data.textColor ?? (darkBg ? '#fff' : undefined),
            }}
            className={clsx(
              'relative z-[1] w-full break-words whitespace-pre-wrap leading-snug outline-none',
              // Other shapes have a fixed size and clip; a text shape grows to
              // fit instead, so clipping it would hide what was just typed.
              !isText && 'max-h-full overflow-hidden',
              // `shape-ink`, not `ink-900`: the contrast that matters here is
              // against the user's fill, which the theme does not touch. A
              // light shape keeps dark text on a dark canvas.
              !darkBg && 'text-shape-ink',
            )}
          >
            {!editing && markdown ? <MarkdownLabel blocks={markdown} /> : data.label || null}
          </div>
        )}

        {data.link && !editing && (
          <a
            href={data.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded bg-black/10 text-shape-ink/60 opacity-0 transition hover:bg-black/20 hover:text-shape-ink"
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
          <div className="absolute bottom-1 left-1 z-10 flex h-5 w-5 items-center justify-center rounded bg-black/10 text-shape-ink/60">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12 7V5a4 4 0 00-8 0v2H3a1 1 0 00-1 1v6a1 1 0 001 1h10a1 1 0 001-1V8a1 1 0 00-1-1h-1zm-2 0H6V5a2 2 0 114 0v2zM7 10v2h2v-2H7z" />
            </svg>
          </div>
        )}
      </div>

      <NodeResizer
        isVisible={selected && !isLocked}
        keepAspectRatio={shiftHeld}
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

      {/* The fold button, on the side the branch grows out of. A mind-map node
          keeps its own count rather than a chevron: what the user needs to know
          about a folded branch is how much of it is out of sight. */}
      {data.mindMap && branchCount > 0 && !editing && (
        <button
          type="button"
          className="nodrag nopan absolute -right-3 top-1/2 z-10 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-panel px-1 text-[10px] font-semibold leading-none text-ink-700 shadow-sm transition hover:bg-hover-soft"
          aria-label={data.mindMap.collapsed ? 'Expand branch' : 'Collapse branch'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            mindMapToggleCollapse(id);
          }}
        >
          {data.mindMap.collapsed ? folded : '–'}
        </button>
      )}

      {/* Withheld from a mind-map node: quick-add would grow an ordinary shape
          on an ordinary connector out of the side the map's own branches leave
          from, and Tab is how a map grows. */}
      {!isText &&
        !data.mindMap &&
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
