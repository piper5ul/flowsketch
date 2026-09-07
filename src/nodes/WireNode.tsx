import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import clsx from 'clsx';
import type { ShapeNode as ShapeNodeType } from '../store/useDiagramStore';
import { consumeSuppressBlur, useDiagramStore } from '../store/useDiagramStore';
import { useSearchHighlight } from '../store/useSearchStore';
import { peerOutlineStyle, usePeerSelection } from '../store/useCollabStore';
import { hasMarkdown, parseMarkdown } from '../lib/markdown';
import { MarkdownLabel } from '../components/MarkdownLabel';
import { resolveFontSize } from '../lib/text';
import {
  WIRE_FILL,
  WIRE_FILL_SOFT,
  WIRE_LINE_PX,
  WIRE_RADIUS_PX,
  WIRE_STROKE,
  WIRE_TEXT,
  WIRE_TINT_STROKE,
  hasLabel,
  labelPlaceholder,
  minSizeOf,
  wireComponentOf,
  wireFlag,
  wireTint,
  type WireComponent,
} from '../lib/wireframe';
import type { TextAlign } from '../types';

const HANDLES: { id: string; position: Position; style: React.CSSProperties }[] = [
  { id: 'top', position: Position.Top, style: { top: -5, left: '50%', transform: 'translateX(-50%)' } },
  { id: 'right', position: Position.Right, style: { right: -5, top: '50%', transform: 'translateY(-50%)' } },
  { id: 'bottom', position: Position.Bottom, style: { bottom: -5, left: '50%', transform: 'translateX(-50%)' } },
  { id: 'left', position: Position.Left, style: { left: -5, top: '50%', transform: 'translateY(-50%)' } },
];

/**
 * How each component's words are set when the user has said nothing. A heading
 * is a heading because it is big and bold; a placeholder is grey because it is
 * a placeholder. `data.fontSize`, `data.bold` and the rest override every one
 * of these, which is what makes the ordinary typography controls work here.
 */
const LABEL_DEFAULTS: Record<WireComponent, { size: number; weight: number; align: TextAlign; muted?: boolean }> = {
  browser: { size: 13, weight: 500, align: 'left' },
  phone: { size: 13, weight: 500, align: 'left' },
  card: { size: 13, weight: 500, align: 'left' },
  button: { size: 13, weight: 600, align: 'center' },
  input: { size: 13, weight: 400, align: 'left', muted: true },
  heading: { size: 20, weight: 700, align: 'left' },
  paragraph: { size: 13, weight: 400, align: 'left' },
  image: { size: 13, weight: 400, align: 'center' },
  avatar: { size: 13, weight: 400, align: 'center' },
  checkbox: { size: 13, weight: 400, align: 'left' },
  toggle: { size: 13, weight: 400, align: 'left' },
  dropdown: { size: 13, weight: 400, align: 'left' },
  divider: { size: 13, weight: 400, align: 'left' },
  link: { size: 13, weight: 500, align: 'left' },
};

/**
 * A wireframe component: one of the fourteen sketches in `WIRE_COMPONENTS`,
 * drawn in the fixed wireframe palette.
 *
 * **One node type, a `switch` on `data.wire.component`.** Every component is a
 * box with a label, so they share this file's resizer, handles, label editor
 * and search ring, and differ only in the markup below — adding a fifteenth is
 * a case here plus a row in `WIRE_DEFAULTS`, never a new React Flow node type.
 *
 * **The colours are not the user's fill and stroke.** A wireframe reads as
 * layout rather than as design (Whimsical: "toned down, more transparent
 * colors by design… this helps keep wireframes semantic"), so each part is
 * painted from `WIRE_*`, with whatever colour the user picked mixed in at
 * `WIRE_TINT` / `WIRE_TINT_STROKE`. A component nobody has coloured is born
 * carrying the palette entry itself, and mixing a colour with itself is that
 * colour — so the mix is unconditional and there is no untinted branch.
 *
 * The label is `data.label`, exactly as a shape's is: double-click to open it,
 * blur to commit. That is what makes search, the typography controls and the
 * export find a wireframe's words with no special case.
 */
