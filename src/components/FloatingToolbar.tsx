import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { X } from 'lucide-react';
import { useDiagramStore, type ConnectorEdge } from '../store/useDiagramStore';
import { formatShortcut, registry } from '../commands/commands';
import type { CommandContext } from '../commands/types';
import { matchSwatch } from '../lib/palette';
import { resolveFillLook } from '../lib/shapeStyle';
import { canSwapShapeKind, isContainerNode, isGroupNode, isInkNode, isTableNode, isWireNode } from '../lib/nodeKinds';
import { absolutePosition } from '../lib/nodeTree';
import { hasWireLabel } from '../lib/wireframe';
import { textFormatValueOf, toConnectorLabelPatch } from '../lib/text';
import { DEFAULT_EDGE_STROKE } from '../lib/defaults';
import { TextBar } from './toolbar/TextBar';
import { ShapeBar } from './toolbar/ShapeBar';
import { ConnectorBar } from './toolbar/ConnectorBar';
import { ToolButton } from './toolbar/chrome';

export function FloatingToolbar({
  ctx,
  onRunCommand,
}: {
  ctx: CommandContext;
  onRunCommand: (id: string) => void;
}) {
  const nodes = useDiagramStore((state) => state.nodes);
  const edges = useDiagramStore((state) => state.edges);
  const connectorDragging = useDiagramStore((state) => state.connectorDragging);
  const editingNodeId = useDiagramStore((state) => state.editingNodeId);
  const editingEdgeId = useDiagramStore((state) => state.editingEdgeId);
  const updateSelectedNodesData = useDiagramStore((state) => state.updateSelectedNodesData);
  const updateSelectedEdgesStyle = useDiagramStore((state) => state.updateSelectedEdgesStyle);
  const updateSelectedNodesColour = useDiagramStore((state) => state.updateSelectedNodesColour);
  const updateNodeData = useDiagramStore((state) => state.updateNodeData);
  const updateEdgeData = useDiagramStore((state) => state.updateEdgeData);
  const setEditingNodeId = useDiagramStore((state) => state.setEditingNodeId);
  const setEditingEdgeId = useDiagramStore((state) => state.setEditingEdgeId);
  const linkEditorRequest = useDiagramStore((state) => state.linkEditorRequest);
  const viewport = useViewport();
  const { screenToFlowPosition, getNodesBounds } = useReactFlow();
  const [textMode, setTextMode] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [toolbarHalfWidth, setToolbarHalfWidth] = useState(200);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
  const selectedEdges = useMemo(() => edges.filter((edge) => edge.selected), [edges]);
  const selectedIdKey = useMemo(
    () => [...selectedNodes.map((node) => `n:${node.id}`), ...selectedEdges.map((edge) => `e:${edge.id}`)].sort().join('|'),
    [selectedNodes, selectedEdges],
  );
  useEffect(() => setTextMode(false), [selectedIdKey]);

  const isEdgeMode = selectedNodes.length === 0 && selectedEdges.length > 0;
  useEffect(() => {
    if (!linkEditorRequest || isEdgeMode || selectedNodes.length !== 1) return;
    setLinkValue(selectedNodes[0]?.data.link ?? '');
    setLinkOpen(true);
    setTimeout(() => linkInputRef.current?.focus(), 50);
    // A request is an explicit open, not a reason to reopen on every selection render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkEditorRequest]);

  const textableNodes = useMemo(
    () => selectedNodes.filter((node) =>
      node.data.shape !== 'image' &&
      !isContainerNode(node) &&
      !isTableNode(node) &&
      !isInkNode(node) &&
      (!isWireNode(node) || hasWireLabel(node.data)),
    ),
    [selectedNodes],
  );
  const styleableNodes = useMemo(() => textableNodes.filter((node) => !isWireNode(node)), [textableNodes]);
  const colourableNodes = useMemo(
    () => selectedNodes.filter((node) => node.data.shape !== 'image' && !isGroupNode(node)),
    [selectedNodes],
  );
  const swappableNodes = useMemo(() => selectedNodes.filter((node) => canSwapShapeKind(node)), [selectedNodes]);
  const currentShapeKind = useMemo(() => {
    const first = swappableNodes[0]?.data.shape ?? null;
    return swappableNodes.every((node) => node.data.shape === first) ? first : null;
  }, [swappableNodes]);
  const tableNode = useMemo(() => {
    if (selectedNodes.length !== 1) return null;
    const [node] = selectedNodes;
    return isTableNode(node) && node.data.table ? node : null;
  }, [selectedNodes]);
  const styleMatches = useMemo(() => {
    const first = styleableNodes[0];
    return first && styleableNodes.every((node) => resolveFillLook(node.data) === resolveFillLook(first.data))
      ? resolveFillLook(first.data)
      : null;
  }, [styleableNodes]);
  const allTransparent = styleableNodes.length > 0 && styleableNodes.every((node) => node.data.transparent === true);
  const editingNode = useMemo(
    () => (editingNodeId ? nodes.find((node) => node.id === editingNodeId) ?? null : null),
    [editingNodeId, nodes],
  );
  const editingEdge = useMemo(
    () => (editingEdgeId ? edges.find((edge) => edge.id === editingEdgeId) ?? null : null),
    [editingEdgeId, edges],
  );
  const tableCellEditing = !!editingNode && isTableNode(editingNode);

  const colorMatches = isEdgeMode
    ? selectedEdges.map((edge) => matchSwatch({ stroke: edge.data?.stroke ?? DEFAULT_EDGE_STROKE }, 'edge'))
    : colourableNodes.map((node) => matchSwatch(
        { fill: node.data.fill, stroke: node.data.stroke },
        node.data.shape === 'sticky' ? 'sticky' : 'shape',
      ));
  const firstColorMatch = colorMatches[0] ?? null;
  const activeColorId = firstColorMatch && colorMatches.every((match) => match?.id === firstColorMatch.id)
    ? firstColorMatch.id
    : null;
  const triggerColours = isEdgeMode
    ? selectedEdges.map((edge) => edge.data?.stroke ?? DEFAULT_EDGE_STROKE)
    : colourableNodes.map((node, index) => colorMatches[index]?.fill ?? (node.data.shape === 'sticky' ? node.data.stroke : node.data.fill));
  const triggerColour = triggerColours.length > 0 && triggerColours.every((colour) => colour.toUpperCase() === triggerColours[0].toUpperCase())
    ? triggerColours[0]
    : null;
  const hasWaypoints = selectedEdges.some((edge) => (edge.data?.waypoints?.length ?? 0) > 0);

  const edgeAnchor = (edge: ConnectorEdge) => {
    const source = nodes.find((node) => node.id === edge.source);
    const target = nodes.find((node) => node.id === edge.target);
    if (!source || !target) return null;
    const lookup = new Map(nodes.map((node) => [node.id, node] as const));
    const sourcePosition = absolutePosition(source, lookup);
    const targetPosition = absolutePosition(target, lookup);
    const sx = sourcePosition.x + (source.measured?.width ?? 100) / 2;
    const sy = sourcePosition.y + (source.measured?.height ?? 60) / 2;
    const tx = targetPosition.x + (target.measured?.width ?? 100) / 2;
    const ty = targetPosition.y + (target.measured?.height ?? 60) / 2;
    const naturalTop = Math.min(sy, ty);
    let pathTop: number | null = null;
    const path = document.querySelector(`[data-testid="rf__edge-${edge.id}"]`);
    if (path) pathTop = screenToFlowPosition({ x: path.getBoundingClientRect().left, y: path.getBoundingClientRect().top }).y;
    return { x: (sx + tx) / 2, y: pathTop === null ? naturalTop : Math.min(naturalTop, pathTop) };
  };

  const anchor = useMemo(() => {
    if (editingNode && !isTableNode(editingNode)) {
      const bounds = getNodesBounds([editingNode]);
      return { x: bounds.x + bounds.width / 2, y: bounds.y };
    }
    if (editingEdge) return edgeAnchor(editingEdge);
    if (selectedNodes.length > 0) {
      const bounds = getNodesBounds(selectedNodes);
      return { x: bounds.x + bounds.width / 2, y: bounds.y };
    }
    if (selectedEdges.length > 0) return edgeAnchor(selectedEdges[0]);
    return null;
    // The screen path measurement depends on the view primitives; keeping them
    // primitive avoids a state loop when React Flow returns a new viewport object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingNode, editingEdge, selectedNodes, selectedEdges, nodes, viewport.x, viewport.y, viewport.zoom, getNodesBounds, screenToFlowPosition]);
  const hasAnchor = anchor !== null;

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const measure = () => setToolbarHalfWidth(toolbar.getBoundingClientRect().width / 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [hasAnchor, textMode, selectedIdKey, editingNodeId, editingEdgeId]);

  if (!anchor || tableCellEditing) return null;
  const rawScreenX = anchor.x * viewport.zoom + viewport.x;
  const rawScreenY = anchor.y * viewport.zoom + viewport.y;
  const safeHalfWidth = Math.min(toolbarHalfWidth, Math.max(0, (windowWidth - 16) / 2));
  const screenX = Math.max(safeHalfWidth + 8, Math.min(rawScreenX, windowWidth - safeHalfWidth - 8));
  const screenY = Math.max(60, rawScreenY);

  const editNodeForText = editingNode && !isTableNode(editingNode) ? editingNode : null;
  const editEdgeForText = editingEdge;
  const isEditingText = !!editNodeForText || !!editEdgeForText;
  const showTextMode = isEditingText || textMode;
  const localTextNode = textableNodes[0] ?? null;
  const textTarget = editEdgeForText ? 'connectorLabel' : 'shape';
  const textValue = editEdgeForText
    ? textFormatValueOf(editEdgeForText)
    : textFormatValueOf(editNodeForText ?? localTextNode ?? { data: { shape: 'text' } });
  const textMulti = !isEditingText && (selectedNodes.length !== 1 || selectedNodes.some((node) => node.data.locked));

  const enterText = () => {
    if (selectedNodes.length === 1 && !selectedNodes[0].data.locked) {
      setEditingNodeId(selectedNodes[0].id);
    } else {
      setTextMode(true);
    }
  };
  const applyText = (patch: Partial<typeof textValue>) => {
    if (editNodeForText) updateNodeData(editNodeForText.id, patch);
    else if (editEdgeForText) updateEdgeData(editEdgeForText.id, toConnectorLabelPatch(patch));
    else updateSelectedNodesData(patch);
  };
  const finishText = () => {
    if (isEditingText) (document.activeElement as HTMLElement | null)?.blur();
    else setTextMode(false);
  };
  const openLink = () => {
    const node = editNodeForText ?? selectedNodes[0];
    setLinkValue(node?.data.link ?? '');
    setLinkOpen((open) => !open);
    setTimeout(() => linkInputRef.current?.focus(), 50);
  };
  const commitLink = () => {
    const node = editNodeForText ?? selectedNodes[0];
    if (node) updateNodeData(node.id, { link: linkValue || undefined });
    setLinkOpen(false);
  };
  const clearLink = () => {
    const node = editNodeForText ?? selectedNodes[0];
    setLinkValue('');
    if (node) updateNodeData(node.id, { link: undefined });
    setLinkOpen(false);
  };
  const linkNode = editNodeForText ?? selectedNodes[0];
  const textLink = textTarget === 'shape' && !textMulti && linkNode
    ? { active: !!linkNode.data.link, onOpen: openLink }
    : null;
  const textShortcut = formatShortcut(registry.find(textTarget === 'shape' ? 'edit.editText' : 'edit.editEdgeLabel')?.shortcut);

  return (
    <div
      className="pointer-events-none absolute z-30 transition-opacity duration-150"
      style={{
        left: screenX,
        top: screenY,
        transform: 'translate(-50%, calc(-100% - 39px))',
        opacity: connectorDragging ? 0.15 : 1,
      }}
    >
      <div ref={toolbarRef} role="toolbar" aria-label="Selection toolbar" className="chrome-bar pointer-events-auto">
        {showTextMode ? (
          <TextBar
            value={textValue}
            target={textTarget}
            link={textLink}
            multi={textMulti}
            onChange={applyText}
            onFinish={finishText}
          />
        ) : isEdgeMode ? (
          <ConnectorBar
            edges={selectedEdges}
            activeColorId={activeColorId}
            triggerColour={triggerColour}
            hasWaypoints={hasWaypoints}
            textShortcut={textShortcut}
            ctx={ctx}
            onPickColor={(swatch) => updateSelectedEdgesStyle({ stroke: swatch.stroke })}
            onEnterText={() => setEditingEdgeId(selectedEdges[0].id)}
            onRunCommand={onRunCommand}
          />
        ) : (
          <ShapeBar
            nodes={selectedNodes}
            textableNodes={textableNodes}
            swappableNodes={swappableNodes}
            colourableNodes={colourableNodes}
            styleableNodes={styleableNodes}
            tableNode={tableNode}
            currentShapeKind={currentShapeKind}
            activeColorId={activeColorId}
            triggerColour={triggerColour}
            fillLook={styleMatches}
            allTransparent={allTransparent}
            canAddComment={!!registry.find('comment.addToSelection')?.when?.(ctx)}
            textShortcut={textShortcut}
            ctx={ctx}
            onPickColor={(swatch) => updateSelectedNodesColour(swatch)}
            onEnterText={enterText}
            onRunCommand={onRunCommand}
          />
        )}
      </div>
      {linkOpen && selectedNodes.length === 1 && !isEdgeMode && (
        <div className="chrome-pop pointer-events-auto mt-[9px] flex items-center gap-1.5 p-1.5">
          <input
            ref={linkInputRef}
            type="url"
            placeholder="https://..."
            aria-label="Link URL"
            value={linkValue}
            onChange={(event) => setLinkValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitLink();
              if (event.key === 'Escape') setLinkOpen(false);
            }}
            className="h-7 w-48 rounded-md bg-[var(--color-chrome-track)] px-2 text-[13px] text-white outline-none placeholder:text-white/40 focus:ring-1 focus:ring-[var(--color-chrome-ring)]"
          />
          {linkValue && <ToolButton label="Remove link" onClick={clearLink}><X size={14} /></ToolButton>}
        </div>
      )}
    </div>
  );
}
