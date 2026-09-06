import { useMemo } from 'react';
import { getNodesBounds, useViewport } from '@xyflow/react';
import { useDiagramStore, suppressNextBlurCommit } from '../store/useDiagramStore';
import { TextFormatControls, type TextFormatValue } from './TextFormatControls';
import type { ConnectorData, FontSize, TextAlign, VerticalAlign } from '../types';

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

  const entityId = isEdge ? editingEdge!.id : editingNode!.id;

  // A connector keeps its label's formatting under its own `label*` keys, so the
  // shared patch is translated on the way out rather than at every button.
  const apply = (patch: Partial<TextFormatValue>) => {
    if (!isEdge) {
      updateNodeData(entityId, patch);
      return;
    }
    const edgePatch: Partial<ConnectorData> = {};
    if (patch.fontSize !== undefined) edgePatch.labelFontSize = patch.fontSize;
    if (patch.bold !== undefined) edgePatch.labelBold = patch.bold;
    if (patch.italic !== undefined) edgePatch.labelItalic = patch.italic;
    updateEdgeData(entityId, edgePatch);
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
        <TextFormatControls
          value={{ fontSize, bold, italic, textAlign, verticalAlign }}
          onChange={apply}
          showAlignment={!isEdge}
        />
      </div>
    </div>
  );
}
