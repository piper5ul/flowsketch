import { useLayoutEffect, useMemo, useState, useRef } from 'react';
import { getNodesBounds, useReactFlow, useViewport } from '@xyflow/react';
import * as Popover from '@radix-ui/react-popover';
import {
  Trash2,
  CornerDownRight,
  ArrowRight,
  BringToFront,
  SendToBack,
  ChevronUp,
  ChevronDown,
  Link2,
  Shapes,
  RotateCcw,
  Spline,
  Tag,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useDiagramStore } from '../store/useDiagramStore';
import { ColorPalette } from './ColorPalette';
import { ArrangeMenu } from './ArrangeMenu';
import { TextFormatControls } from './TextFormatControls';
import { Tooltip } from './Tooltip';
import { DEFAULT_SWATCH } from '../lib/palette';
import {
  CONNECTOR_STROKE_PX,
  DEFAULT_EDGE_STROKE,
  DEFAULT_END_ARROW,
  DEFAULT_START_ARROW,
  DEFAULT_STROKE_WIDTH,
} from '../lib/defaults';
import { canSwapShapeKind } from '../lib/nodeKinds';
import { SHAPE_ICONS, SHAPE_LABELS, SWAPPABLE_SHAPE_KINDS } from '../lib/shapeIcons';
import type { ArrowStyle, ConnectorKind, ShapeKind, StrokeStyle, StrokeWidth } from '../types';

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
    </svg>
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
  const setSelectedShapeKind = useDiagramStore((s) => s.setSelectedShapeKind);
  const setEditingEdgeId = useDiagramStore((s) => s.setEditingEdgeId);
  const deleteSelection = useDiagramStore((s) => s.deleteSelection);
  const bringToFront = useDiagramStore((s) => s.bringToFront);
  const sendToBack = useDiagramStore((s) => s.sendToBack);
  const bringForward = useDiagramStore((s) => s.bringForward);
  const sendBackward = useDiagramStore((s) => s.sendBackward);
  const viewport = useViewport();
  const { screenToFlowPosition } = useReactFlow();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const selectedEdges = useMemo(() => edges.filter((e) => e.selected), [edges]);
  // An image carries no label, fill or stroke of its own — `updateSelectedNodesData`
  // and `updateSelectedNodesStyle` both skip it. So a selection of nothing but
  // images gets neither the text controls nor the colour palette; one that also
  // holds a real shape gets both, and they apply to that shape.
  const styleableNodes = useMemo(() => selectedNodes.filter((n) => n.data.shape !== 'image'), [selectedNodes]);
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
  }, [selectedNodes, selectedEdges, nodes, edgePathTopFlowY]);

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
  const hasWaypoint = selectedEdges.some((e) => e.data?.waypoint);

  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{ left: screenX, top: screenY, transform: 'translate(-50%, calc(-100% - 20px))' }}
    >
      <div className="panel-in pointer-events-auto flex items-center gap-1 rounded-2xl bg-ink-950/95 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)] backdrop-blur">
        {(isEdgeMode || styleableNodes.length > 0) && (
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

        {swappableNodes.length > 0 && (
          <>
            <div className="mx-0.5 h-6 w-px bg-white/10" />
            <ShapePicker current={currentShapeKind} onPick={setSelectedShapeKind} />
          </>
        )}

        {isEdgeMode && (
          <>
            <div className="mx-0.5 h-6 w-px bg-white/10" />
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
            <Tooltip label="Reset route" side="top">
              <button
                aria-label="Reset route"
                onClick={() => updateSelectedEdgesStyle({ waypoint: null })}
                disabled={!hasWaypoint}
                className={BUTTON_CLASS}
              >
                <RotateCcw size={16} />
              </button>
            </Tooltip>

            <div className="mx-0.5 h-6 w-px bg-white/10" />
            {(['solid', 'dashed', 'dotted'] as StrokeStyle[]).map((s) => (
              <Tooltip key={s} label={s[0].toUpperCase() + s.slice(1)} side="top">
                <button
                  onClick={() => updateSelectedEdgesStyle({ strokeStyle: s })}
                  className={clsx(BUTTON_CLASS, strokeStyle === s && ACTIVE_BUTTON_CLASS)}
                >
                  <StrokeStyleIcon style={s} />
                </button>
              </Tooltip>
            ))}

            <div className="mx-0.5 h-6 w-px bg-white/10" />
            {STROKE_WIDTHS.map(([width, label]) => (
              <Tooltip key={width} label={label} side="top">
                <button
                  onClick={() => updateSelectedEdgesStyle({ strokeWidth: width })}
                  className={clsx(BUTTON_CLASS, strokeWidth === width && ACTIVE_BUTTON_CLASS)}
                >
                  <StrokeWidthIcon width={width} />
                </button>
              </Tooltip>
            ))}

            <div className="mx-0.5 h-6 w-px bg-white/10" />
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

            <div className="mx-0.5 h-6 w-px bg-white/10" />
            <Tooltip label="Add label" shortcut="↵" side="top">
              <button
                onClick={() => setEditingEdgeId(selectedEdges[0].id)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                <Tag size={16} />
              </button>
            </Tooltip>
          </>
        )}

        {styleableNodes.length > 0 && (
          <>
            <div className="mx-0.5 h-6 w-px bg-white/10" />
            <TextFormatControls
              value={{
                fontSize: styleableNodes[0].data.fontSize ?? 'medium',
                bold: styleableNodes[0].data.bold ?? false,
                italic: styleableNodes[0].data.italic ?? false,
                underline: styleableNodes[0].data.underline ?? false,
                strikethrough: styleableNodes[0].data.strikethrough ?? false,
                textColor: styleableNodes[0].data.textColor,
                textAlign: styleableNodes[0].data.textAlign ?? (styleableNodes[0].data.shape === 'text' ? 'left' : 'center'),
                verticalAlign: styleableNodes[0].data.verticalAlign ?? 'middle',
              }}
              onChange={updateSelectedNodesData}
            />
          </>
        )}

        {!isEdgeMode && (
          <>
            <div className="mx-0.5 h-6 w-px bg-white/10" />
            <Tooltip label="Bring forward" side="top">
              <button
                onClick={bringForward}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                <ChevronUp size={16} />
              </button>
            </Tooltip>
            <Tooltip label="Send backward" side="top">
              <button
                onClick={sendBackward}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                <ChevronDown size={16} />
              </button>
            </Tooltip>
            <Tooltip label="Bring to front" side="top">
              <button
                onClick={bringToFront}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                <BringToFront size={16} />
              </button>
            </Tooltip>
            <Tooltip label="Send to back" side="top">
              <button
                onClick={sendToBack}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                <SendToBack size={16} />
              </button>
            </Tooltip>
          </>
        )}

        {!isEdgeMode && selectedNodes.length > 1 && (
          <>
            <div className="mx-0.5 h-6 w-px bg-white/10" />
            <ArrangeMenu selectedCount={selectedNodes.length} />
          </>
        )}

        {!isEdgeMode && selectedNodes.length === 1 && (
          <>
            <div className="mx-0.5 h-6 w-px bg-white/10" />
            <Tooltip label="Add link" side="top">
              <button
                onClick={() => {
                  const link = selectedNodes[0]?.data?.link ?? '';
                  setLinkValue(link);
                  setLinkOpen((v) => !v);
                  setTimeout(() => linkInputRef.current?.focus(), 50);
                }}
                className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white',
                  selectedNodes[0]?.data?.link && 'bg-accent-500 text-white hover:bg-accent-500',
                )}
              >
                <Link2 size={16} />
              </button>
            </Tooltip>
          </>
        )}

        <div className="mx-0.5 h-6 w-px bg-white/10" />
        <Tooltip label="Delete" shortcut="⌫" side="top">
          <button
            onClick={deleteSelection}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-red-500/20 hover:text-red-400"
          >
            <Trash2 size={16} />
          </button>
        </Tooltip>
      </div>
      {linkOpen && selectedNodes.length === 1 && (
        <div className="panel-in mt-1.5 flex items-center gap-1 rounded-xl bg-ink-950/95 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)] backdrop-blur">
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