export function WireNode({ id, data, selected, parentId }: NodeProps<ShapeNodeType>) {
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
  const editingNodeId = useDiagramStore((s) => s.editingNodeId);
  const setEditingNodeId = useDiagramStore((s) => s.setEditingNodeId);
  const searchHit = useSearchHighlight('node', id);
  const peerSelection = usePeerSelection(id);
  const labelRef = useRef<HTMLDivElement>(null);

  const component = wireComponentOf(data);
  const editing = editingNodeId === id;

  useEffect(() => {
    if (!editing || !labelRef.current) return;
    labelRef.current.focus();
    const range = document.createRange();
    range.selectNodeContents(labelRef.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editing]);

  const commit = useCallback(() => {
    if (consumeSuppressBlur()) return;
    if (useDiagramStore.getState().editingNodeId === id) setEditingNodeId(null);
    updateNodeData(id, { label: labelRef.current?.innerText ?? '' });
  }, [id, setEditingNodeId, updateNodeData]);

  // Markdown renders in a paragraph and nowhere else: a button caption reading
  // as a bullet list would be a surprise, and a paragraph is the one component
  // that stands for a block of prose. Plain text never pays for a parse.
  const markdown = useMemo(
    () => (component === 'paragraph' && !editing && hasMarkdown(data.label) ? parseMarkdown(data.label) : null),
    [component, editing, data.label],
  );

  // `Diagram.data` is a free-form JSON column and the document is written by
  // other browsers: a node typed `wire` naming no component this build knows is
  // possible, and drawing nothing is the right answer — the same one `InkNode`
  // gives a stroke with no points.
  if (!component) return null;

  const stroke = wireTint(data.stroke, WIRE_STROKE, WIRE_TINT_STROKE);
  const fill = wireTint(data.fill, WIRE_FILL);
  const soft = wireTint(data.fill, WIRE_FILL_SOFT);
  const ink = data.textColor ?? WIRE_TEXT;
  const line = `${WIRE_LINE_PX}px solid ${stroke}`;
  const min = minSizeOf(component);
  const isLocked = !!data.locked;
  const typography = LABEL_DEFAULTS[component];

  const label = (extra?: React.CSSProperties) => (
    <div
      ref={labelRef}
      contentEditable={editing}
      suppressContentEditableWarning
      data-placeholder={labelPlaceholder(component)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') e.currentTarget.blur();
      }}
      className={clsx(
        'w-full break-words whitespace-pre-wrap leading-snug outline-none',
        editing && 'nodrag cursor-text',
      )}
      style={{
        fontSize: data.fontSize !== undefined ? resolveFontSize(data.fontSize) : typography.size,
        fontWeight: data.bold ? 700 : typography.weight,
        fontStyle: data.italic ? 'italic' : undefined,
        textDecoration:
          [data.underline && 'underline', data.strikethrough && 'line-through'].filter(Boolean).join(' ') ||
          undefined,
        textAlign: data.textAlign ?? typography.align,
        color: ink,
        opacity: typography.muted && !data.textColor ? 0.65 : undefined,
        ...extra,
      }}
    >
      {!editing && markdown ? <MarkdownLabel blocks={markdown} /> : data.label || null}
    </div>
  );

  /** The sketch itself. One case per component, in `WIRE_COMPONENTS` order. */
  const body = () => {
    switch (component) {
      case 'browser':
        return (
          <div
            className="flex h-full w-full flex-col overflow-hidden"
            style={{ background: soft, border: line, borderRadius: WIRE_RADIUS_PX + 2 }}
          >
            <div
              className="flex shrink-0 items-center gap-1.5 px-2"
              style={{ height: 28, background: fill, borderBottom: line }}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="block rounded-full"
                  style={{ width: 7, height: 7, background: stroke, opacity: 0.55 }}
                />
              ))}
              {/* The address field. A pill rather than a box, so it reads as a
                  browser at a glance and not as this wireframe's own input. */}
              <span
                className="ml-1.5 block flex-1 rounded-full"
                style={{ height: 12, background: soft, border: line }}
              />
            </div>
            <div className="flex-1" />
          </div>
        );

      case 'phone':
        return (
          <div
            className="relative h-full w-full"
            style={{ background: fill, border: line, borderRadius: 22 }}
          >
            <div
              className="absolute"
              style={{ inset: 6, background: soft, border: line, borderRadius: 16 }}
            />
            {/* The notch, drawn over the screen rather than cut out of it: a
                real cut-out would need a mask, and this reads the same. */}
            <span
              className="absolute left-1/2 -translate-x-1/2 rounded-b-full"
              style={{ top: 6, width: '34%', height: 10, background: stroke, opacity: 0.4 }}
            />
          </div>
        );

      case 'card':
        return (
          <div
            className="flex h-full w-full flex-col overflow-hidden"
            style={{ background: soft, border: line, borderRadius: WIRE_RADIUS_PX + 2 }}
          >
            <div style={{ height: '45%', background: fill, borderBottom: line }} />
            <div className="flex flex-1 flex-col justify-center gap-1.5 px-2.5">
              <span className="block rounded-sm" style={{ width: '70%', height: 8, background: stroke, opacity: 0.45 }} />
              <span className="block rounded-sm" style={{ width: '45%', height: 6, background: stroke, opacity: 0.3 }} />
            </div>
          </div>
        );

      case 'button':
        return (
          <div
            className="flex h-full w-full items-center justify-center px-3"
            style={{ background: fill, border: line, borderRadius: WIRE_RADIUS_PX }}
          >
            {label({ textAlign: data.textAlign ?? 'center' })}
          </div>
        );

      case 'input':
        return (
          <div
            className="flex h-full w-full items-center px-2.5"
            style={{ background: soft, border: line, borderRadius: WIRE_RADIUS_PX }}
          >
            {label()}
          </div>
        );

      case 'dropdown':
        return (
          <div
            className="flex h-full w-full items-center gap-2 px-2.5"
            style={{ background: fill, border: line, borderRadius: WIRE_RADIUS_PX }}
          >
            {label()}
            <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0" aria-hidden>
              <path d="M1 3.5 L5 7 L9 3.5" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        );

      case 'checkbox': {
        const checked = wireFlag(data, 'checked');
        return (
          <div className="flex h-full w-full items-center gap-2">
            <span
              className="relative block shrink-0"
              style={{ width: 16, height: 16, background: checked ? fill : soft, border: line, borderRadius: 3 }}
            >
              {checked && (
                <svg viewBox="0 0 16 16" className="absolute inset-0" aria-hidden>
                  <path d="M4 8.5 L7 11.5 L12 5" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            {label()}
          </div>
        );
      }

      case 'toggle': {
        const on = wireFlag(data, 'checked');
        return (
          <div className="flex h-full w-full items-center gap-2">
            <span
              className="relative block shrink-0"
              style={{ width: 30, height: 18, background: on ? fill : soft, border: line, borderRadius: 9 }}
            >
              <span
                className="absolute rounded-full"
                style={{
                  top: 2,
                  left: on ? undefined : 2,
                  right: on ? 2 : undefined,
                  width: 10,
                  height: 10,
                  background: stroke,
                  opacity: 0.7,
                }}
              />
            </span>
            {label()}
          </div>
        );
      }

      case 'heading':
      case 'paragraph':
      case 'link':
        // The three that are text and nothing else: no box, no ground, so they
        // sit on the board the way a text shape does.
        return (
          <div
            className={clsx(
              'flex h-full w-full',
              component === 'heading' ? 'items-center' : 'items-start',
            )}
          >
            {label(component === 'link' ? { textDecoration: 'underline' } : undefined)}
          </div>
        );

      case 'image':
        return (
          <div className="relative h-full w-full" style={{ background: fill, border: line, borderRadius: WIRE_RADIUS_PX }}>
            {/* The crossed rectangle every wireframe has meant by "a picture
                goes here" since long before this app. */}
            <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden>
              <path d="M0 0 L100 100 M100 0 L0 100" fill="none" stroke={stroke} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        );

      case 'avatar':
        return (
          <div
            className="relative h-full w-full overflow-hidden rounded-full"
            style={{ background: fill, border: line }}
          >
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 40 40" aria-hidden>
              <circle cx="20" cy="15" r="6.5" fill={stroke} opacity="0.55" />
              <path d="M6 38 a14 14 0 0 1 28 0 Z" fill={stroke} opacity="0.55" />
            </svg>
          </div>
        );

      case 'divider':
        return (
          <div className="flex h-full w-full items-center">
            <span className="block w-full" style={{ height: WIRE_LINE_PX, background: stroke }} />
          </div>
        );
    }
  };

  return (
    <div
      data-node-type="wire"
      data-wire={component}
      data-parent-id={parentId}
      data-search-hit={searchHit}
      data-peer-selected={peerSelection?.name}
      className={clsx('shape-wrapper relative h-full w-full', selected && 'is-selected')}
      style={{
        opacity: data.opacity,
        ...peerOutlineStyle(peerSelection),
        // An outline rather than a ring inside the box, as an ink stroke's is:
        // several components have no box of their own to draw a ring on, and a
        // wireframe that changed size when it was selected would be a bad joke.
        ...(selected ? { outline: '1.5px solid var(--color-accent-500)', outlineOffset: 2 } : {}),
      }}
      onDoubleClick={() => {
        if (!editing && !isLocked && hasLabel(component)) setEditingNodeId(id);
      }}
    >
      {body()}

      <NodeResizer
        isVisible={!!selected && !isLocked}
        minWidth={min.minWidth}
        minHeight={min.minHeight}
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

      {/* Connectors attach to a wireframe the way they attach to a shape —
          which is what an annotation pointing at one is. */}
      {HANDLES.map((h) => (
        <Handle key={h.id} id={h.id} type="source" position={h.position} className="shape-handle" style={h.style} />
      ))}
    </div>
  );
}
