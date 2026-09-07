import { canAutoLayout } from '../lib/autoLayout';
import { MIND_MAP_NODE_SIZE, childrenOf, mapOf } from '../lib/mindMap';
import { linesOf } from '../lib/pasteAs';
import { isSameThumbnail } from '../lib/boardThumbnail';
import { renderDiagramPng } from '../lib/exportImage';
import { isFrameNode, isGroupNode } from '../lib/nodeKinds';
import { slidesOf } from '../lib/presentation';
import { parseTableText } from '../lib/table';
import { subtreeIds } from '../lib/nodeTree';
import { DEFAULT_STYLE_KIND_LABELS, kindOf } from '../lib/defaultStyle';
import { canGroupSelection } from '../store/useDiagramStore';
import { toastError, toastInfo } from '../store/useToastStore';
import { useSearchStore } from '../store/useSearchStore';
import { usePresentStore } from '../store/usePresentStore';
import { useViewPreferences } from '../store/useViewPreferences';
import type { AlignMode, DistributeAxis } from '../lib/arrange';
import { nextFontSize } from '../lib/text';
import type { ShapeKind, Tool } from '../types';
import { createRegistry } from './registry';
import type { Command, CommandContext, DiagramState, Keybinding } from './types';

export { bindingsOf, formatShortcut, shortcutLabels, detectPlatform } from './registry';

const ZOOM_MS = 150;
const FIT_MS = 300;
const FIT_PADDING = 0.2;

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
  // A container is one thing on the board: copying a group or a frame copies
  // what is inside it, or the paste would be an empty box.
  const nodeIds = subtreeIds(state.nodes, selectedNodes(state).map((n) => n.id));
  const nodes = state.nodes.filter((n) => nodeIds.has(n.id));
  const edges = selectedEdges(state);
  // With only shapes selected, the connectors between them come along too.
  const connected = edges.length > 0
    ? edges
    : state.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  ctx.clipboard.set({
    nodes: nodes.map((n) => ({ ...n, selected: false })),
    edges: connected.map((e) => ({ ...e, selected: false })),
  });
}

/**
 * The clipboard's text, or `null` when the browser would not hand it over.
 *
 * Reading the system clipboard needs the user's permission, and a refusal is
 * not an error to swallow: the user pressed a menu item and nothing happened,
 * so it is said out loud. (Our *own* ⌘C clipboard is a ref in `Canvas` and
 * needs none of this — a "paste as" is about text that came from another app.)
 */
async function clipboardText(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    toastError('Clipboard access was refused');
    return null;
  }
}

/** "Paste as sticky notes": one note per line of whatever is on the clipboard. */
async function pasteAsStickies(ctx: CommandContext) {
  const origin = ctx.dropPoint();
  const text = await clipboardText();
  if (text === null) return;
  if (ctx.store.getState().pasteAsStickies(text, origin).length === 0) {
    toastError('There are no lines of text on the clipboard');
  }
}

/**
 * "Paste Mermaid": the clipboard's source, parsed and laid out.
 *
 * **Two kinds behind one menu item**, which is why the title no longer names
 * the flowchart: a `sequenceDiagram` becomes participants, lifelines and
 * messages (`pasteSequence`, exact and synchronous) and a `graph` / `flowchart`
 * becomes shapes and connectors run through the layout engine (`pasteMermaid`).
 * The sequence parser is asked first because its header is the cheaper of the
 * two to refuse, and neither can accept the other's source.
 */
async function pasteMermaid(ctx: CommandContext) {
  const origin = ctx.dropPoint();
  const text = await clipboardText();
  if (text === null) return;
  const store = ctx.store.getState();
  if (store.pasteSequence(text, origin) !== null) return;
  const pasted = await store.pasteMermaid(text, origin);
  if (pasted === null) toastError("That isn't a Mermaid flowchart or sequence diagram");
}

/** "Paste as table": a Markdown pipe table, a TSV or a CSV, as one table node. */
async function pasteAsTable(ctx: CommandContext) {
  const origin = ctx.dropPoint();
  const text = await clipboardText();
  if (text === null) return;
  const table = parseTableText(text);
  if (!table) {
    toastError("That isn't a table");
    return;
  }
  ctx.store.getState().addTable(origin, table);
}

/**
 * The mind-map node a mind-map command acts on: the one being typed into if
 * there is one, and otherwise the single selected node — in both cases only
 * when it really is a mind-map node.
 *
 * The editing node comes first because that is the state the gesture spends
 * most of its time in: press Tab, type, press Enter, type. Selection follows
 * editing anyway (every mind-map action selects what it just made), so the two
 * answers agree; the order only matters if something else moved the selection
 * while a label was open.
 */
