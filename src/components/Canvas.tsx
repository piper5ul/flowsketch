import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionMode,
  useReactFlow,
  ViewportPortal,
  type FinalConnectionState,
  type Viewport,
} from '@xyflow/react';
import { nanoid } from 'nanoid';
import { computeMarkers, useDiagramStore, type ClipboardPayload, type ShapeNode } from '../store/useDiagramStore';
import { useViewPreferences } from '../store/useViewPreferences';
import { isAnchorNode } from '../lib/nodeKinds';
import { anchorToPoint, type Point } from '../lib/edgeGeometry';
import {
  anchorFor,
  boardRect,
  DRAG_THRESHOLD_PX,
  facingSide,
  nodeAtPoint,
  sideAnchor,
} from '../lib/connectorGesture';
import { useImageInsert } from '../lib/useImageInsert';
import { parseMermaidFlowchart } from '../lib/mermaid';
import { SHAPE_TOOL_KINDS, registry } from '../commands/commands';
import type { CommandContext } from '../commands/types';
import { nodeTypes } from '../nodes/nodeTypes';
import { edgeTypes } from '../edges/edgeTypes';
import { ConnectorMarkerDefs } from '../edges/ConnectorMarkerDefs';
import { useCollabStore } from '../store/useCollabStore';
import { useCommentStore, type CommentAnchor } from '../store/useCommentStore';
import { CommentPins } from './CommentPins';
import { PresenceCursors } from './PresenceCursors';
import { LeftRail } from './LeftRail';
import { FloatingToolbar } from './FloatingToolbar';
import { BottomBar } from './BottomBar';
import { TopBar } from './TopBar';
import { AlignmentGuides } from './AlignmentGuides';
import { CanvasMiniMap } from './CanvasMiniMap';
import { TextFormatBar } from './TextFormatBar';
import { SearchBar } from './SearchBar';
import { ShortcutSheet } from './ShortcutSheet';
import { CommandMenu } from './CommandMenu';
import { MeasureOverlay } from './MeasureOverlay';
import { ContextMenu, type ContextMenuState } from './ContextMenu';
import type { Direction, EdgeAnchor, ShapeData, ShapeKind, Tool } from '../types';

const SIDES: readonly string[] = ['top', 'right', 'bottom', 'left'];
/** A React Flow handle id that names one of a shape's four sides. */
function isSide(id: string | null | undefined): id is Direction {
  return typeof id === 'string' && SIDES.includes(id);
}

/**
 * The grid a dragged shape lands on while snapping is on. 10 px is a divisor of
 * the 10 px far-nudge and of every default shape size, so a snapped shape stays
 * snapped when it is nudged or resized.
 */
const GRID_SIZE = 10;
const SNAP_GRID: [number, number] = [GRID_SIZE, GRID_SIZE];

/** Half a new frame's box, so the click that places one lands in its middle. */
const FRAME_OFFSET = { x: 240, y: 160 };

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}

/**
 * The board.
 *
 * `topBar` is what the public share page turns off: it mounts this same canvas
 * in read-only mode under a slim header of its own, and the editing top bar —
 * title field, star, Share, History — belongs to a signed-in reader.
 */
