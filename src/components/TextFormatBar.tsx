import { useMemo } from 'react';
import { getNodesBounds, useViewport } from '@xyflow/react';
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
import { useDiagramStore, suppressNextBlurCommit } from '../store/useDiagramStore';
import { Tooltip } from './Tooltip';
import type { FontSize, TextAlign, VerticalAlign } from '../types';

const FONT_SIZES: FontSize[] = ['small', 'medium', 'large'];
const FONT_SIZE_LABEL: Record<FontSize, string> = { small: 'S', medium: 'M', large: 'L' };

export function TextFormatBar() {
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const editingNodeId = useDiagramStore((s) => s.editingNodeId);
  const editingEdgeId = useDiagramStore((s) => s.editingEdgeId);
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
  const updateEdgeData = useDiagramStore((s) => s.updateEdgeData);
  const viewport = useViewport();

  const editingNode = useMemo(
    () => (editingNodeId ? nodes.find((n) => n.id === editingNodeId) : null),
    [nodes, editingNodeId],
  );

  const editingEdge = useMemo(
    () => (editingEdgeId ? edges.find((e) => e.id === editingEdgeId) : null),
    [edges, editingEdgeId],
  );

  const isEdge = !!editingEdge;

  // Get formatting state from either node or edge
  const fontSize: FontSize = isEdge
    ? (editingEdge?.data?.labelFontSize ?? 'medium')
    : (editingNode?.data.fontSize ?? 'medium');
  const bold = isEdge
    ? (editingEdge?.data?.labelBold ?? false)
    : (editingNode?.data.bold ?? false);
  const italic = isEdge
    ? (editingEdge?.data?.labelItalic ?? false)
    : (editingNode?.data.italic ?? false);
  const textAlign: TextAlign = isEdge
    ? 'center'
    : (editingNode?.data.textAlign ?? (editingNode?.data.shape === 'text' ? 'left' : 'center'));
  const verticalAlign: VerticalAlign = isEdge
    ? 'middle'
    : (editingNode?.data.verticalAlign ?? 'middle');

  const anchor = useMemo(() => {
    if (editingNode) {
      const bounds = getNodesBounds([editingNode]);
      return { x: bounds.x + bounds.width / 2, y: bounds.y };
    }
    if (editingEdge) {
      const source = nodes.find((n) => n.id === editingEdge.source);
      const target = nodes.find((n) => n.id === editingEdge.target);
      if (source && target) {
        const sx = source.position.x + (source.measured?.width ?? 100) / 2;
        const sy = source.position.y + (source.measured?.height ?? 60) / 2;
        const tx = target.position.x + (target.measured?.width ?? 100) / 2;
        const ty = target.position.y + (target.measured?.height ?? 60) / 2;
        return { x: (sx + tx) / 2, y: Math.min(sy, ty) - 20 };
      }
    }
    return null;
  }, [editingNode, editingEdge, nodes]);

  if (!anchor || (!editingNode && !editingEdge)) return null;

  const screenX = anchor.x * viewport.zoom + viewport.x;
  const screenY = anchor.y * viewport.zoom + viewport.y;

  const sizeIndex = FONT_SIZES.indexOf(fontSize);
  const entityId = isEdge ? editingEdge!.id : editingNode!.id;

  const cycleSize = (dir: -1 | 1) => {
    const next = FONT_SIZES[Math.max(0, Math.min(FONT_SIZES.length - 1, sizeIndex + dir))];
    if (isEdge) updateEdgeData(entityId, { labelFontSize: next });
    else updateNodeData(entityId, { fontSize: next });
  };

  const toggleBold = () => {
    if (isEdge) updateEdgeData(entityId, { labelBold: !bold });
    else updateNodeData(entityId, { bold: !bold });
  };

  const toggleItalic = () => {
    if (isEdge) updateEdgeData(entityId, { labelItalic: !italic });
    else updateNodeData(entityId, { italic: !italic });
  };

  const setAlign = (align: TextAlign) => {
    if (!isEdge) updateNodeData(entityId, { textAlign: align });
  };

  const setVerticalAlign = (align: VerticalAlign) => {
    if (!isEdge) updateNodeData(entityId, { verticalAlign: align });
  };

  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{ left: screenX, top: screenY, transform: 'translate(-50%, calc(-100% - 20px))' }}
    >
      <div
        className="panel-in pointer-events-auto flex items-center gap-0.5 rounded-2xl bg-ink-950/95 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)] backdrop-blur"
        onMouseDown={(e) => { e.preventDefault(); suppressNextBlurCommit(); }}
      >
        <Tooltip label="Decrease size" side="top">
          <button
            onClick={() => cycleSize(-1)}
            disabled={sizeIndex === 0}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <Minus size={14} />
          </button>
        </Tooltip>
        <span className="w-6 text-center text-xs font-semibold text-white/80">
          {FONT_SIZE_LABEL[fontSize]}
        </span>
        <Tooltip label="Increase size" side="top">
          <button
            onClick={() => cycleSize(1)}
            disabled={sizeIndex === FONT_SIZES.length - 1}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <Plus size={14} />
          </button>
        </Tooltip>

        <div className="mx-0.5 h-6 w-px bg-white/10" />

        <Tooltip label="Bold" side="top">
          <button
            onClick={toggleBold}
            className={clsx(
              'flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white',
              bold && 'bg-accent-500 text-white hover:bg-accent-500',
            )}
          >
            <Bold size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Italic" side="top">
          <button
            onClick={toggleItalic}
            className={clsx(
              'flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white',
              italic && 'bg-accent-500 text-white hover:bg-accent-500',
            )}
          >
            <Italic size={15} />
          </button>
        </Tooltip>

        {!isEdge && (
          <>
            <div className="mx-0.5 h-6 w-px bg-white/10" />
            {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(
              ([align, Icon]) => (
                <Tooltip key={align} label={align[0].toUpperCase() + align.slice(1)} side="top">
                  <button
                    onClick={() => setAlign(align)}
                    className={clsx(
                      'flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white',
                      textAlign === align && 'bg-accent-500 text-white hover:bg-accent-500',
                    )}
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
                    onClick={() => setVerticalAlign(align)}
                    className={clsx(
                      'flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white',
                      verticalAlign === align && 'bg-accent-500 text-white hover:bg-accent-500',
                    )}
                  >
                    <Icon size={15} />
                  </button>
                </Tooltip>
              ),
            )}
          </>
        )}
      </div>
    </div>
  );
}