function mindMapTarget(ctx: CommandContext): string | null {
  const state = ctx.store.getState();
  const node = state.editingNodeId
    ? state.nodes.find((n) => n.id === state.editingNodeId)
    : selectedNodes(state).length === 1
      ? selectedNodes(state)[0]
      : undefined;
  return node?.data.mindMap ? node.id : null;
}

/** How many children the mind-map target has — 0 when there is no target. */
function mindMapChildCount(ctx: CommandContext): number {
  const id = mindMapTarget(ctx);
  if (!id) return 0;
  const state = ctx.store.getState();
  const root = state.nodes.find((n) => n.id === id)?.data.mindMap?.root;
  const tree = root ? mapOf(state.nodes, state.edges, root) : null;
  return tree ? childrenOf(tree, id).length : 0;
}

/** "Paste as child nodes": one child per line of whatever is on the clipboard. */
async function pasteMindMapChildren(ctx: CommandContext) {
  const id = mindMapTarget(ctx);
  if (!id) return;
  const text = await clipboardText();
  if (text === null) return;
  if (ctx.store.getState().mindMapAddChildren(id, linesOf(text)).length === 0) {
    toastError('There are no lines of text on the clipboard');
  }
}

function stepFontSize(ctx: CommandContext, delta: 1 | -1) {
  const state = ctx.store.getState();
  const selected = state.nodes.find((n) => n.selected);
  if (!selected) return;
  // The first selected shape sets the size the whole selection steps to, the
  // same way the toolbar's −/+ read it.
  state.updateSelectedNodesData({ fontSize: nextFontSize(selected.data.fontSize, delta) });
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

/**
 * The tools that get a single-letter shortcut, in left-rail order.
 *
 * `shift` applies to every key on the row — a tool either has a bare letter or
 * a shifted one, and the three pens are what needed the flag: B is the marker
 * and ⇧B the highlighter, the way one tool's variant is reached in every
 * drawing app.
 */
const TOOL_COMMANDS: { tool: Tool; title: string; keys: string[]; shift?: boolean }[] = [
  { tool: 'select', title: 'Select tool', keys: ['v'] },
  { tool: 'pan', title: 'Pan tool', keys: ['h'] },
  { tool: 'rectangle', title: 'Rectangle', keys: ['r'] },
  { tool: 'ellipse', title: 'Ellipse', keys: ['o'] },
  { tool: 'diamond', title: 'Diamond', keys: ['d'] },
  { tool: 'pill', title: 'Pill', keys: ['u'] },
  { tool: 'parallelogram', title: 'Parallelogram', keys: ['p'] },
  { tool: 'triangle', title: 'Triangle', keys: ['g'] },
  { tool: 'hexagon', title: 'Hexagon', keys: ['x'] },
  { tool: 'cylinder', title: 'Cylinder', keys: ['y'] },
  { tool: 'sticky', title: 'Sticky note', keys: ['s', 'n'] },
  { tool: 'text', title: 'Text', keys: ['t'] },
  // A frame is not a shape — it is a section other shapes go into — so it has
  // no `ShapeKind` and is placed by `addFrame`, but it is picked like any tool.
  // Whimsical calls a frame a section and reaches it with `.`; its connector
  // key is C. Both are kept alongside ours so either habit works.
  { tool: 'frame', title: 'Frame', keys: ['f', '.'] },
  // Nor is a table: it is a grid of cells, placed by `addTable`. Whimsical
  // reaches its table tool with E, and E was the letter left.
  { tool: 'table', title: 'Table', keys: ['e'] },
  { tool: 'connector', title: 'Connector', keys: ['c', 'a', 'l'] },
  // The three freehand tools. Whimsical reaches its pen with H and its eraser
  // with E; neither is free here — H has been the hand (pan) tool since before
  // there was a pen, and E is the table tool — and moving a tool key that is
  // already in somebody's fingers to make room for a new one is the wrong
  // trade. B is the marker (the brush key of every drawing app), ⇧B the
  // highlighter, and ⇧E the eraser, which keeps the letter Whimsical uses.
  { tool: 'pen', title: 'Pen', keys: ['b'] },
  { tool: 'highlighter', title: 'Highlighter', keys: ['b'], shift: true },
  { tool: 'eraser', title: 'Eraser', keys: ['e'], shift: true },
];

const toolCommands: Command[] = TOOL_COMMANDS.map(({ tool, title, keys, shift }) => ({
  id: `tool.${tool}`,
  title,
  group: 'tools',
  shortcut: keys.map((key) => (shift ? { key, shift: true } : { key })),
  run: (ctx) => ctx.store.getState().setTool(tool),
}));

/**
 * Everything FlowSketch can do from the keyboard, the right-click menu and the
 * cheat sheet, as declared. Order matters only where two commands share a
 * keystroke and are told apart by `when` — the first match wins.
 *
 * Exported as `commands` below, once the read-only gate has been folded in —
 * and exported raw for the tests that assert on the bindings *as declared*,
 * which the gate would otherwise hide behind a `when` on every command.
 */
export const commandDeclarations: Command[] = [
  ...toolCommands,

  // ---- comments ----------------------------------------------------------
  {
    id: 'comment.add',
    title: 'Comment',
    group: 'comments',
    // First on both menus: it is the one thing here that is offered to a
    // viewer, and a reviewer should not have to read past nine editing
    // actions to find it.
    contextMenu: ['node', 'pane'],
    // No `when`. The gate is that `startComment` is only supplied by a canvas
    // with a session behind it, and the public share page opens no context
    // menu at all — so a predicate here would only ever answer for a menu
    // nobody can see. It is on `READ_ONLY_COMMAND_IDS` because commenting is
    // a viewer's right, not an edit of the diagram.
    run: (ctx) => ctx.ui.startComment?.(),
  },

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

  // ---- mind maps ---------------------------------------------------------
  // **These come before `edit.editText` on purpose.** Enter and Tab are shared
  // keystrokes, and a shared keystroke is settled by `when` and by order: each
  // gate below is strictly narrower than the one it is jumping ahead of (a
  // single selected node that is *also* a mind-map node), so Enter still opens
  // an ordinary shape's label everywhere else. The other half of the trick is
  // in `Canvas`'s keyboard handler, which lets exactly these commands through
  // from inside an open label — a mind map is typed, not clicked, and the label
  // is still open when the next node is asked for.
  {
    id: 'mindmap.addRoot',
    title: 'Mind map',
    group: 'mindmap',
    // Whimsical's M. The root lands in the middle of the view, or where the
    // canvas menu was opened.
    shortcut: { key: 'm' },
    contextMenu: 'pane',
    when: (ctx) => {
      const state = ctx.store.getState();
      return !state.editingNodeId && !state.editingEdgeId;
    },
    run: (ctx) => {
      const point = ctx.dropPoint();
      ctx.store.getState().mindMapAddRoot({
        x: point.x - MIND_MAP_NODE_SIZE.width / 2,
        y: point.y - MIND_MAP_NODE_SIZE.height / 2,
      });
    },
  },
  {
    id: 'mindmap.addChild',
    title: 'Add child',
    group: 'mindmap',
    shortcut: { key: 'Tab' },
    contextMenu: 'node',
    when: (ctx) => mindMapTarget(ctx) !== null,
    run: (ctx) => {
      const id = mindMapTarget(ctx);
      if (id) ctx.store.getState().mindMapAddChild(id);
    },
  },
  {
    id: 'mindmap.addSibling',
    title: 'Add sibling',
    group: 'mindmap',
    shortcut: { key: 'Enter' },
    contextMenu: 'node',
    when: (ctx) => mindMapTarget(ctx) !== null,
    run: (ctx) => {
      const id = mindMapTarget(ctx);
      if (id) ctx.store.getState().mindMapAddSibling(id);
    },
  },
  {
    id: 'mindmap.addSiblingAbove',
    title: 'Add sibling above',
    group: 'mindmap',
    shortcut: { key: 'Enter', meta: true },
    contextMenu: 'node',
    when: (ctx) => mindMapTarget(ctx) !== null,
    run: (ctx) => {
      const id = mindMapTarget(ctx);
      if (id) ctx.store.getState().mindMapAddSibling(id, true);
    },
  },
  {
    id: 'mindmap.addParent',
    title: 'Add parent',
    group: 'mindmap',
    shortcut: { key: 'Enter', alt: true },
    contextMenu: 'node',
    when: (ctx) => mindMapTarget(ctx) !== null,
    run: (ctx) => {
      const id = mindMapTarget(ctx);
      if (id) ctx.store.getState().mindMapAddParent(id);
    },
  },
  {
    id: 'mindmap.toggleCollapse',
    title: 'Collapse / expand branch',
    group: 'mindmap',
    shortcut: { key: '/', meta: true },
    contextMenu: 'node',
    // A leaf has nothing to fold, and the action refuses one anyway; gating on
    // it here is what keeps the entry off the menu of a node with no branch.
    when: (ctx) => mindMapChildCount(ctx) > 0,
    run: (ctx) => {
      const id = mindMapTarget(ctx);
      if (id) ctx.store.getState().mindMapToggleCollapse(id);
    },
  },
  {
    id: 'mindmap.pasteChildren',
    title: 'Paste as child nodes',
    group: 'mindmap',
    // No keystroke, for the reason the other two "paste as" commands have
    // none: what is on the system clipboard cannot be known until the user has
    // already asked for it.
    contextMenu: 'node',
    when: (ctx) => mindMapTarget(ctx) !== null,
    run: (ctx) => { void pasteMindMapChildren(ctx); },
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

  {
    id: 'edit.link',
    title: 'Add link',
    group: 'edit',
    // Whimsical's K. The toolbar owns the popover; the store carries the ask.
    shortcut: { key: 'k' },
    contextMenu: 'node',
    when: (ctx) => selectedNodes(ctx.store.getState()).length === 1,
    run: (ctx) => ctx.store.getState().requestLinkEditor(),
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
  // The three "paste as" commands — text on the system clipboard, turned into
  // objects. None carries a keystroke: what they read is only known once the
  // user has asked (reading the clipboard is a permissioned, asynchronous call),
  // so all three are gated on nothing but being able to edit and say what went
  // wrong afterwards rather than being quietly withdrawn beforehand. Plain ⌘V
  // pastes Mermaid and tables too — see the paste listener in `Canvas.tsx`.
  {
    id: 'clipboard.pasteAsStickies',
    title: 'Paste as sticky notes',
    group: 'clipboard',
    contextMenu: 'pane',
    run: (ctx) => { void pasteAsStickies(ctx); },
  },
  {
    id: 'clipboard.pasteMermaid',
    // Not "as flowchart" any more: the one item reads a `sequenceDiagram` too,
    // and the title is the only tooltip a menu entry has.
    title: 'Paste Mermaid (flowchart or sequence)',
    group: 'clipboard',
    contextMenu: 'pane',
    run: (ctx) => { void pasteMermaid(ctx); },
  },
  {
    id: 'clipboard.pasteAsTable',
    title: 'Paste as table',
    group: 'clipboard',
    contextMenu: 'pane',
    run: (ctx) => { void pasteAsTable(ctx); },
  },
  {
    id: 'clipboard.copyAsImage',
    title: 'Copy as image',
    group: 'clipboard',
    shortcut: { key: 'c', meta: true, shift: true },
    // Whimsical's "Copy as PNG": the selection if there is one, else the
    // board, on a transparent background so it drops into a doc or a chat.
    run: () => {
      void renderDiagramPng({ selectionOnly: true, background: null }).then(async (dataUrl) => {
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
    // On both menus, because a connector has a default of its own and the
    // shape menu is not where anybody would look for it.
    contextMenu: ['node', 'edge'],
    // "Make *this* the default" has no answer for five shapes in three
    // colours, and none for a group, a frame or an image — `kindOf` is what
    // says so, and the store checks it again rather than trusting the gate.
    when: (ctx) => {
      const state = ctx.store.getState();
      const nodes = selectedNodes(state);
      const edges = selectedEdges(state);
      if (nodes.length + edges.length !== 1) return false;
      return edges.length === 1 || kindOf(nodes[0]) !== null;
    },
    run: (ctx) => {
      const kind = ctx.store.getState().saveSelectionAsDefault();
      if (!kind) return;
      toastInfo(`Saved as default for ${DEFAULT_STYLE_KIND_LABELS[kind]} on this board`);
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
    id: 'arrange.group',
    title: 'Group',
    group: 'arrange',
    shortcut: { key: 'g', meta: true },
    contextMenu: 'node',
    when: (ctx) => canGroupSelection(ctx.store.getState().nodes),
    run: (ctx) => ctx.store.getState().groupSelected(),
  },
  {
    id: 'arrange.wrapInFrame',
    title: 'Wrap in frame',
    group: 'arrange',
    contextMenu: 'node',
    when: hasSelectedNode,
    run: (ctx) => ctx.store.getState().wrapSelectionInFrame(),
  },
  {
    id: 'arrange.ungroup',
    title: 'Ungroup',
    group: 'arrange',
    shortcut: { key: 'g', meta: true, shift: true },
    contextMenu: 'node',
    when: (ctx) => ctx.store.getState().nodes.some((n) => n.selected && isGroupNode(n)),
    run: (ctx) => ctx.store.getState().ungroupSelected(),
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
    id: 'view.find',
    title: 'Find on canvas',
    group: 'view',
    // No `when`: finding something is looking, not editing, so this is offered
    // on a read-only board and on the public share page as well. The bar takes
    // its own Escape and Enter — it is a field, which the canvas's keyboard
    // handler steps aside for — so nothing here needs a gate.
    shortcut: { key: 'f', meta: true },
    run: () => useSearchStore.getState().openSearch(),
  },
  // ---- presenting --------------------------------------------------------
  // One slide per frame (`src/lib/presentation.ts`). Both commands are on
  // `READ_ONLY_COMMAND_IDS`: presenting is looking, so a viewer's board and the
  // public `/s/:token` page can both be presented. Neither writes anything —
  // the running order is the one thing here that does, and that is the store's
  // `setSlideOrder`, reached from the Present button rather than from a
  // keystroke.
  {
    id: 'view.present',
    title: 'Present',
    group: 'view',
    // ⌘⇧P is free (P alone is the parallelogram tool, and no other binding
    // uses it with modifiers).
    shortcut: { key: 'p', meta: true, shift: true },
    // A board with no sections has no deck, and an empty presentation is not
    // worth offering. `some` rather than `slidesOf`, because this runs on every
    // render of the ⌘K menu and the answer is the same.
    when: (ctx) => ctx.store.getState().nodes.some((n) => isFrameNode(n)),
    run: () => usePresentStore.getState().start(),
  },
  {
    id: 'view.presentFromFrame',
    title: 'Present from this frame',
    group: 'view',
    // No keystroke: it is about the frame under the pointer, which is what the
    // right-click menu says and a keystroke cannot.
    contextMenu: 'node',
    when: (ctx) => {
      const selected = selectedNodes(ctx.store.getState());
      return selected.length === 1 && isFrameNode(selected[0]);
    },
    run: (ctx) => {
      const [node] = selectedNodes(ctx.store.getState());
      if (!node) return;
      const index = slidesOf(ctx.store.getState().nodes).findIndex((slide) => slide.id === node.id);
      if (index >= 0) usePresentStore.getState().start(index);
    },
  },

  {
    id: 'view.commandMenu',
    title: 'Command menu',
    group: 'view',
    shortcut: { key: 'k', meta: true },
    run: (ctx) => ctx.ui.openCommandMenu(),
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
  ...layoutCommands(),

  // ---- view: canvas chrome -----------------------------------------------
  // All three live in `useViewPreferences` rather than the diagram store: they
  // are per-browser preferences, not part of any diagram. None takes a
  // keystroke — the letters left are worth more to a tool — so they reach the
  // user through the bottom bar, and through here for the sake of one list.
  // ---- view: the board's thumbnail ---------------------------------------
  // Whimsical's "Set as board thumbnail": the dashboard card shows these shapes
  // instead of a picture of the whole board. Both are edits — the ids are saved
  // with the diagram and shared with everybody on it — so neither is on
  // `READ_ONLY_COMMAND_IDS`. Neither takes a keystroke: this is a rare decision
  // about how a board is filed, and the letters left are worth more elsewhere.
  {
    id: 'view.setThumbnail',
    title: 'Set as board thumbnail',
    group: 'view',
    contextMenu: 'node',
    // Something to make a picture of, and something to change: offering it for
    // a selection that is already exactly the thumbnail would be an action with
    // no effect.
    when: (ctx) => {
      const state = ctx.store.getState();
      const selected = selectedNodes(state).map((n) => n.id);
      if (selected.length === 0) return false;
      return !isSameThumbnail(state.thumbnailNodeIds, selected);
    },
    run: (ctx) => {
      const state = ctx.store.getState();
      state.setThumbnailNodeIds(selectedNodes(state).map((n) => n.id));
      toastInfo('Board thumbnail set');
    },
  },
  {
    id: 'view.clearThumbnail',
    title: 'Remove from board thumbnail',
    group: 'view',
    // On the pane menu as well: undoing this is not something the user should
    // have to find the right shape to do, least of all when the shape it was
    // set on has since been deleted.
    contextMenu: ['node', 'pane'],
    when: (ctx) => ctx.store.getState().thumbnailNodeIds !== null,
    run: (ctx) => {
      ctx.store.getState().setThumbnailNodeIds(null);
      toastInfo('Board thumbnail cleared');
    },
  },
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
  {
    id: 'view.toggleTheme',
    title: 'Theme',
    group: 'view',
    run: () => useViewPreferences.getState().cycleTheme(),
  },
];

/**
 * The commands that change nothing about the diagram, and so stay live when it
 * is open read-only (a viewer's copy, or the public `/s/:token` page).
 *
 * A deny-list would let a *new* command be editable in read-only mode by
 * default, which is the wrong way for the mistake to fall: this is the
 * allow-list, so anything added below without being named here is gated off.
 * Looking, framing, copying and the cheat sheet are all still on the table —
 * read-only is about not writing, not about not reading.
 */
const READ_ONLY_COMMAND_IDS = new Set<string>([
  'tool.select',
  // The menu only offers what its own `when`s allow, so a viewer's is the read-only set.
  'view.commandMenu',
  // Reading *and* writing a comment are a viewer's right — see
  // `server/comments.ts` — so this survives the read-only gate.
  'comment.add',
  'tool.pan',
  'select.all',
  'edit.escape',
  'clipboard.copy',
  'clipboard.copyAsImage',
  'style.copy',
  'view.zoomIn',
  'view.zoomOut',
  'view.zoomReset',
  'view.fitView',
  'view.fitSelection',
  'view.find',
  // Presenting is looking: a viewer's board and the public share page both
  // have a deck, and neither command writes anything.
  'view.present',
  'view.presentFromFrame',
  'view.pan',
  'view.shortcuts',
  'view.toggleMinimap',
  'view.toggleGridSnap',
  'view.toggleTheme',
]);

/**
 * The one predicate every mutating command is gated on. Exported so a caller
 * that offers an action outside the registry (a toolbar button, say) asks the
 * same question rather than re-deriving the answer.
 */
export function canEditDiagram(ctx: CommandContext): boolean {
  return !ctx.store.getState().readOnly;
}

/** `command`, with `canEditDiagram` folded into its own `when` where it mutates. */
function gateOnEditability(command: Command): Command {
  if (READ_ONLY_COMMAND_IDS.has(command.id)) return command;
  const { when } = command;
  return {
    ...command,
    when: (ctx) => canEditDiagram(ctx) && (!when || when(ctx)),
  };
}

/**
 * The single source of truth for what FlowSketch can do, as the keyboard
 * handler, the cheat sheet and the right-click menus read it: every declared
 * command, with the read-only gate already applied.
 */
export const commands: Command[] = commandDeclarations.map(gateOnEditability);

export const registry = createRegistry(commands);

/** Cheat-sheet section order and headings. */
export const GROUP_LABELS: { group: Command['group']; label: string }[] = [
  { group: 'tools', label: 'Tools' },
  // Nothing in this group carries a keystroke yet, so the sheet drops the
  // section; it is named here so that the first one to get one turns up.
  { group: 'comments', label: 'Comments' },
  { group: 'mindmap', label: 'Mind map' },
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

/**
 * Auto-layout, Whimsical's two "Lay out …" entries.
 *
 * **No keystroke**, deliberately: Whimsical has none either, and the command
 * menu and the right-click menu both list a command whether or not it carries
 * one. `canAutoLayout` is the gate — two outermost selected shapes with a
 * connector between them — so the entry is offered exactly when running it
 * would rearrange something.
 *
 * `layoutSelected` is asynchronous (the layout engine is code-split), and a
 * command's `run` returns nothing; the promise is deliberately dropped, since
 * the only thing that happens at the end of it is a `set` on the store.
 */
function layoutCommands(): Command[] {
  const directions: ['vertical' | 'horizontal', string][] = [
    ['vertical', 'Lay out vertically'],
    ['horizontal', 'Lay out horizontally'],
  ];

  return directions.map(([direction, title]) => ({
    id: `arrange.layout${direction[0].toUpperCase()}${direction.slice(1)}`,
    title,
    group: 'arrange',
    contextMenu: 'node',
    when: (ctx) => {
      const state = ctx.store.getState();
      return canAutoLayout(state.nodes, state.edges);
    },
    run: (ctx) => {
      void ctx.store.getState().layoutSelected(direction);
    },
  }));
}

/**
 * The shape kinds a tool can place, so Canvas can keep its own list honest.
 * Not all of them have a keystroke — the ones behind the rail's "More shapes"
 * menu are chosen there and placed the same way.
 */
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
  'parallelogram',
  'document',
  'cloud',
  'star',
  'callout',
  'arrow',
];
