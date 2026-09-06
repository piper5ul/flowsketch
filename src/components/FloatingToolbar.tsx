import { useLayoutEffect, useMemo, useState, useRef } from 'react';
import { getNodesBounds, useReactFlow, useViewport } from '@xyflow/react';
import {
  Trash2,
  CornerDownRight,
  ArrowRight,
  BringToFront,
  SendToBack,
  ChevronUp,
  ChevronDown,
  Link2,
  Tag,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { useDiagramStore } from '../store/useDiagramStore';
import { ColorPalette } from './ColorPalette';
import { ArrangeMenu } from './ArrangeMenu';
import { Tooltip } from './Tooltip';
import { DEFAULT_SWATCH } from '../lib/palette';
import { DEFAULT_EDGE_STROKE } from '../lib/defaults';
import type { StrokeStyle } from '../types';

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

function ArrowEndIcon({ side }: { side: 'start' | 'end' }) {
  const flip = side === 'start';
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ transform: flip ? 'scaleX(-1)' : undefined }}>
      <line x1="2" y1="9" x2="12" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <polygon points="12,4.5 17,9 12,13.5" fill="currentColor" />
    </svg>
  );
}

export function FloatingToolbar() {
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const updateSelectedNodesStyle = useDiagramStore((s) => s.updateSelectedNodesStyle);
  const updateSelectedEdgesStyle = useDiagramStore((s) => s.updateSelectedEdgesStyle);
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
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
    : selectedNodes[0]?.data?.stroke ?? DEFAULT_SWATCH.stroke;
  const connectorType = selectedEdges[0]?.data?.connectorType ?? 'elbow';
  const strokeStyle = selectedEdges[0]?.data?.strokeStyle ?? 'solid';
  const startArrow = selectedEdges[0]?.data?.startArrow ?? false;
  const endArrow = selectedEdges[0]?.data?.endArrow ?? true;

  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{ left: screenX, top: screenY, transform: 'translate(-50%, calc(-100% - 20px))' }}
    >
      <div className="panel-in pointer-events-auto flex items-center gap-1 rounded-2xl bg-ink-950/95 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)] backdrop-blur">
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

        {isEdgeMode && (
          <>
            <div className="mx-0.5 h-6 w-px bg-white/10" />
            <Tooltip label="Straight line" side="top">
              <button
                onClick={() => updateSelectedEdgesStyle({ connectorType: 'straight' })}
                className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white',
                  connectorType === 'straight' && 'bg-accent-500 text-white hover:bg-accent-500',
                )}
              >
                <ArrowRight size={16} />
              </button>
            </Tooltip>
            <Tooltip label="Elbow line" side="top">
              <button
                onClick={() => updateSelectedEdgesStyle({ connectorType: 'elbow' })}
                className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white',
                  connectorType === 'elbow' && 'bg-accent-500 text-white hover:bg-accent-500',
                )}
              >
                <CornerDownRight size={16} />
              </button>
            </Tooltip>

            <div className="mx-0.5 h-6 w-px bg-white/10" />
            {(['solid', 'dashed', 'dotted'] as StrokeStyle[]).map((s) => (
              <Tooltip key={s} label={s[0].toUpperCase() + s.slice(1)} side="top">
                <button
                  onClick={() => updateSelectedEdgesStyle({ strokeStyle: s })}
                  className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white',
                    strokeStyle === s && 'bg-accent-500 text-white hover:bg-accent-500',
                  )}
                >
                  <StrokeStyleIcon style={s} />
                </button>
              </Tooltip>
            ))}

            <div className="mx-0.5 h-6 w-px bg-white/10" />
            <Tooltip label="Start arrowhead" side="top">
              <button
                onClick={() => updateSelectedEdgesStyle({ startArrow: !startArrow })}
                className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white',
                  startArrow && 'bg-accent-500 text-white hover:bg-accent-500',
                )}
              >
                <ArrowEndIcon side="start" />
              </button>
            </Tooltip>
            <Tooltip label="End arrowhead" side="top">
              <button
                onClick={() => updateSelectedEdgesStyle({ endArrow: !endArrow })}
                className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white',
                  endArrow && 'bg-accent-500 text-white hover:bg-accent-500',
                )}
              >
                <ArrowEndIcon side="end" />
              </button>
            </Tooltip>

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
