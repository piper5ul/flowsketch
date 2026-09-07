import { useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import * as Popover from '@radix-ui/react-popover';
import {
  Trash2,
  CornerDownRight,
  ArrowRight,
  Link2,
  Shapes,
  RotateCcw,
  SlidersHorizontal,
  Spline,
  Tag,
  Type,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { canGroupSelection, useDiagramStore } from '../store/useDiagramStore';
import { toastInfo } from '../store/useToastStore';
import { formatShortcut, registry } from '../commands/commands';
import { DEFAULT_STYLE_KIND_LABELS, kindOf } from '../lib/defaultStyle';
import { ColorPalette } from './ColorPalette';
import { ArrangeMenu } from './ArrangeMenu';
import { TextFormatControls } from './TextFormatControls';
import type { TextFormatValue } from './TextFormatControls';
import { Tooltip } from './Tooltip';
import { DEFAULT_SWATCH } from '../lib/palette';
import { resolveFillStyle } from '../lib/shapeStyle';
import {
  CONNECTOR_STROKE_PX,
  DEFAULT_EDGE_STROKE,
  DEFAULT_END_ARROW,
  DEFAULT_START_ARROW,
  DEFAULT_STROKE_WIDTH,
} from '../lib/defaults';
import { canRoundCorners, canSwapShapeKind, isContainerNode, isGroupNode } from '../lib/nodeKinds';
import { DEFAULT_FONT_SIZE } from '../lib/text';
import { SHAPE_ICONS, SHAPE_LABELS, SWAPPABLE_SHAPE_KINDS } from '../lib/shapeIcons';
import type {
  ArrowStyle,
  ConnectorKind,
  FillStyle,
  ShapeData,
  ShapeKind,
  StrokeStyle,
  StrokeWidth,
} from '../types';

/** How far a corner can be rounded, and how transparent a shape can get. */
const CORNER_RADIUS_MAX = 40;
const OPACITY_MIN = 0.1;

/** The toolbar's icon button. */
const BUTTON_CLASS =
  'flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30';

/** The toolbar's icon button while it shows the value the selection already has. */
const ACTIVE_BUTTON_CLASS = 'bg-accent-500 text-white hover:bg-accent-500';

const CONNECTOR_KINDS: [ConnectorKind, LucideIcon, string][] = [
  ['straight', ArrowRight, 'Straight line'],
  ['elbow', CornerDownRight, 'Elbow line'],
  ['curved', Spline, 'Curved line'],
];

const STROKE_WIDTHS: [StrokeWidth, string][] = [
  [1, 'Thin line'],
  [2, 'Regular line'],
  [3, 'Bold line'],
];

const ARROW_STYLES: [ArrowStyle, string][] = [
  ['none', 'None'],
  ['arrow', 'Arrow'],
  ['open', 'Open'],
  ['circle', 'Circle'],
  ['diamond', 'Diamond'],
  ['bar', 'Bar'],
  ['halfcircle', 'Half circle'],
  ['dot', 'Dot'],
];

const STROKE_STYLE_DASH: Record<StrokeStyle, string | undefined> = {
  solid: undefined,
  dashed: '6 3.5',
  dotted: '1 4',
};

function StrokeStyleIcon({ style }: { style: StrokeStyle }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <line
        x1="2"
        y1="9"
        x2="16"
        y2="9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={STROKE_STYLE_DASH[style]}
      />
    </svg>
  );
}

function StrokeWidthIcon({ width }: { width: StrokeWidth }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <line
        x1="2"
        y1="9"
        x2="16"
        y2="9"
        stroke="currentColor"
        strokeWidth={CONNECTOR_STROKE_PX[width]}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The five arrowheads, drawn on a stub of line so the choice reads at a glance. */
function ArrowEndIcon({ style, side }: { style: ArrowStyle; side: 'start' | 'end' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ transform: side === 'start' ? 'scaleX(-1)' : undefined }}>
      <line
        x1="2"
        y1="9"
        x2={style === 'none' ? 16 : 12}
        y2="9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {style === 'arrow' && <polygon points="12,4.5 17,9 12,13.5" fill="currentColor" />}
      {style === 'open' && (
        <polyline
          points="12,4.5 16.5,9 12,13.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {style === 'circle' && <circle cx="13.5" cy="9" r="3.5" fill="currentColor" />}
      {style === 'diamond' && <polygon points="10,9 13.5,5.5 17,9 13.5,12.5" fill="currentColor" />}
      {style === 'bar' && <line x1="14.5" y1="4.5" x2="14.5" y2="13.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
      {style === 'halfcircle' && <path d="M 12 4.5 A 4.5 4.5 0 0 1 12 13.5 Z" fill="currentColor" />}
      {style === 'dot' && <circle cx="14.5" cy="9" r="2.5" fill="currentColor" />}
    </svg>
  );
}

/** A filled square and an outlined one: the two ways a shape can be painted. */
function FillStyleIcon({ variant }: { variant: FillStyle }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <rect
        x="2.75"
        y="2.75"
        width="10.5"
        height="10.5"
        rx="2.5"
        fill={variant === 'filled' ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/**
 * How a connector's line is drawn — three styles and three widths, six buttons
 * that were half the edge toolbar. The trigger draws the line the selection
 * actually wears, so the choice reads without opening it.
 */
function LinePopover({
  strokeStyle,
  strokeWidth,
  onChange,
}: {
  strokeStyle: StrokeStyle;
  strokeWidth: StrokeWidth;
  onChange: (patch: { strokeStyle?: StrokeStyle; strokeWidth?: StrokeWidth }) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip label="Line" side="top">
        <Popover.Trigger asChild>
          <button aria-label="Line" className={clsx(BUTTON_CLASS, 'data-[state=open]:bg-white/10 data-[state=open]:text-white')}>
            <svg width="18" height="18" viewBox="0 0 18 18">
              <line
                x1="2"
                y1="9"
                x2="16"
                y2="9"
                stroke="currentColor"
                strokeWidth={CONNECTOR_STROKE_PX[strokeWidth]}
                strokeLinecap="round"
                strokeDasharray={STROKE_STYLE_DASH[strokeStyle]}
              />
            </svg>
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          sideOffset={10}
          aria-label="Line"
          className="panel-in z-50 flex flex-col gap-1 rounded-xl bg-ink-950 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)]"
        >
          <div className="flex items-center gap-0.5">
            {(['solid', 'dashed', 'dotted'] as StrokeStyle[]).map((s) => (
              <Tooltip key={s} label={s[0].toUpperCase() + s.slice(1)} side="bottom">
                <button
                  onClick={() => onChange({ strokeStyle: s })}
                  className={clsx(BUTTON_CLASS, strokeStyle === s && ACTIVE_BUTTON_CLASS)}
                >
                  <StrokeStyleIcon style={s} />
                </button>
              </Tooltip>
            ))}
          </div>
          <div className="flex items-center gap-0.5">
            {STROKE_WIDTHS.map(([width, label]) => (
              <Tooltip key={width} label={label} side="bottom">
                <button
                  onClick={() => onChange({ strokeWidth: width })}
                  className={clsx(BUTTON_CLASS, strokeWidth === width && ACTIVE_BUTTON_CLASS)}
                >
                  <StrokeWidthIcon width={width} />
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

/**
 * The whole of `TextFormatControls`, behind one button.
 *
 * Twelve controls of typography were more than half the shape toolbar and are
 * not what a shape is usually selected for; folded away, the bar reads as the
 * handful of things that change what is *drawn*. The controls themselves are
 * the same component the format bar renders over a label being edited — this
 * only decides where they are shown.
 */
function TextPopover({
  value,
  onChange,
}: {
  value: TextFormatValue;
  onChange: (patch: Partial<TextFormatValue>) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip label="Text" side="top">
        <Popover.Trigger asChild>
          <button aria-label="Text" className={clsx(BUTTON_CLASS, 'data-[state=open]:bg-white/10 data-[state=open]:text-white')}>
            <Type size={16} />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          sideOffset={10}
          aria-label="Text"
          className="panel-in z-50 flex items-center gap-0.5 rounded-xl bg-ink-950 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)]"
        >
          <TextFormatControls value={value} onChange={onChange} />
          <Popover.Arrow className="fill-ink-950" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * One end's arrowhead. Five styles is more than the toolbar has room for
 * twice over, so each end keeps its single button and opens the choice below
 * it — the button itself showing what that end currently wears.
 */
function ArrowStylePicker({
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
      <Tooltip label={label} side="top">
        <Popover.Trigger asChild>
          <button aria-label={label} className={clsx(BUTTON_CLASS, value !== 'none' && ACTIVE_BUTTON_CLASS)}>
            <ArrowEndIcon style={value} side={side} />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          sideOffset={10}
          className="panel-in z-50 flex items-center gap-0.5 rounded-xl bg-ink-950 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)]"
        >
          {ARROW_STYLES.map(([style, styleLabel]) => (
            <button
              key={style}
              aria-label={styleLabel}
              title={styleLabel}
              onClick={() => {
                onChange(style);
                setOpen(false);
              }}
              className={clsx(BUTTON_CLASS, value === style && ACTIVE_BUTTON_CLASS)}
            >
              <ArrowEndIcon style={style} side={side} />
            </button>
          ))}
          <Popover.Arrow className="fill-ink-950" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The keystroke the "Save as default style" entry reads out, taken from the
 * registry rather than typed here: the shortcut lives in `src/commands`, and a
 * second spelling of it is a second thing to keep in step.
 */
const saveDefaultShortcut = formatShortcut(registry.find('style.saveDefault')?.shortcut);

/** The Style popover's slider: a labelled range that reads its own value out. */
function StyleSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onPreview,
  onCommit,
  onDragStart,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  onDragStart: () => void;
}) {
  const dragging = useRef(false);

  return (
    <label className="flex flex-col gap-1 px-1 py-1">
      <span className="flex items-center justify-between text-[11px] font-medium text-white/60">
        {label}
        <span className="tabular-nums text-white/80">{format(value)}</span>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        // A drag is one edit: the entry goes in when the thumb is grabbed and
        // every frame after it is transient. A change that arrives without a
        // pointer — the arrow keys, or a test setting the value — is a discrete
        // edit of its own and commits on the spot.
        onPointerDown={() => {
          dragging.current = true;
          onDragStart();
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onLostPointerCapture={() => {
          dragging.current = false;
        }}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (dragging.current) onPreview(next);
          else onCommit(next);
        }}
        className="h-1.5 w-40 cursor-pointer appearance-none rounded-full bg-white/15 accent-accent-500"
      />
    </label>
  );
}

/**
 * Corner radius, opacity and the drop shadow — the three that say how a shape
 * is drawn rather than what colour it is, and the three there is no room for on
 * the bar itself.
 */
function StylePopover({
  cornerRadius,
  opacity,
  shadow,
  showCornerRadius,
  onPreview,
  onCommit,
  onDragStart,
  onSaveDefault,
}: {
  cornerRadius: number;
  opacity: number;
  shadow: boolean;
  showCornerRadius: boolean;
  onPreview: (patch: Partial<ShapeData>) => void;
  onCommit: (patch: Partial<ShapeData>) => void;
  onDragStart: () => void;
  /** Offered only for a single shape — "make *this* the default" needs a this. */
  onSaveDefault: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip label="Style" side="top">
        <Popover.Trigger asChild>
          <button aria-label="Style" className={BUTTON_CLASS}>
            <SlidersHorizontal size={16} />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          sideOffset={10}
          aria-label="Style"
          className="panel-in z-50 flex w-52 flex-col gap-1 rounded-xl bg-ink-950 p-2 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)]"
        >
          {showCornerRadius && (
            <StyleSlider
              label="Corner radius"
              value={cornerRadius}
              min={0}
              max={CORNER_RADIUS_MAX}
              step={1}
              format={(v) => `${v}px`}
              onDragStart={onDragStart}
              onPreview={(v) => onPreview({ cornerRadius: v })}
              onCommit={(v) => onCommit({ cornerRadius: v })}
            />
          )}
          <StyleSlider
            label="Opacity"
            value={opacity}
            min={OPACITY_MIN}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onDragStart={onDragStart}
            onPreview={(v) => onPreview({ opacity: v })}
            onCommit={(v) => onCommit({ opacity: v })}
          />
          <button
            onClick={() => onCommit({ shadow: !shadow })}
            className={clsx(
              'mt-0.5 flex items-center justify-between rounded-lg px-2 py-1.5 text-[12px] font-medium text-white/85 transition hover:bg-white/10',
              shadow && 'bg-accent-500/90 text-white hover:bg-accent-500',
            )}
          >
            Drop shadow
            <span className="text-[11px] text-white/60">{shadow ? 'On' : 'Off'}</span>
          </button>
          {/* The keyboard has ⌘⇧D and the right-click menu has an entry; this
              is where somebody who has just finished styling a shape with the
              mouse is already looking. */}
          {onSaveDefault && (
            <>
              <div className="my-0.5 h-px bg-white/10" />
              <button
                onClick={() => {
                  onSaveDefault();
                  // Closed on the way out: the toast is the confirmation, and a
                  // popover left standing over the shape hides what was saved.
                  setOpen(false);
                }}
                className="flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] font-medium text-white/85 transition hover:bg-white/10"
              >
                Save as default style
                <span className="text-[11px] text-white/40">{saveDefaultShortcut}</span>
              </button>
            </>
          )}
          <Popover.Arrow className="fill-ink-950" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Redraws the selection as a different kind of shape. The trigger wears the
 * kind it would change *away* from, so the button reads as the current shape
 * rather than as an anonymous menu; a selection holding more than one kind has
 * no such answer and falls back to the generic icon.
 */
function ShapePicker({ current, onPick }: { current: ShapeKind | null; onPick: (kind: ShapeKind) => void }) {
  const [open, setOpen] = useState(false);
  const TriggerIcon = current ? SHAPE_ICONS[current] : Shapes;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip label="Shape" side="top">
        <Popover.Trigger asChild>
          <button className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white data-[state=open]:bg-white/10 data-[state=open]:text-white">
            <TriggerIcon size={16} />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={12}
          aria-label="Shape picker"
          className="panel-in z-50 rounded-2xl bg-ink-950 p-1.5 shadow-[0_20px_45px_-12px_rgba(10,10,25,0.55)]"
        >
          <div className="grid grid-cols-4 gap-0.5">
            {SWAPPABLE_SHAPE_KINDS.map((kind) => {
              const Icon = SHAPE_ICONS[kind];
              return (
                <Tooltip key={kind} label={SHAPE_LABELS[kind]} side="top">
                  <button
                    onClick={() => {
                      onPick(kind);
                      setOpen(false);
                    }}
                    className={clsx(
                      'flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white',
                      current === kind && 'bg-accent-500 text-white hover:bg-accent-500',
                    )}
                  >
                    <Icon size={16} />
                  </button>
                </Tooltip>
              );
            })}
          </div>
          <Popover.Arrow className="fill-ink-950" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function FloatingToolbar() {
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const updateSelectedNodesStyle = useDiagramStore((s) => s.updateSelectedNodesStyle);
  const updateSelectedEdgesStyle = useDiagramStore((s) => s.updateSelectedEdgesStyle);
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
  const updateSelectedNodesData = useDiagramStore((s) => s.updateSelectedNodesData);
  const updateSelectedNodesDataTransient = useDiagramStore((s) => s.updateSelectedNodesDataTransient);
  const beginInteraction = useDiagramStore((s) => s.beginInteraction);
  const setSelectedShapeKind = useDiagramStore((s) => s.setSelectedShapeKind);
  const setEditingEdgeId = useDiagramStore((s) => s.setEditingEdgeId);
  const deleteSelection = useDiagramStore((s) => s.deleteSelection);
  const saveSelectionAsDefault = useDiagramStore((s) => s.saveSelectionAsDefault);
  // Z order, grouping and the lock are read by `ArrangeMenu` itself — this bar
  // only tells it what the selection is, so the popover owns the whole of what
  // "arrange" means.
  const viewport = useViewport();
  // The hook's `getNodesBounds`, not the bare export: only this one can see the
  // node lookup, and a node inside a container holds a position relative to it —
  // the bare one would park the toolbar near the origin instead of over the shape.
  const { screenToFlowPosition, getNodesBounds } = useReactFlow();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);
  // The K shortcut: same as pressing the link button.
  const linkEditorRequest = useDiagramStore((s) => s.linkEditorRequest);
  useEffect(() => {
    if (!linkEditorRequest || isEdgeMode || selectedNodes.length !== 1) return;
    setLinkValue(selectedNodes[0]?.data?.link ?? '');
    setLinkOpen(true);
    setTimeout(() => linkInputRef.current?.focus(), 50);
    // Only the request should reopen it, not every re-render of the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkEditorRequest]);

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const selectedEdges = useMemo(() => edges.filter((e) => e.selected), [edges]);
  // An image carries no label, fill or stroke of its own — `updateSelectedNodesData`
  // and `updateSelectedNodesStyle` both skip it. So a selection of nothing but
  // images gets neither the text controls nor the colour palette; one that also
  // holds a real shape gets both, and they apply to that shape.
  // A container paints itself from the theme rather than from a fill and a
  // stroke, so it sits the colour and text controls out alongside images.
  const styleableNodes = useMemo(
    () => selectedNodes.filter((n) => n.data.shape !== 'image' && !isContainerNode(n)),
    [selectedNodes],
  );
  // A frame takes a colour (a toned-down one — see `FrameNode`) though none of
  // the other shape controls; a group draws nothing and takes none.
  const colourableNodes = useMemo(
    () => selectedNodes.filter((n) => n.data.shape !== 'image' && !isGroupNode(n)),
    [selectedNodes],
  );
  const canGroup = useMemo(() => canGroupSelection(nodes), [nodes]);
  const hasGroup = useMemo(() => selectedNodes.some(isGroupNode), [selectedNodes]);
  // The shapes `setSelectedShapeKind` would actually redraw, so the button is
  // offered exactly when pressing it would do something.
  const swappableNodes = useMemo(() => selectedNodes.filter((n) => canSwapShapeKind(n.data)), [selectedNodes]);
  const currentShapeKind = useMemo(() => {
    const first = swappableNodes[0]?.data.shape ?? null;
    return swappableNodes.every((n) => n.data.shape === first) ? first : null;
  }, [swappableNodes]);

  // An elbow connector can route (and its drag handles can sit) well above/below
  // its endpoints, so measure the actual rendered path rather than assuming it
  // stays within the source/target nodes' bounds — otherwise the toolbar can end
  // up sitting on top of the very handles the user is trying to grab.
  const selectedEdgeId = selectedEdges[0]?.id;
  const [edgePathTopFlowY, setEdgePathTopFlowY] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!selectedEdgeId) {
      setEdgePathTopFlowY(null);
      return;
    }
    const el = document.querySelector(`[data-testid="rf__edge-${selectedEdgeId}"]`);
    if (!el) {
      setEdgePathTopFlowY(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const topLeft = screenToFlowPosition({ x: rect.left, y: rect.top });
    setEdgePathTopFlowY(topLeft.y);
  }, [selectedEdgeId, nodes, viewport, screenToFlowPosition]);

  const anchor = useMemo(() => {
    if (selectedNodes.length > 0) {
      const bounds = getNodesBounds(selectedNodes);
      return { x: bounds.x + bounds.width / 2, y: bounds.y };
    }
    if (selectedEdges.length > 0) {
      const edge = selectedEdges[0];
      const source = nodes.find((n) => n.id === edge.source);
      const target = nodes.find((n) => n.id === edge.target);
      if (source && target) {
        const sx = source.position.x + (source.measured?.width ?? 100) / 2;
        const sy = source.position.y + (source.measured?.height ?? 60) / 2;
        const tx = target.position.x + (target.measured?.width ?? 100) / 2;
        const ty = target.position.y + (target.measured?.height ?? 60) / 2;
        const naturalTop = Math.min(sy, ty);
        const top = edgePathTopFlowY !== null ? Math.min(naturalTop, edgePathTopFlowY) : naturalTop;
        return { x: (sx + tx) / 2, y: top };
      }
    }
    return null;
  }, [selectedNodes, selectedEdges, nodes, edgePathTopFlowY, getNodesBounds]);

  const editingNodeId = useDiagramStore((s) => s.editingNodeId);
  const editingEdgeId = useDiagramStore((s) => s.editingEdgeId);
  if (!anchor || editingNodeId || editingEdgeId) return null;

  const screenX = anchor.x * viewport.zoom + viewport.x;
  const screenY = anchor.y * viewport.zoom + viewport.y;

  const isEdgeMode = selectedNodes.length === 0 && selectedEdges.length > 0;
  const activeStroke = isEdgeMode
    ? selectedEdges[0]?.data?.stroke ?? DEFAULT_EDGE_STROKE
    : styleableNodes[0]?.data?.stroke ?? DEFAULT_SWATCH.stroke;
  const connectorType = selectedEdges[0]?.data?.connectorType ?? 'elbow';
  const strokeStyle = selectedEdges[0]?.data?.strokeStyle ?? 'solid';
  const strokeWidth = selectedEdges[0]?.data?.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  const startArrowStyle = selectedEdges[0]?.data?.startArrowStyle ?? DEFAULT_START_ARROW;
  const endArrowStyle = selectedEdges[0]?.data?.endArrowStyle ?? DEFAULT_END_ARROW;
  // Only a dragged bend can be reset, so the button is dead weight without one.
  const hasWaypoints = selectedEdges.some((e) => (e.data?.waypoints?.length ?? 0) > 0);
  // Which of the two paint styles the selection wears, or `null` when it is
  // holding both — neither button is lit then, and pressing one settles it.
  const firstStyleable = styleableNodes[0];
  const fillStyle: FillStyle | null =
    firstStyleable &&
    styleableNodes.every((n) => resolveFillStyle(n.data) === resolveFillStyle(firstStyleable.data))
      ? resolveFillStyle(firstStyleable.data)
      : null;
  const locked = selectedNodes.some((n) => n.data.locked);
  // One shape, and one this build can copy a style off — the same question the
  // `style.saveDefault` command's `when` asks, so the bar never offers a button
  // the keystroke would refuse.
  const canSaveDefault =
    selectedEdges.length === 0 && selectedNodes.length === 1 && kindOf(selectedNodes[0]) !== null;
  const saveDefault = () => {
    const kind = saveSelectionAsDefault();
    if (kind) toastInfo(`Saved as default for ${DEFAULT_STYLE_KIND_LABELS[kind]} on this board`);
  };

  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{ left: screenX, top: screenY, transform: 'translate(-50%, calc(-100% - 20px))' }}
    >
      {/* Named, because several of its buttons share a label with the rail's
          tools — "Text" opens the typography popover here and picks the text
          tool there — and a name is what tells the two apart. */}
      <div
        role="toolbar"
        aria-label="Selection toolbar"
        className="panel-in pointer-events-auto flex items-center gap-0.5 rounded-xl bg-ink-950/95 ring-1 ring-white/[0.07] p-1 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)] backdrop-blur"
      >
        {/* Typography, folded away: a shape is selected to be moved, coloured
            or reshaped far more often than to be re-typeset. */}
        {styleableNodes.length > 0 && (
          <TextPopover
            value={{
              fontSize: styleableNodes[0].data.fontSize ?? DEFAULT_FONT_SIZE,
              bold: styleableNodes[0].data.bold ?? false,
              italic: styleableNodes[0].data.italic ?? false,
              underline: styleableNodes[0].data.underline ?? false,
              strikethrough: styleableNodes[0].data.strikethrough ?? false,
              textColor: styleableNodes[0].data.textColor,
              textAlign:
                styleableNodes[0].data.textAlign ??
                (styleableNodes[0].data.shape === 'text' ? 'left' : 'center'),
              verticalAlign: styleableNodes[0].data.verticalAlign ?? 'middle',
            }}
            // The patch lands on every selected shape, images excepted — which
            // is what makes the popover work for a multi-selection unchanged.
            onChange={updateSelectedNodesData}
          />
        )}

        {(isEdgeMode || colourableNodes.length > 0) && (
          <ColorPalette
            activeStroke={activeStroke}
            onSelect={(swatch) => {
              if (isEdgeMode) {
                updateSelectedEdgesStyle({ stroke: swatch.stroke });
              } else {
                updateSelectedNodesStyle({ fill: swatch.fill, stroke: swatch.stroke });
              }
            }}
          />
        )}

        {swappableNodes.length > 0 && <ShapePicker current={currentShapeKind} onPick={setSelectedShapeKind} />}

        {/* Which of the two colours the swatch above carries is drawn. Two
            buttons rather than one toggle: the pair says what the choice *is*
            without the user having to press it to find out. */}
        {styleableNodes.length > 0 && (
          <>
            <div className="mx-0.5 h-5 w-px bg-white/10" />
            {(['filled', 'outline'] as FillStyle[]).map((style) => (
              <Tooltip key={style} label={style === 'filled' ? 'Filled' : 'Outline'} side="top">
                <button
                  aria-label={style === 'filled' ? 'Filled' : 'Outline'}
                  onClick={() => updateSelectedNodesData({ fillStyle: style })}
                  className={clsx(BUTTON_CLASS, fillStyle === style && ACTIVE_BUTTON_CLASS)}
                >
                  <FillStyleIcon variant={style} />
                </button>
              </Tooltip>
            ))}
          </>
        )}

        {isEdgeMode && (
          <>
            <div className="mx-0.5 h-5 w-px bg-white/10" />
            {CONNECTOR_KINDS.map(([kind, Icon, label]) => (
              <Tooltip key={kind} label={label} side="top">
                <button
                  onClick={() => updateSelectedEdgesStyle({ connectorType: kind })}
                  className={clsx(BUTTON_CLASS, connectorType === kind && ACTIVE_BUTTON_CLASS)}
                >
                  <Icon size={16} />
                </button>
              </Tooltip>
            ))}

            <div className="mx-0.5 h-5 w-px bg-white/10" />
            <LinePopover
              strokeStyle={strokeStyle}
              strokeWidth={strokeWidth}
              onChange={updateSelectedEdgesStyle}
            />
            <ArrowStylePicker
              side="start"
              value={startArrowStyle}
              onChange={(startArrowStyle) => updateSelectedEdgesStyle({ startArrowStyle })}
            />
            <ArrowStylePicker
              side="end"
              value={endArrowStyle}
              onChange={(endArrowStyle) => updateSelectedEdgesStyle({ endArrowStyle })}
            />

            <div className="mx-0.5 h-5 w-px bg-white/10" />
            <Tooltip label="Add label" shortcut="↵" side="top">
              <button aria-label="Add label" onClick={() => setEditingEdgeId(selectedEdges[0].id)} className={BUTTON_CLASS}>
                <Tag size={16} />
              </button>
            </Tooltip>
            {/* Only a dragged bend can be reset, so without one the button is
                not greyed out but gone: nothing was routed to undo. */}
            {hasWaypoints && (
              <Tooltip label="Reset route" side="top">
                <button
                  aria-label="Reset route"
                  onClick={() => updateSelectedEdgesStyle({ waypoints: [] })}
                  className={BUTTON_CLASS}
                >
                  <RotateCcw size={16} />
                </button>
              </Tooltip>
            )}
          </>
        )}

        {!isEdgeMode && (
          <>
            <div className="mx-0.5 h-5 w-px bg-white/10" />
            <ArrangeMenu
              selectedCount={selectedNodes.length}
              canGroup={canGroup}
              hasGroup={hasGroup}
              locked={locked}
            />
          </>
        )}

        {styleableNodes.length > 0 && (
          <StylePopover
            cornerRadius={styleableNodes[0].data.cornerRadius ?? 0}
            opacity={styleableNodes[0].data.opacity ?? 1}
            shadow={styleableNodes[0].data.shadow ?? false}
            // Only offered when every shape in the selection has corners to
            // round; an ellipse in the mix would sit through the whole drag.
            showCornerRadius={styleableNodes.every((n) => canRoundCorners(n.data.shape))}
            onDragStart={beginInteraction}
            onPreview={updateSelectedNodesDataTransient}
            onCommit={updateSelectedNodesData}
            onSaveDefault={canSaveDefault ? saveDefault : null}
          />
        )}

        {!isEdgeMode && selectedNodes.length === 1 && (
          <>
            <div className="mx-0.5 h-5 w-px bg-white/10" />
            <Tooltip label="Add link" side="top">
              <button
                aria-label="Add link"
                onClick={() => {
                  const link = selectedNodes[0]?.data?.link ?? '';
                  setLinkValue(link);
                  setLinkOpen((v) => !v);
                  setTimeout(() => linkInputRef.current?.focus(), 50);
                }}
                className={clsx(BUTTON_CLASS, selectedNodes[0]?.data?.link && ACTIVE_BUTTON_CLASS)}
              >
                <Link2 size={16} />
              </button>
            </Tooltip>
          </>
        )}

        <div className="mx-0.5 h-5 w-px bg-white/10" />
        <Tooltip label="Delete" shortcut="⌫" side="top">
          <button
            aria-label="Delete"
            onClick={deleteSelection}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-red-500/20 hover:text-red-400"
          >
            <Trash2 size={16} />
          </button>
        </Tooltip>
      </div>
      {linkOpen && selectedNodes.length === 1 && (
        <div className="panel-in mt-1.5 flex items-center gap-1 rounded-xl bg-ink-950/95 ring-1 ring-white/[0.07] p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)] backdrop-blur">
          <input
            ref={linkInputRef}
            type="url"
            placeholder="https://..."
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateNodeData(selectedNodes[0].id, { link: linkValue || undefined });
                setLinkOpen(false);
              }
              if (e.key === 'Escape') setLinkOpen(false);
            }}
            className="w-48 rounded-lg bg-white/10 px-2 py-1.5 text-[13px] text-white outline-none placeholder:text-white/30 focus:bg-white/15"
          />
          {linkValue && (
            <button
              onClick={() => {
                setLinkValue('');
                updateNodeData(selectedNodes[0].id, { link: undefined });
                setLinkOpen(false);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
