import { renderDiagramPng } from '../lib/exportImage';
import { useViewPreferences } from '../store/useViewPreferences';
import type { AlignMode, DistributeAxis } from '../lib/arrange';
import type { FontSize, ShapeKind, Tool } from '../types';
import { createRegistry } from './registry';
import type { Command, CommandContext, DiagramState, Keybinding } from './types';

export { bindingsOf, formatShortcut, shortcutLabels, detectPlatform } from './registry';

const ZOOM_MS = 150;
const FIT_MS = 300;
const FIT_PADDING = 0.2;

const FONT_SIZES: FontSize[] = ['small', 'medium', 'large'];

function selectedNodes(state: DiagramState) {
  return state.nodes.filter((node) => node.selected);
}

function selectedEdges(state: DiagramState) {
  return state.edges.filter((edge) => edge.selected);
}

function hasSelection(ctx: CommandContext): boolean {
  const state = ctx.store.getState();
  return state.nodes.some((n) => n.selected) || state.edges.some((e) => e.selected);
}

function hasSelectedNode(ctx: CommandContext): boolean {
  return ctx.store.getState().nodes.some((n) => n.selected);
}

/** ⌘C and ⌘X capture the same payload; only the cut goes on to delete it. */
function captureSelection(ctx: CommandContext) {
  const state = ctx.store.getState();
  const nodes = selectedNodes(state);
  const edges = selectedEdges(state);
  const nodeIds = new Set(nodes.map((n) => n.id));
  // With only shapes selected, the connectors between them come along too.
  const connected = edges.length > 0
    ? edges
    : state.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  ctx.clipboard.set({
    nodes: nodes.map((n) => ({ ...n, selected: false })),
    edges: connected.map((e) => ({ ...e, selected: false })),
  });
}

function stepFontSize(ctx: CommandContext, delta: 1 | -1) {
  const state = ctx.store.getState();
  const selected = state.nodes.find((n) => n.selected);
  if (!selected) return;
  const index = FONT_SIZES.indexOf(selected.data.fontSize ?? 'medium');
  const next = Math.min(FONT_SIZES.length - 1, Math.max(0, index + delta));
  state.updateSelectedNodesData({ fontSize: FONT_SIZES[next] });
}

function deselectAll(ctx: CommandContext) {
  const state = ctx.store.getState();
  ctx.store.setState({
    nodes: state.nodes.map((n) => ({ ...n, selected: false })),
    edges: state.edges.map((e) => ({ ...e, selected: false })),
  });
}

function nudge(dx: number, dy: number): (ctx: CommandContext) => void {
  return (ctx) => ctx.store.getState().nudgeSelected(dx, dy);
}

/** The tools that get a single-letter shortcut, in left-rail order. */
const TOOL_COMMANDS: { tool: Tool; title: string; keys: string[] }[] = [
  { tool: 'select', title: 'Select tool', keys: ['v'] },
  { tool: 'pan', title: 'Pan tool', keys: ['h'] },
  { tool: 'rectangle', title: 'Rectangle', keys: ['r'] },
  { tool: 'ellipse', title: 'Ellipse', keys: ['o'] },
  { tool: 'diamond', title: 'Diamond', keys: ['d'] },
  { tool: 'pill', title: 'Pill', keys: ['u'] },
  { tool: 'triangle', title: 'Triangle', keys: ['g'] },
  { tool: 'hexagon', title: 'Hexagon', keys: ['x'] },
  { tool: 'cylinder', title: 'Cylinder', keys: ['y'] },
  { tool: 'sticky', title: 'Sticky note', keys: ['s', 'n'] },
  { tool: 'text', title: 'Text', keys: ['t'] },
  { tool: 'connector', title: 'Connector', keys: ['a', 'l'] },
];

const toolCommands: Command[] = TOOL_COMMANDS.map(({ tool, title, keys }) => ({
  id: `tool.${tool}`,
  title,
  group: 'tools',
  shortcut: keys.map((key) => ({ key })),
  run: (ctx) => ctx.store.getState().setTool(tool),
}));

/**
 * The single source of truth for what FlowSketch can do from the keyboard, the
 * right-click menu and the cheat sheet. Order matters only where two commands
 * share a keystroke and are told apart by `when` — the first match wins.
 */
