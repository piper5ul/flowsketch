import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionMode,
  useReactFlow,
  type FinalConnectionState,
} from '@xyflow/react';
import { nanoid } from 'nanoid';
import { computeMarkers, useDiagramStore, type ClipboardPayload, type ShapeNode } from '../store/useDiagramStore';
import { makeEdgeData } from '../lib/defaults';
import { renderDiagramPng } from '../lib/exportImage';
import { isAnchorNode } from '../lib/nodeKinds';
import { useImageInsert } from '../lib/useImageInsert';
import { nodeTypes } from '../nodes/nodeTypes';
import { edgeTypes } from '../edges/edgeTypes';
import { LeftRail } from './LeftRail';
import { FloatingToolbar } from './FloatingToolbar';
import { BottomBar } from './BottomBar';
import { TopBar } from './TopBar';
import { AlignmentGuides } from './AlignmentGuides';
import { TextFormatBar } from './TextFormatBar';
import type { FontSize, ShapeData, ShapeKind, Tool } from '../types';

const SHAPE_TOOLS: ShapeKind[] = ['rectangle', 'ellipse', 'diamond', 'sticky', 'text', 'pill', 'triangle', 'hexagon', 'cylinder'];
const SHORTCUTS: Record<string, Tool> = {
  v: 'select',
  h: 'pan',
  r: 'rectangle',
  o: 'ellipse',
  d: 'diamond',
  s: 'sticky',
  n: 'sticky',
  t: 'text',
  a: 'connector',
  l: 'connector',
  u: 'pill',
  g: 'triangle',
  y: 'cylinder',
};

let copiedStyle: Partial<ShapeData> | null = null;

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