export function Canvas({ topBar = true }: { topBar?: boolean } = {}) {
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const onNodesChange = useDiagramStore((s) => s.onNodesChange);
  const onEdgesChange = useDiagramStore((s) => s.onEdgesChange);
  const onConnect = useDiagramStore((s) => s.onConnect);
  const addShape = useDiagramStore((s) => s.addShape);
  const addFrame = useDiagramStore((s) => s.addFrame);
  const tool = useDiagramStore((s) => s.tool);
  const setTool = useDiagramStore((s) => s.setTool);
  const setEditingNodeId = useDiagramStore((s) => s.setEditingNodeId);
  const setEditingEdgeId = useDiagramStore((s) => s.setEditingEdgeId);
  // Nothing on this canvas may change the diagram while this is true — see the
  // `readOnly` note in the store for why the gate lives out here and not there.
  const readOnly = useDiagramStore((s) => s.readOnly);
  const minimap = useViewPreferences((s) => s.minimap);
  const gridSnap = useViewPreferences((s) => s.gridSnap);
  // Commenting needs a session and a name against the remark, which is exactly
  // what the top bar's presence stands for: the public `/s/:token` page mounts
  // this same canvas with nobody behind it.
  const canComment = topBar;

  /** True while a tool that places something is held, rather than Select or Pan. */
  const isDrawingTool = tool === 'connector' || tool === 'frame' || SHAPE_TOOL_KINDS.includes(tool as ShapeKind);

  const { screenToFlowPosition, addNodes, addEdges, zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const insertImages = useImageInsert();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const prevToolRef = useRef<Tool>('select');
  const connectorSourceRef = useRef<string | null>(null);
  // A connector being drawn by hand — see `beginConnectorGesture`. The ref is
  // the gesture; the state is only what the preview line needs to draw.
  const gestureRef = useRef<{ sourceId: string; anchor: EdgeAnchor; from: Point; start: Point; moved: boolean } | null>(null);
  const [connectDraft, setConnectDraft] = useState<{ from: Point; to: Point } | null>(null);
  // Set when a drag just made a connector, so the click the browser fires on
  // release does not also start (or finish) the old click-click connector.
  const swallowClickRef = useRef(false);
  // Both clipboards live outside the store: neither belongs in a saved diagram.
  const clipboardRef = useRef<ClipboardPayload | null>(null);
  const styleClipboardRef = useRef<Partial<ShapeData> | null>(null);
  // What the "Comment" menu item would pin a thread to: the shape that was
  // right-clicked, or the point on the board that was. A ref rather than state
  // because nothing renders from it — it is read once, by the command.
  const commentAnchorRef = useRef<CommentAnchor | null>(null);
  // Where the pane's right-click menu was opened, in board coordinates — what a
  // "paste as" drops its shapes on. Null whenever that menu is not what is
  // running the command (⌘K, a keystroke, the browser's own paste), and then
  // the middle of the view is used instead.
  const paneAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  // Held modifiers, for the three precision gestures: ⌘-drag ignores the
  // alignment guides, `-drag ignores the grid as well, ⌥-hover measures.
  const [held, setHeld] = useState({ meta: false, backtick: false, alt: false });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const setSnapOverride = useDiagramStore((s) => s.setSnapOverride);
  useEffect(() => {
    setSnapOverride(held.backtick ? 'all' : held.meta ? 'guides' : 'none');
  }, [held.backtick, held.meta, setSnapOverride]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Meta') setHeld((h) => (h.meta ? h : { ...h, meta: true }));
      else if (e.key === 'Alt') setHeld((h) => (h.alt ? h : { ...h, alt: true }));
      else if (e.key === '`' && !isTypingTarget(e.target)) setHeld((h) => (h.backtick ? h : { ...h, backtick: true }));
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Meta') setHeld((h) => ({ ...h, meta: false }));
      else if (e.key === 'Alt') setHeld((h) => ({ ...h, alt: false }));
      else if (e.key === '`') setHeld((h) => ({ ...h, backtick: false }));
    };
    // A key released while another window has focus never reports its keyup.
    const reset = () => setHeld({ meta: false, backtick: false, alt: false });
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, []);
  const measureFrom = useMemo(() => {
    if (!held.alt || !hoveredNodeId) return null;
    const selected = nodes.filter((n) => n.selected);
    return selected.length === 1 && selected[0].id !== hoveredNodeId ? selected[0].id : null;
  }, [held.alt, hoveredNodeId, nodes]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Read once, at mount: React Flow only reads `defaultViewport` and `fitView`
  // on init, and CanvasPage mounts this component after the diagram has loaded.
  const [opening] = useState(() => {
    const state = useDiagramStore.getState();
    return { viewport: state.viewport, willFit: !state.viewport && state.nodes.length > 0 };
  });

  // The fit React Flow performs on open moves the canvas itself, and reporting
  // that as a pan would autosave — bumping the timestamp of every diagram the
  // user merely looked at. That one report is skipped, and only when a fit is
  // actually coming: an empty diagram has nothing to fit, so the next move
  // there is a real gesture.
  const skipMoveReport = useRef(opening.willFit);

  const onMoveEnd = useCallback((_event: unknown, viewport: Viewport) => {
    if (skipMoveReport.current) {
      skipMoveReport.current = false;
      return;
    }
    useDiagramStore.getState().setViewport(viewport);
  }, []);

  useEffect(() => {
    if (tool !== 'connector') connectorSourceRef.current = null;
  }, [tool]);

  /** The middle of what is on screen, in board coordinates. */
  const viewCentre = useCallback(() => {
    const box = wrapperRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  }, [screenToFlowPosition]);

  const dropPoint = useCallback(() => paneAnchorRef.current ?? viewCentre(), [viewCentre]);

  // Everything a command is allowed to reach: the store, the viewport, the two
  // clipboards, hold-to-pan and the sheet.
  const commandContext = useMemo<CommandContext>(
    () => ({
      store: useDiagramStore,
      view: { zoomIn, zoomOut, zoomTo, fitView },
      dropPoint,
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
      ui: {
        openShortcuts: () => setShortcutsOpen(true),
        openCommandMenu: () => setCommandMenuOpen(true),
        // Supplied only where there is a session to attribute a comment to.
        // The public share page mounts this same canvas with nobody behind it,
        // and every comment route needs a name against the remark.
        startComment: topBar
          ? () => {
              const anchor = commentAnchorRef.current;
              if (anchor) useCommentStore.getState().beginCompose(anchor);
            }
          : undefined,
      },
    }),
    [zoomIn, zoomOut, zoomTo, fitView, dropPoint, topBar],
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
      commentAnchorRef.current = { nodeId: node.id };
      paneAnchorRef.current = null;
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

  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      // Read now, while the click's screen position still means something: the
      // user can pan before picking "Comment", and the pin belongs where they
      // right-clicked, not where that pixel ends up.
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      commentAnchorRef.current = point;
      // The same point, for a "paste as" — kept separately because the comment
      // anchor is also set by the *node* menu, where it is an id rather than a
      // place, and a paste that landed on the last shape anybody right-clicked
      // would be nowhere the user asked for.
      paneAnchorRef.current = point;
      setContextMenu({ x: event.clientX, y: event.clientY, target: 'pane' });
    },
    [screenToFlowPosition],
  );

  const closeContextMenu = useCallback(() => {
    paneAnchorRef.current = null;
    setContextMenu(null);
  }, []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

  const onNodeDragStart = useCallback(
    (event: MouseEvent | TouchEvent) => {
      if (!('altKey' in event) || !event.altKey) return;
      // Leave a copy behind and keep dragging the originals.
      useDiagramStore.getState().duplicateSelection({ offset: 0, select: false });
    },
    [],
  );

  /**
   * Drops whatever the active drawing tool places, centred on the click, and
   * returns to Select.
   *
   * Its own callback because a frame covers a large part of the board once it
   * is there: a click inside one is a click on a *node*, not on the pane, so
   * the shape tools have to be servable from both handlers or nothing could be
   * drawn inside a frame.
   */
  const placeTool = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      // Clicking a node to draw through it also selects it, and React Flow
      // lifts a selected node a thousand z-indices — which would leave a frame
      // sitting on top of the shape just dropped into it, swallowing the drag
      // that is meant to make it a child. Placing something is not selecting
      // what it was placed over.
      const state = useDiagramStore.getState();
      if (state.nodes.some((n) => n.selected) || state.edges.some((e) => e.selected)) {
        useDiagramStore.setState({
          nodes: state.nodes.map((n) => ({ ...n, selected: false })),
          edges: state.edges.map((e) => ({ ...e, selected: false })),
        });
      }
      if (tool === 'frame') {
        addFrame({ x: point.x - FRAME_OFFSET.x, y: point.y - FRAME_OFFSET.y });
        setTool('select');
        return;
      }
      if (!SHAPE_TOOL_KINDS.includes(tool as ShapeKind)) return;
      const shape = tool as ShapeKind;
      const sizeOffset = shape === 'text' ? { x: 80, y: 20 } : { x: 90, y: 55 };
      addShape(shape, { x: point.x - sizeOffset.x, y: point.y - sizeOffset.y });
      setTool('select');
    },
    [tool, screenToFlowPosition, addShape, addFrame, setTool],
  );

  /**
   * Where a drag lands decides which frame the dragged nodes are in — dropped
   * inside one they join it, dragged out of one they leave. The store converts
   * the positions so nothing moves on screen, and records nothing at all when
   * nothing changed hands.
   */
  const onNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, _node: ShapeNode, nodes: ShapeNode[]) => {
      useDiagramStore.getState().reparentByPosition(nodes.map((n) => n.id));
    },
    [],
  );

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: ShapeNode) => {
      if (swallowClickRef.current) {
        swallowClickRef.current = false;
        return;
      }
      // A frame is a node, so a click inside one never reaches `onPaneClick`.
      // Drawing tools are served here too, or a frame would be a hole in the
      // board that nothing could be drawn into.
      if (tool === 'frame' || SHAPE_TOOL_KINDS.includes(tool as ShapeKind)) {
        placeTool(event);
        return;
      }
      if (tool !== 'connector') return;
      // A floating arrow's endpoints are not shapes the user can connect to.
      if (isAnchorNode(node.data)) return;

      if (!connectorSourceRef.current) {
        connectorSourceRef.current = node.id;
        return;
      }

      if (connectorSourceRef.current === node.id) return;

      const edgeData = useDiagramStore.getState().newConnectorData();
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
    [tool, addEdges, placeTool],
  );

  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      if (swallowClickRef.current) {
        swallowClickRef.current = false;
        return;
      }
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
        const edgeData = useDiagramStore.getState().newConnectorData();
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

      placeTool(event);
    },
    [tool, screenToFlowPosition, setTool, setEditingNodeId, addNodes, addEdges, placeTool],
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
      // The tool is always `select` on a read-only board (the rail is gone and
      // every tool command is gated), so this is the one place a double-click
      // would still drop a text shape onto it.
      if (readOnly) return;
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
    [readOnly, tool, screenToFlowPosition, addShape, setEditingNodeId],
  );

  // Dropping image files anywhere on the canvas inserts them where they
  // landed. `onDragOver` must preventDefault or the browser takes over and
  // navigates the tab to the dropped file.
  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      // Left to the browser on a read-only board, so a dropped file is not
      // silently swallowed by a canvas that was never going to accept it.
      if (readOnly) return;
      if (!Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    [readOnly],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      if (readOnly) return;
      const files = Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) return;
      event.preventDefault();
      insertImages(files, { x: event.clientX, y: event.clientY });
    },
    [readOnly, insertImages],
  );

  /**
   * Tells the other people on this diagram where the pointer is.
   *
   * Reported in flow coordinates, so a peer's cursor lands on the same shape it
   * is over here whatever either window is panned or zoomed to. The store
   * throttles what actually reaches the wire; this only converts.
   */
  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      useCollabStore.getState().reportCursor(
        screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      );
    },
    [screenToFlowPosition],
  );

  // The pointer being *somewhere else* is worth saying: a cursor left where it
  // was last seen claims someone is looking at a shape they have walked away from.
  const onPointerLeave = useCallback(() => useCollabStore.getState().reportCursor(null), []);

  /**
   * A new shape centred on `at`, in the board's default style, with a connector
   * from `sourceId` into the side of it that faces `from`. Both ends are pinned
   * (`sourceAnchor` may be `undefined` when the caller has no side to pin to).
   */
  const createShapeWithConnector = useCallback(
    (sourceId: string, sourceAnchor: EdgeAnchor | undefined, at: Point, from: Point) => {
      const { newShapeData, newConnectorData } = useDiagramStore.getState();
      const id = nanoid(8);
      const width = 180;
      const height = 100;
      addNodes({
        id,
        type: 'shape',
        position: { x: at.x - width / 2, y: at.y - height / 2 },
        width,
        height,
        data: newShapeData('rectangle'),
      });
      const edgeData = { ...newConnectorData(), sourceAnchor, targetAnchor: sideAnchor(facingSide(from, at)) };
      addEdges({
        id: nanoid(8),
        source: sourceId,
        target: id,
        sourceHandle: sourceAnchor?.side,
        type: 'connector',
        zIndex: 1000,
        ...computeMarkers(edgeData),
        data: edgeData,
      });
    },
    [addNodes, addEdges],
  );

  /**
   * The connector tool as a drag: press on a shape, release on another.
   *
   * The line starts at the point on the first shape's outline nearest to the
   * press and ends at the point on the second's nearest to the release, both
   * pinned as a side and a fraction along it — so a connector leaves a shape
   * where the user pointed, and keeps leaving there when the shapes move. A
   * release on empty board makes a new shape there, as dragging a handle out
   * does. A press that never travels is still a click, and falls through to
   * the click-click flow in `onNodeClick` / `onPaneClick`.
   *
   * The handlers live on `window` for the gesture's duration rather than
   * capturing the pointer: capture would redirect the release, and with it the
   * click the old flow relies on, to the wrapper.
   */
  const beginConnectorGesture = useCallback(
    (event: React.PointerEvent) => {
      if (tool !== 'connector' || event.button !== 0 || readOnly) return;
      // A press on a side handle is React Flow's connection, which `onConnect`
      // and `onConnectEnd` pin the same way; running both would draw twice.
      if ((event.target as HTMLElement).closest('.react-flow__handle')) return;
      const nodes = useDiagramStore.getState().nodes;
      const start = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const source = nodeAtPoint(nodes, start, (n) => isAnchorNode(n.data));
      if (!source) return;
      const byId = new Map(nodes.map((n) => [n.id, n] as const));
      const anchor = anchorFor(source, byId, start);
      const rect = boardRect(source, byId);
      if (!anchor || !rect) return;
      const from = anchorToPoint(anchor, rect);
      gestureRef.current = { sourceId: source.id, anchor, from, start, moved: false };

      const finish = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('keydown', onKey);
        gestureRef.current = null;
        setConnectDraft(null);
      };
      const onMove = (e: PointerEvent) => {
        const g = gestureRef.current;
        if (!g) return;
        const to = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        if (!g.moved && Math.hypot(to.x - g.start.x, to.y - g.start.y) < DRAG_THRESHOLD_PX) return;
        g.moved = true;
        setConnectDraft({ from: g.from, to });
      };
      const onUp = (e: PointerEvent) => {
        const g = gestureRef.current;
        finish();
        if (!g || !g.moved) return;
        swallowClickRef.current = true;
        const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const current = useDiagramStore.getState().nodes;
        const target = nodeAtPoint(current, at, (n) => isAnchorNode(n.data) || n.id === g.sourceId);
        if (target) {
          const targetAnchor = anchorFor(target, new Map(current.map((n) => [n.id, n] as const)), at);
          const edgeData = { ...useDiagramStore.getState().newConnectorData(), sourceAnchor: g.anchor, targetAnchor: targetAnchor ?? undefined };
          addEdges({
            id: nanoid(8),
            source: g.sourceId,
            target: target.id,
            sourceHandle: g.anchor.side,
            targetHandle: targetAnchor?.side,
            type: 'connector',
            zIndex: 1000,
            ...computeMarkers(edgeData),
            data: edgeData,
          });
        } else {
          createShapeWithConnector(g.sourceId, g.anchor, at, g.from);
        }
        setTool('select');
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') finish();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('keydown', onKey);
    },
    [tool, readOnly, screenToFlowPosition, addEdges, createShapeWithConnector, setTool],
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
      const fromSide = connectionState.fromHandle?.id;
      const sourceAnchor = isSide(fromSide) ? sideAnchor(fromSide) : undefined;
      // Where the line leaves the source, so the new shape's facing side is
      // judged from there rather than from the pointer.
      const nodes = useDiagramStore.getState().nodes;
      const byId = new Map(nodes.map((n) => [n.id, n] as const));
      const sourceNode = byId.get(connectionState.fromNode.id);
      const rect = sourceNode ? boardRect(sourceNode, byId) : null;
      const from = rect
        ? sourceAnchor
          ? anchorToPoint(sourceAnchor, rect)
          : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        : position;
      createShapeWithConnector(connectionState.fromNode.id, sourceAnchor, position, from);
    },
    [screenToFlowPosition, createShapeWithConnector],
  );

  // What the browser's own paste brings, for the two things ⌘V can mean that
  // our clipboard cannot answer for. This listener only ever runs when
  // `clipboard.paste` did *not* match — its `when` is "we have something of our
  // own copied", and a matched command calls `preventDefault` on the keystroke —
  // so pasting shapes from this app always wins over either branch below.
  //
  // Images are uploaded and referenced by URL: inlining them as base64 used to
  // blow a screenshot-sized paste past the 5 MB limit on the diagram's JSON
  // body, which failed the save rather than the paste.
  //
  // Text is offered to the Mermaid parser, and becomes a flowchart when it is
  // one — the same thing the "Paste Mermaid as flowchart" menu item does, at
  // the middle of the view rather than at a click. Text that is *not* a Mermaid
  // flowchart is left alone and behaves exactly as it always has: pasting a
  // list is still the menu item's job, since a paragraph of prose is far more
  // often meant as words than as a wall of sticky notes.
  useEffect(() => {
    if (readOnly) return;
    function onPaste(e: ClipboardEvent) {
      if (isTypingTarget(e.target)) return;
      const data = e.clipboardData;
      if (!data) return;

      const files: File[] = [];
      for (const item of data.items) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      if (files.length > 0) {
        e.preventDefault();
        insertImages(files);
        return;
      }

      const text = data.getData('text/plain');
      if (!text || !parseMermaidFlowchart(text)) return;
      e.preventDefault();
      void useDiagramStore.getState().pasteMermaid(text, dropPoint());
    }

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [readOnly, insertImages, dropPoint]);

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
      onPointerDown={beginConnectorGesture}
      // Nobody to tell on the public share page — `canComment` stands for "a
      // signed-in member has this open", which is exactly who has presence.
      onPointerMove={canComment ? onPointerMove : undefined}
      onPointerLeave={canComment ? onPointerLeave : undefined}
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
        onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
        onNodeMouseLeave={() => setHoveredNodeId(null)}
        onNodeDragStop={onNodeDragStop}
        // A read-only board used to have no menus at all, every item on them
        // being an edit. "Comment" is the exception — writing one is a
        // viewer's right — so the two menus that offer it open for a signed-in
        // viewer as well, carrying that and the handful of read-only view
        // actions. The public page keeps the browser's own menu: there is no
        // session there to put a name against a remark. `ContextMenu` renders
        // nothing when every item has been gated away, so this never opens an
        // empty panel. The edge menu is unchanged — it is all edits.
        onNodeContextMenu={canComment || !readOnly ? onNodeContextMenu : undefined}
        onEdgeContextMenu={readOnly ? undefined : onEdgeContextMenu}
        onPaneContextMenu={canComment || !readOnly ? onPaneContextMenu : undefined}
        // Grid snapping is opt-in and orthogonal to the shape-to-shape
        // alignment guides, which keep working either way: the grid rounds the
        // drag, the guides still line the shape up with its neighbours.
        snapToGrid={gridSnap && !held.backtick}
        snapGrid={SNAP_GRID}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={30}
        connectionLineStyle={{ stroke: 'var(--color-accent-500)', strokeWidth: 2.5 }}
        // The right button opens the context menu, so panning is the middle
        // button plus the hand tool and hold-to-pan.
        panOnDrag={tool === 'pan' ? true : [1]}
        selectionOnDrag={!readOnly && tool === 'select'}
        // React Flow's own three gates. Dragging and connecting are edits; and
        // with nothing selectable there is no selection for the floating
        // toolbar to act on, which is the belt to the braces of not rendering it.
        // Nothing is draggable while a drawing tool is held either: a click on
        // a node is how a shape is placed inside a frame, and a drag would
        // shove the frame around instead of dropping anything into it.
        nodesDraggable={!readOnly && !isDrawingTool}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={2.5}
        onMoveEnd={onMoveEnd}
        // A diagram that has been panned reopens exactly where it was left.
        // Without a stored viewport, CanvasPage has already loaded the diagram
        // by the time this mounts, so fitView frames the actual content — and
        // defaultViewport is what an empty diagram, with nothing to fit, gets.
        fitView={!opening.viewport}
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        defaultViewport={opening.viewport ?? { x: 0, y: 0, zoom: 0.8 }}
        className={`${tool === 'pan' ? 'cursor-grab' : isDrawingTool ? 'cursor-crosshair' : ''} ${tool === 'connector' ? 'connector-mode' : ''}`}
        proOptions={{ hideAttribution: true }}
      >
        {/* Both the backdrop and the dots come from the theme tokens, so the
            board follows a theme change with no re-render: `rf-canvas` paints
            the ground, and React Flow forwards `color` into a custom property
            the dot's `fill` reads, so a `var()` here resolves at paint time. */}
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--canvas-dot)" className="rf-canvas" />
        <ConnectorMarkerDefs />
        {canComment && <CommentPins />}
        {canComment && <PresenceCursors />}
        <AlignmentGuides />
        {measureFrom && hoveredNodeId && <MeasureOverlay fromId={measureFrom} toId={hoveredNodeId} />}
        {connectDraft && (
          <ViewportPortal>
            <svg
              aria-hidden="true"
              data-testid="connector-draft"
              style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
            >
              <line
                x1={connectDraft.from.x}
                y1={connectDraft.from.y}
                x2={connectDraft.to.x}
                y2={connectDraft.to.y}
                stroke="var(--color-accent-500)"
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            </svg>
          </ViewportPortal>
        )}
        {minimap && <CanvasMiniMap />}
      </ReactFlow>

      {topBar && <TopBar />}
      {!readOnly && (
        <>
          <LeftRail />
          <FloatingToolbar />
          <TextFormatBar />
        </>
      )}
      <BottomBar onRunCommand={runCommand} />
      {/* Rendered whether or not the board can be edited: ⌘F is a way of
          reading a diagram, and the public share page mounts this too. */}
      <SearchBar belowTopBar={topBar} />

      {contextMenu && (
        <ContextMenu state={contextMenu} ctx={commandContext} onClose={closeContextMenu} />
      )}
      {shortcutsOpen && <ShortcutSheet onClose={closeShortcuts} />}
      {commandMenuOpen && <CommandMenu ctx={commandContext} onClose={() => setCommandMenuOpen(false)} />}
    </div>
  );
}