export const commands: Command[] = [
  ...toolCommands,

  // ---- history -----------------------------------------------------------
  {
    id: 'history.undo',
    title: 'Undo',
    group: 'history',
    shortcut: { key: 'z', meta: true },
    run: (ctx) => ctx.store.getState().undo(),
  },
  {
    id: 'history.redo',
    title: 'Redo',
    group: 'history',
    shortcut: { key: 'z', meta: true, shift: true },
    run: (ctx) => ctx.store.getState().redo(),
  },

  // ---- selection ---------------------------------------------------------
  {
    id: 'select.all',
    title: 'Select all',
    group: 'select',
    shortcut: { key: 'a', meta: true },
    contextMenu: 'pane',
    run: (ctx) => {
      const state = ctx.store.getState();
      // Locked shapes stay out of it — they cannot be moved or deleted anyway.
      ctx.store.setState({
        nodes: state.nodes.map((n) => ({ ...n, selected: !n.data.locked })),
        edges: state.edges.map((e) => ({ ...e, selected: true })),
      });
    },
  },
  {
    id: 'edit.escape',
    title: 'Deselect / cancel',
    group: 'select',
    shortcut: { key: 'Escape' },
    // While a label is open, Escape belongs to the editor, not to the canvas.
    when: (ctx) => {
      const state = ctx.store.getState();
      return !state.editingNodeId && !state.editingEdgeId;
    },
    run: (ctx) => {
      deselectAll(ctx);
      ctx.store.getState().setTool('select');
    },
  },

  // ---- editing -----------------------------------------------------------
  {
    id: 'edit.editText',
    title: 'Edit text',
    group: 'edit',
    shortcut: { key: 'Enter' },
    contextMenu: 'node',
    when: (ctx) => selectedNodes(ctx.store.getState()).length === 1,
    run: (ctx) => {
      const [node] = selectedNodes(ctx.store.getState());
      if (node) ctx.store.getState().setEditingNodeId(node.id);
    },
  },
  {
    id: 'edit.editEdgeLabel',
    title: 'Edit label',
    group: 'edit',
    shortcut: { key: 'Enter' },
    contextMenu: 'edge',
    when: (ctx) => {
      const state = ctx.store.getState();
      return selectedNodes(state).length === 0 && selectedEdges(state).length === 1;
    },
    run: (ctx) => {
      const [edge] = selectedEdges(ctx.store.getState());
      if (edge) ctx.store.getState().setEditingEdgeId(edge.id);
    },
  },
  {
    id: 'edit.delete',
    title: 'Delete',
    group: 'edit',
    shortcut: [{ key: 'Backspace' }, { key: 'Delete' }],
    contextMenu: ['node', 'edge'],
    run: (ctx) => ctx.store.getState().deleteSelection(),
  },
  {
    id: 'edit.duplicate',
    title: 'Duplicate',
    group: 'edit',
    shortcut: { key: 'd', meta: true },
    contextMenu: 'node',
    run: (ctx) => ctx.store.getState().duplicateSelection(),
  },

  // ---- clipboard ---------------------------------------------------------
  {
    id: 'clipboard.copy',
    title: 'Copy',
    group: 'clipboard',
    shortcut: { key: 'c', meta: true },
    contextMenu: 'node',
    when: hasSelection,
    run: captureSelection,
  },
  {
    id: 'clipboard.cut',
    title: 'Cut',
    group: 'clipboard',
    shortcut: { key: 'x', meta: true },
    contextMenu: 'node',
    when: hasSelection,
    run: (ctx) => {
      captureSelection(ctx);
      ctx.store.getState().deleteSelection();
    },
  },
  {
    id: 'clipboard.paste',
    title: 'Paste',
    group: 'clipboard',
    shortcut: { key: 'v', meta: true },
    contextMenu: 'pane',
    // With nothing of ours on the clipboard, ⌘V has to fall through to the
    // browser so an image copied from another app can still be pasted.
    when: (ctx) => (ctx.clipboard.get()?.nodes.length ?? 0) > 0,
    run: (ctx) => {
      const clip = ctx.clipboard.get();
      if (!clip) return;
      // Paste again from what was just pasted, so repeats keep stepping away.
      ctx.clipboard.set(ctx.store.getState().pasteClipboard(clip));
    },
  },
  {
    id: 'clipboard.copyAsImage',
    title: 'Copy as image',
    group: 'clipboard',
    shortcut: { key: 'c', meta: true, shift: true },
    run: () => {
      void renderDiagramPng().then(async (dataUrl) => {
        if (!dataUrl) return;
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      });
    },
  },

  // ---- style -------------------------------------------------------------
  {
    id: 'style.copy',
    title: 'Copy style',
    group: 'style',
    shortcut: { key: 'c', meta: true, alt: true },
    run: (ctx) => {
      const selected = ctx.store.getState().nodes.find((n) => n.selected);
      if (!selected) return;
      const { fill, stroke, fontSize, bold, italic, textAlign, verticalAlign } = selected.data;
      ctx.styleClipboard.set({ fill, stroke, fontSize, bold, italic, textAlign, verticalAlign });
    },
  },
  {
    id: 'style.paste',
    title: 'Paste style',
    group: 'style',
    shortcut: { key: 'v', meta: true, alt: true },
    run: (ctx) => {
      const style = ctx.styleClipboard.get();
      if (style) ctx.store.getState().updateSelectedNodesData(style);
    },
  },
  {
    id: 'style.saveDefault',
    title: 'Save as default style',
    group: 'style',
    shortcut: { key: 'd', meta: true, shift: true },
    run: (ctx) => {
      const state = ctx.store.getState();
      const selected = state.nodes.find((n) => n.selected);
      if (selected) state.setDefaultStyle({ fill: selected.data.fill, stroke: selected.data.stroke });
    },
  },
  {
    id: 'style.fontSizeUp',
    title: 'Increase font size',
    group: 'style',
    shortcut: { key: '=', meta: true, alt: true },
    run: (ctx) => stepFontSize(ctx, 1),
  },
  {
    id: 'style.fontSizeDown',
    title: 'Decrease font size',
    group: 'style',
    shortcut: { key: '-', meta: true, alt: true },
    run: (ctx) => stepFontSize(ctx, -1),
  },

  // ---- arrange -----------------------------------------------------------
  {
    id: 'arrange.bringToFront',
    title: 'Bring to front',
    group: 'arrange',
    shortcut: { key: ']' },
    contextMenu: 'node',
    run: (ctx) => ctx.store.getState().bringToFront(),
  },
  {
    id: 'arrange.sendToBack',
    title: 'Send to back',
    group: 'arrange',
    shortcut: { key: '[' },
    contextMenu: 'node',
    run: (ctx) => ctx.store.getState().sendToBack(),
  },
  {
    id: 'arrange.bringForward',
    title: 'Bring forward',
    group: 'arrange',
    shortcut: { key: ']', meta: true },
    run: (ctx) => ctx.store.getState().bringForward(),
  },
  {
    id: 'arrange.sendBackward',
    title: 'Send backward',
    group: 'arrange',
    shortcut: { key: '[', meta: true },
    run: (ctx) => ctx.store.getState().sendBackward(),
  },
  {
    id: 'arrange.toggleLock',
    title: 'Lock / unlock',
    group: 'arrange',
    shortcut: { key: 'l', meta: true, shift: true },
    contextMenu: 'node',
    run: (ctx) => ctx.store.getState().toggleLock(),
  },
  {
    id: 'arrange.nudgeUp',
    title: 'Nudge up',
    group: 'arrange',
    shortcut: { key: 'ArrowUp' },
    when: hasSelectedNode,
    run: nudge(0, -1),
  },
  {
    id: 'arrange.nudgeDown',
    title: 'Nudge down',
    group: 'arrange',
    shortcut: { key: 'ArrowDown' },
    when: hasSelectedNode,
    run: nudge(0, 1),
  },
  {
    id: 'arrange.nudgeLeft',
    title: 'Nudge left',
    group: 'arrange',
    shortcut: { key: 'ArrowLeft' },
    when: hasSelectedNode,
    run: nudge(-1, 0),
  },
  {
    id: 'arrange.nudgeRight',
    title: 'Nudge right',
    group: 'arrange',
    shortcut: { key: 'ArrowRight' },
    when: hasSelectedNode,
    run: nudge(1, 0),
  },
  {
    id: 'arrange.nudgeUpFar',
    title: 'Nudge up 10 px',
    group: 'arrange',
    shortcut: { key: 'ArrowUp', shift: true },
    when: hasSelectedNode,
    run: nudge(0, -10),
  },
  {
    id: 'arrange.nudgeDownFar',
    title: 'Nudge down 10 px',
    group: 'arrange',
    shortcut: { key: 'ArrowDown', shift: true },
    when: hasSelectedNode,
    run: nudge(0, 10),
  },
  {
    id: 'arrange.nudgeLeftFar',
    title: 'Nudge left 10 px',
    group: 'arrange',
    shortcut: { key: 'ArrowLeft', shift: true },
    when: hasSelectedNode,
    run: nudge(-10, 0),
  },
  {
    id: 'arrange.nudgeRightFar',
    title: 'Nudge right 10 px',
    group: 'arrange',
    shortcut: { key: 'ArrowRight', shift: true },
    when: hasSelectedNode,
    run: nudge(10, 0),
  },

  // ---- view --------------------------------------------------------------
  {
    id: 'view.zoomIn',
    title: 'Zoom in',
    group: 'view',
    // "+" is ⇧= on most layouts and its own key on a numpad, so both spellings
    // are bound with and without ⌘.
    shortcut: [
      { key: '=' },
      { key: '+' },
      { key: '+', shift: true },
      { key: '=', meta: true },
      { key: '+', meta: true },
      { key: '+', meta: true, shift: true },
    ],
    run: (ctx) => ctx.view.zoomIn({ duration: ZOOM_MS }),
  },
  {
    id: 'view.zoomOut',
    title: 'Zoom out',
    group: 'view',
    shortcut: [{ key: '-' }, { key: '-', meta: true }],
    run: (ctx) => ctx.view.zoomOut({ duration: ZOOM_MS }),
  },
  {
    id: 'view.zoomReset',
    title: 'Reset zoom to 100%',
    group: 'view',
    shortcut: { key: '0' },
    contextMenu: 'pane',
    run: (ctx) => ctx.view.zoomTo(1, { duration: ZOOM_MS }),
  },
  {
    id: 'view.fitView',
    title: 'Fit to view',
    group: 'view',
    shortcut: [{ key: '1' }, { key: '0', meta: true }],
    contextMenu: 'pane',
    run: (ctx) => ctx.view.fitView({ padding: FIT_PADDING, duration: FIT_MS }),
  },
  {
    id: 'view.fitSelection',
    title: 'Zoom to selection',
    group: 'view',
    shortcut: { key: '2' },
    when: hasSelectedNode,
    run: (ctx) => {
      const nodes = selectedNodes(ctx.store.getState()).map((n) => ({ id: n.id }));
      if (nodes.length > 0) ctx.view.fitView({ nodes, padding: FIT_PADDING, duration: FIT_MS });
    },
  },
  {
    id: 'view.pan',
    title: 'Pan (hold)',
    group: 'view',
    shortcut: { key: ' ' },
    // Already panning means this is a key repeat, or the hand tool is active:
    // either way there is nothing to remember and nothing to switch.
    when: (ctx) => ctx.store.getState().tool !== 'pan',
    run: (ctx) => ctx.pan.begin(),
  },
  {
    id: 'view.shortcuts',
    title: 'Keyboard shortcuts',
    group: 'view',
    // "?" is ⇧/ on most layouts; the bare binding covers the ones where it is not.
    shortcut: [{ key: '?' }, { key: '?', shift: true }, { key: '/', shift: true }],
    run: (ctx) => ctx.ui.openShortcuts(),
  },

  // ---- arrange: align & distribute ---------------------------------------
  // Aligning needs something to align *to*, so every one of these is gated on
  // a real multi-selection: two nodes for align, three for distribute (the
  // outer two stay put, so below three there is no middle to spread).
  //
  // ⌥ rewrites `event.key` on macOS — ⌥⇧H arrives as "Ó" — which is exactly
  // what the registry's `event.code` fallback is for, so the letters are still
  // written here the way they are printed on the key.
  ...alignCommands(),
  ...distributeCommands(),

  // ---- view: canvas chrome -----------------------------------------------
  // Both toggles live in `useViewPreferences` rather than the diagram store:
  // they are per-browser preferences, not part of any diagram. Neither takes a
  // keystroke — the letters left are worth more to a tool — so they reach the
  // user through the bottom bar, and through here for the sake of one list.
  {
    id: 'view.toggleMinimap',
    title: 'Show minimap',
    group: 'view',
    run: () => useViewPreferences.getState().toggleMinimap(),
  },
  {
    id: 'view.toggleGridSnap',
    title: 'Snap to grid',
    group: 'view',
    run: () => useViewPreferences.getState().toggleGridSnap(),
  },
];