export function Canvas() {
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const onNodesChange = useDiagramStore((s) => s.onNodesChange);
  const onEdgesChange = useDiagramStore((s) => s.onEdgesChange);
  const onConnect = useDiagramStore((s) => s.onConnect);
  const addShape = useDiagramStore((s) => s.addShape);
  const tool = useDiagramStore((s) => s.tool);
  const setTool = useDiagramStore((s) => s.setTool);
  const deleteSelection = useDiagramStore((s) => s.deleteSelection);
  const setEditingNodeId = useDiagramStore((s) => s.setEditingNodeId);
  const setEditingEdgeId = useDiagramStore((s) => s.setEditingEdgeId);
  const undo = useDiagramStore((s) => s.undo);
  const redo = useDiagramStore((s) => s.redo);
  const defaultConnector = useDiagramStore((s) => s.defaultConnector);

  const { screenToFlowPosition, addNodes, addEdges, zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const insertImages = useImageInsert();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const prevToolRef = useRef<Tool>('select');
  const connectorSourceRef = useRef<string | null>(null);

  useEffect(() => {
    if (tool !== 'connector') connectorSourceRef.current = null;
  }, [tool]);

  const onNodeDragStart = useCallback(
    (event: MouseEvent | TouchEvent) => {
      if (!('altKey' in event) || !event.altKey) return;
      // Leave a copy behind and keep dragging the originals.
      useDiagramStore.getState().duplicateSelection({ offset: 0, select: false });
    },
    [],
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: ShapeNode) => {
      if (tool !== 'connector') return;
      // A floating arrow's endpoints are not shapes the user can connect to.
      if (isAnchorNode(node.data)) return;

      if (!connectorSourceRef.current) {
        connectorSourceRef.current = node.id;
        return;
      }

      if (connectorSourceRef.current === node.id) return;

      const edgeData = makeEdgeData(defaultConnector);
      addEdges({
        id: nanoid(8),
        source: connectorSourceRef.current,
        target: node.id,
        type: 'connector',
        zIndex: 1000,
        ...computeMarkers(edgeData),
        data: edgeData,
      });
      connectorSourceRef.current = null;
    },
    [tool, addEdges, defaultConnector],
  );

  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      setEditingNodeId(null);

      if (tool === 'connector') {
        if (connectorSourceRef.current) {
          connectorSourceRef.current = null;
          return;
        }
        const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const startId = nanoid(8);
        const endId = nanoid(8);
        const anchorSize = 1;
        addNodes([
          {
            id: startId, type: 'shape',
            position: { x: position.x - anchorSize / 2, y: position.y - anchorSize / 2 },
            width: anchorSize, height: anchorSize,
            data: { label: '', shape: 'rectangle', fill: 'transparent', stroke: 'transparent' },
          },
          {
            id: endId, type: 'shape',
            position: { x: position.x + 180 - anchorSize / 2, y: position.y - anchorSize / 2 },
            width: anchorSize, height: anchorSize,
            data: { label: '', shape: 'rectangle', fill: 'transparent', stroke: 'transparent' },
          },
        ]);
        const edgeData = makeEdgeData(defaultConnector);
        addEdges({
          id: nanoid(8),
          source: startId,
          target: endId,
          sourceHandle: 'right',
          targetHandle: 'left',
          type: 'connector',
          zIndex: 1000,
          ...computeMarkers(edgeData),
          data: edgeData,
        });
        setTool('select');
        return;
      }

      if (!SHAPE_TOOLS.includes(tool as ShapeKind)) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const shape = tool as ShapeKind;
      const sizeOffset = shape === 'text' ? { x: 80, y: 20 } : { x: 90, y: 55 };
      addShape(shape, { x: position.x - sizeOffset.x, y: position.y - sizeOffset.y });
      setTool('select');
    },
    [tool, screenToFlowPosition, addShape, setTool, setEditingNodeId, addNodes, addEdges, defaultConnector],
  );

  // A fresh connector renders no label element, so there is nothing to
  // double-click on the label itself. Double-clicking anywhere along the
  // connector opens its label for editing, matching Whimsical.
  const onEdgeDoubleClick = useCallback(
    (_event: React.MouseEvent, edge: { id: string }) => {
      setEditingEdgeId(edge.id);
    },
    [setEditingEdgeId],
  );

  const onCanvasDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      // Edge labels (and the add-label target) are portalled into the label
      // renderer, outside `.react-flow__edge`, so they need their own guard.
      if (
        target.closest('.react-flow__node') ||
        target.closest('.react-flow__edge') ||
        target.closest('.react-flow__edgelabel-renderer')
      ) {
        return;
      }
      if (tool !== 'select') return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const id = addShape('text', { x: position.x - 80, y: position.y - 20 });
      setEditingNodeId(id);
    },
    [tool, screenToFlowPosition, addShape, setEditingNodeId],
  );

  // Dragging a connector out to empty canvas creates a new connected shape,
  // mirroring Whimsical's "drag to create" flow.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectionState.isValid || !connectionState.fromNode) return;
      const target = event.target as HTMLElement;
      if (!target.closest('.react-flow__pane')) return;

      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      const position = screenToFlowPosition({ x: point.clientX, y: point.clientY });
      const id = nanoid(8);
      const width = 180;
      const height = 100;

      addNodes({
        id,
        type: 'shape',
        position: { x: position.x - width / 2, y: position.y - height / 2 },
        width,
        height,
        data: { label: '', shape: 'rectangle', fill: '#DCEAFB', stroke: '#3B82F6' },
      });
      const edgeData = makeEdgeData(defaultConnector);
      addEdges({
        id: nanoid(8),
        source: connectionState.fromNode.id,
        target: id,
        sourceHandle: connectionState.fromHandle?.id,
        type: 'connector',
        zIndex: 1000,
        ...computeMarkers(edgeData),
        data: edgeData,
      });
    },
    [screenToFlowPosition, addNodes, addEdges, defaultConnector],
  );

  useEffect(() => {
    let clipboard: ClipboardPayload | null = null;

    // Pasted images are uploaded and referenced by URL. Inlining them as
    // base64 used to blow a screenshot-sized paste past the 5 MB limit on the
    // diagram's JSON body, which failed the save rather than the paste.
    function onPaste(e: ClipboardEvent) {
      if (isTypingTarget(e.target)) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (const item of items) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      if (files.length === 0) return;

      e.preventDefault();
      insertImages(files);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      // Undo / Redo
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      // Select all (excludes locked nodes)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const state = useDiagramStore.getState();
        useDiagramStore.setState({
          nodes: state.nodes.map((n) => ({ ...n, selected: !n.data.locked })),
          edges: state.edges.map((ed) => ({ ...ed, selected: true })),
        });
        return;
      }

      // Cmd+Shift+C → Copy as image
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        void renderDiagramPng().then(async (dataUrl) => {
          if (!dataUrl) return;
          const res = await fetch(dataUrl);
          const blob = await res.blob();
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        });
        return;
      }

      // Cmd+Shift+D → Save as default style
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const state = useDiagramStore.getState();
        const sel = state.nodes.find((nd) => nd.selected);
        if (sel) state.setDefaultStyle({ fill: sel.data.fill, stroke: sel.data.stroke });
        return;
      }

      // Cmd+Shift+L → Lock/unlock
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        useDiagramStore.getState().toggleLock();
        return;
      }

      // Cmd+Option+C → Copy style
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyC') {
        e.preventDefault();
        const sel = useDiagramStore.getState().nodes.find((nd) => nd.selected);
        if (sel) {
          const { fill, stroke, fontSize, bold, italic, textAlign, verticalAlign } = sel.data;
          copiedStyle = { fill, stroke, fontSize, bold, italic, textAlign, verticalAlign };
        }
        return;
      }

      // Cmd+Option+V → Paste style
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyV') {
        e.preventDefault();
        if (copiedStyle) useDiagramStore.getState().updateSelectedNodesData(copiedStyle);
        return;
      }

      // Cmd+Option+= → Increase font size
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'Equal') {
        e.preventDefault();
        const SIZES: FontSize[] = ['small', 'medium', 'large'];
        const sel = useDiagramStore.getState().nodes.find((nd) => nd.selected);
        if (sel) {
          const idx = SIZES.indexOf(sel.data.fontSize ?? 'medium');
          useDiagramStore.getState().updateSelectedNodesData({ fontSize: SIZES[Math.min(idx + 1, 2)] });
        }
        return;
      }

      // Cmd+Option+- → Decrease font size
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'Minus') {
        e.preventDefault();
        const SIZES: FontSize[] = ['small', 'medium', 'large'];
        const sel = useDiagramStore.getState().nodes.find((nd) => nd.selected);
        if (sel) {
          const idx = SIZES.indexOf(sel.data.fontSize ?? 'medium');
          useDiagramStore.getState().updateSelectedNodesData({ fontSize: SIZES[Math.max(0, idx - 1)] });
        }
        return;
      }

      // Copy / Cut
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x')) {
        const state = useDiagramStore.getState();
        const selNodes = state.nodes.filter((n) => n.selected);
        const selEdges = state.edges.filter((ed) => ed.selected);
        if (selNodes.length === 0 && selEdges.length === 0) return;
        const selNodeIds = new Set(selNodes.map((n) => n.id));
        const connectedEdges = selEdges.length > 0
          ? selEdges
          : state.edges.filter((ed) => selNodeIds.has(ed.source) && selNodeIds.has(ed.target));
        clipboard = {
          nodes: selNodes.map((n) => ({ ...n, selected: false })),
          edges: connectedEdges.map((ed) => ({ ...ed, selected: false })),
        };
        if (e.key.toLowerCase() === 'x') {
          e.preventDefault();
          deleteSelection();
        }
        return;
      }

      // Duplicate
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        useDiagramStore.getState().duplicateSelection();
        return;
      }

      // Paste
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        if (!clipboard || clipboard.nodes.length === 0) return;
        e.preventDefault();
        // Paste again from what was just pasted, so repeats keep stepping away.
        clipboard = useDiagramStore.getState().pasteClipboard(clipboard);
        return;
      }

      // Zoom in / out
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomIn({ duration: 150 });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault();
        zoomOut({ duration: 150 });
        return;
      }

      // Fit view
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        fitView({ padding: 0.2, duration: 300 });
        return;
      }

      // Cmd+] → Bring forward, Cmd+[ → Send backward
      if ((e.metaKey || e.ctrlKey) && e.key === ']') {
        e.preventDefault();
        useDiagramStore.getState().bringForward();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '[') {
        e.preventDefault();
        useDiagramStore.getState().sendBackward();
        return;
      }

      // Enter to edit
      if (e.key === 'Enter') {
        const state = useDiagramStore.getState();
        const selNodes = state.nodes.filter((n) => n.selected);
        const selEdges = state.edges.filter((ed) => ed.selected);
        if (selNodes.length === 1) {
          e.preventDefault();
          setEditingNodeId(selNodes[0].id);
          return;
        }
        if (selNodes.length === 0 && selEdges.length === 1) {
          e.preventDefault();
          setEditingEdgeId(selEdges[0].id);
          return;
        }
      }

      // Escape to deselect
      if (e.key === 'Escape') {
        const state = useDiagramStore.getState();
        if (state.editingNodeId || state.editingEdgeId) return;
        useDiagramStore.setState({
          nodes: state.nodes.map((n) => ({ ...n, selected: false })),
          edges: state.edges.map((ed) => ({ ...ed, selected: false })),
        });
        setTool('select');
        return;
      }

      // Arrow keys to nudge selected shapes
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const state = useDiagramStore.getState();
        if (!state.nodes.some((n) => n.selected)) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
        state.nudgeSelected(dx, dy);
        return;
      }

      // Delete
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        deleteSelection();
        return;
      }

      // Space to pan (hold)
      if (e.key === ' ' && !e.repeat) {
        const currentTool = useDiagramStore.getState().tool;
        if (currentTool !== 'pan') {
          e.preventDefault();
          prevToolRef.current = currentTool;
          setTool('pan');
        }
        return;
      }

      // Bare zoom shortcuts
      if (e.key === '=' || e.key === '+') { zoomIn({ duration: 150 }); return; }
      if (e.key === '-' && !e.metaKey && !e.ctrlKey) { zoomOut({ duration: 150 }); return; }
      if (e.key === '0') { zoomTo(1, { duration: 150 }); return; }
      if (e.key === '1') { fitView({ padding: 0.2, duration: 300 }); return; }
      if (e.key === '2') {
        const selNodes = useDiagramStore.getState().nodes.filter((nd) => nd.selected);
        if (selNodes.length > 0) fitView({ nodes: selNodes.map((nd) => ({ id: nd.id })), padding: 0.2, duration: 300 });
        return;
      }

      // Bare layer ordering: ] bring to front, [ send to back
      if (e.key === ']') { useDiagramStore.getState().bringToFront(); return; }
      if (e.key === '[') { useDiagramStore.getState().sendToBack(); return; }

      const nextTool = SHORTCUTS[e.key.toLowerCase()];
      if (nextTool) setTool(nextTool);
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === ' ') {
        setTool(prevToolRef.current);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('paste', onPaste);
    };
  }, [deleteSelection, undo, redo, setTool, setEditingNodeId, setEditingEdgeId, zoomIn, zoomOut, zoomTo, fitView, insertImages]);

  return (
    <div ref={wrapperRef} className="relative h-full w-full" onDoubleClick={onCanvasDoubleClick}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onPaneClick={onPaneClick}
        onNodeClick={onNodeClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onNodeDragStart={onNodeDragStart}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={30}
        connectionLineStyle={{ stroke: 'var(--color-accent-500)', strokeWidth: 2.5 }}
        panOnDrag={tool === 'pan' ? true : [1, 2]}
        selectionOnDrag={tool === 'select'}
        nodesDraggable={tool !== 'connector'}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={2.5}
        // CanvasPage mounts Canvas only after the diagram has loaded, so
        // fitView frames the actual content on open; defaultViewport is the
        // fallback for an empty diagram, where there is nothing to fit.
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
        className={`${tool === 'pan' ? 'cursor-grab' : (SHAPE_TOOLS.includes(tool as ShapeKind) || tool === 'connector') ? 'cursor-crosshair' : ''} ${tool === 'connector' ? 'connector-mode' : ''}`}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#D6D9E4" className="rf-canvas" />
        <AlignmentGuides />
      </ReactFlow>

      <TopBar />
      <LeftRail />
      <FloatingToolbar />
      <TextFormatBar />
      <BottomBar />
    </div>
  );
}
