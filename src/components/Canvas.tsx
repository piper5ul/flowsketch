import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { isAnchorNode } from '../lib/nodeKinds';
import { useImageInsert } from '../lib/useImageInsert';
import { SHAPE_TOOL_KINDS, registry } from '../commands/commands';
import type { CommandContext } from '../commands/types';
import { nodeTypes } from '../nodes/nodeTypes';
import { edgeTypes } from '../edges/edgeTypes';
import { LeftRail } from './LeftRail';
import { FloatingToolbar } from './FloatingToolbar';
import { BottomBar } from './BottomBar';
import { TopBar } from './TopBar';
import { AlignmentGuides } from './AlignmentGuides';
import { TextFormatBar } from './TextFormatBar';
import { ShortcutSheet } from './ShortcutSheet';
import { ContextMenu, type ContextMenuState } from './ContextMenu';
import type { ShapeData, ShapeKind, Tool } from '../types';

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
  const setEditingNodeId = useDiagramStore((s) => s.setEditingNodeId);
  const setEditingEdgeId = useDiagramStore((s) => s.setEditingEdgeId);
  const defaultConnector = useDiagramStore((s) => s.defaultConnector);

  const { screenToFlowPosition, addNodes, addEdges, zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const insertImages = useImageInsert();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const prevToolRef = useRef<Tool>('select');
  const connectorSourceRef = useRef<string | null>(null);
  // Both clipboards live outside the store: neither belongs in a saved diagram.
  const clipboardRef = useRef<ClipboardPayload | null>(null);
  const styleClipboardRef = useRef<Partial<ShapeData> | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (tool !== 'connector') connectorSourceRef.current = null;
  }, [tool]);

  // Everything a command is allowed to reach: the store, the viewport, the two
  // clipboards, hold-to-pan and the sheet.
  const commandContext = useMemo<CommandContext>(
    () => ({
      store: useDiagramStore,
      view: { zoomIn, zoomOut, zoomTo, fitView },
      clipboard: {
        get: () => clipboardRef.current,
        set: (value) => { clipboardRef.current = value; },
      },
      styleClipboard: {
        get: () => styleClipboardRef.current,
        set: (value) => { styleClipboardRef.current = value; },
      },
      pan: {
        begin: () => {
          prevToolRef.current = useDiagramStore.getState().tool;
          useDiagramStore.getState().setTool('pan');
        },
        end: () => useDiagramStore.getState().setTool(prevToolRef.current),
      },
      ui: { openShortcuts: () => setShortcutsOpen(true) },
    }),
    [zoomIn, zoomOut, zoomTo, fitView],
  );

  const runCommand = useCallback(
    (id: string) => {
      const command = registry.find(id);
      if (!command || (command.when && !command.when(commandContext))) return;
      command.run(commandContext);
    },
    [commandContext],
  );

  /** Right-clicking something that is not selected selects it first. */
  const selectOnly = useCallback((kind: 'node' | 'edge', id: string) => {
    const state = useDiagramStore.getState();
    useDiagramStore.setState({
      nodes: state.nodes.map((n) => ({ ...n, selected: kind === 'node' && n.id === id })),
      edges: state.edges.map((e) => ({ ...e, selected: kind === 'edge' && e.id === id })),
    });
  }, []);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: ShapeNode) => {
      event.preventDefault();
      if (!node.selected) selectOnly('node', node.id);
      setContextMenu({ x: event.clientX, y: event.clientY, target: 'node' });
    },
    [selectOnly],
  );

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: { id: string; selected?: boolean }) => {
      event.preventDefault();
      if (!edge.selected) selectOnly('edge', edge.id);
      setContextMenu({ x: event.clientX, y: event.clientY, target: 'edge' });
    },
    [selectOnly],
  );

  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, target: 'pane' });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

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

      if (!SHAPE_TOOL_KINDS.includes(tool as ShapeKind)) return;
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

  // Dropping image files anywhere on the canvas inserts them where they
  // landed. `onDragOver` must preventDefault or the browser takes over and
  // navigates the tab to the dropped file.
  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const files = Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) return;
      event.preventDefault();
      insertImages(files, { x: event.clientX, y: event.clientY });
    },
    [insertImages],
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

  // Pasted images are uploaded and referenced by URL. Inlining them as
  // base64 used to blow a screenshot-sized paste past the 5 MB limit on the
  // diagram's JSON body, which failed the save rather than the paste.
  useEffect(() => {
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

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [insertImages]);

  // Every shortcut is a command now; this handler only decides whether one
  // applies. A keystroke that matches nothing falls through untouched, which is
  // what leaves ⌘V to the paste listener above when our clipboard is empty.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      // The sheet is modal: it takes Escape itself and swallows the rest.
      if (shortcutsOpen) return;
      const command = registry.matchEvent(e, commandContext);
      if (!command) return;
      e.preventDefault();
      command.run(commandContext);
    }

    // Hold-to-pan is the one shortcut with two halves: the keydown is the
    // `view.pan` command, and releasing Space hands the previous tool back.
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === ' ') commandContext.pan.end();
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [commandContext, shortcutsOpen]);

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full"
      onDoubleClick={onCanvasDoubleClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
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
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={30}
        connectionLineStyle={{ stroke: 'var(--color-accent-500)', strokeWidth: 2.5 }}
        // The right button opens the context menu, so panning is the middle
        // button plus the hand tool and hold-to-pan.
        panOnDrag={tool === 'pan' ? true : [1]}
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
        className={`${tool === 'pan' ? 'cursor-grab' : (SHAPE_TOOL_KINDS.includes(tool as ShapeKind) || tool === 'connector') ? 'cursor-crosshair' : ''} ${tool === 'connector' ? 'connector-mode' : ''}`}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#D6D9E4" className="rf-canvas" />
        <AlignmentGuides />
      </ReactFlow>

      <TopBar />
      <LeftRail />
      <FloatingToolbar />
      <TextFormatBar />
      <BottomBar onRunCommand={runCommand} />

      {contextMenu && (
        <ContextMenu state={contextMenu} ctx={commandContext} onClose={closeContextMenu} />
      )}
      {shortcutsOpen && <ShortcutSheet onClose={closeShortcuts} />}
    </div>
  );
}