export const registry = createRegistry(commands);

/** Cheat-sheet section order and headings. */
export const GROUP_LABELS: { group: Command['group']; label: string }[] = [
  { group: 'tools', label: 'Tools' },
  { group: 'edit', label: 'Editing' },
  { group: 'select', label: 'Selection' },
  { group: 'arrange', label: 'Arrange' },
  { group: 'clipboard', label: 'Clipboard' },
  { group: 'style', label: 'Style' },
  { group: 'view', label: 'View' },
  { group: 'history', label: 'History' },
];

/**
 * Align: one command per edge of the selection's bounding box, on ⌥⇧ plus the
 * arrow that points at that edge, with ⌥⇧H / ⌥⇧V for the two centre lines.
 *
 * Declared as a hoisted function so the commands themselves sit at the end of
 * the list, where a new one can be added without touching anything above it.
 */
function alignCommands(): Command[] {
  const modes: [AlignMode, string, Keybinding][] = [
    ['left', 'Align left', { key: 'ArrowLeft', alt: true, shift: true }],
    ['right', 'Align right', { key: 'ArrowRight', alt: true, shift: true }],
    ['top', 'Align top', { key: 'ArrowUp', alt: true, shift: true }],
    ['bottom', 'Align bottom', { key: 'ArrowDown', alt: true, shift: true }],
    ['centerX', 'Align horizontal centres', { key: 'h', alt: true, shift: true }],
    ['centerY', 'Align vertical centres', { key: 'v', alt: true, shift: true }],
  ];

  return modes.map(([mode, title, shortcut]) => ({
    id: `arrange.align${mode[0].toUpperCase()}${mode.slice(1)}`,
    title,
    group: 'arrange',
    shortcut,
    contextMenu: 'node',
    when: (ctx) => selectedNodes(ctx.store.getState()).length >= 2,
    run: (ctx) => ctx.store.getState().alignSelected(mode),
  }));
}

/**
 * Distribute: the same H / V letters as the centre-line aligns, one modifier up.
 *
 * ⌥⌃H / ⌥⌃V would read better, but this registry folds ⌘ and Ctrl into one
 * `meta` flag — so a ⌃⌥V binding is indistinguishable from ⌘⌥V, which
 * `style.paste` already owns and which is matched first. ⇧ keeps them apart.
 */
function distributeCommands(): Command[] {
  const axes: [DistributeAxis, string, string][] = [
    ['x', 'Distribute horizontally', 'h'],
    ['y', 'Distribute vertically', 'v'],
  ];

  return axes.map(([axis, title, key]) => ({
    id: `arrange.distribute${axis.toUpperCase()}`,
    title,
    group: 'arrange',
    shortcut: { key, meta: true, alt: true, shift: true },
    contextMenu: 'node',
    // The outermost two never move, so there is nothing to spread below three.
    when: (ctx) => selectedNodes(ctx.store.getState()).length >= 3,
    run: (ctx) => ctx.store.getState().distributeSelected(axis),
  }));
}

/** The shape kinds a tool command can place, so Canvas can keep its own list honest. */
export const SHAPE_TOOL_KINDS: ShapeKind[] = [
  'rectangle',
  'ellipse',
  'diamond',
  'sticky',
  'text',
  'pill',
  'triangle',
  'hexagon',
  'cylinder',
];
