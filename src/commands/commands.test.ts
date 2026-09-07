import { afterEach, describe, expect, it, vi } from 'vitest';
import { canEditDiagram, commandDeclarations, commands, registry } from './commands';
import { parseMermaidFlowchart, parseMermaidSequence } from '../lib/mermaid';
import { useToastStore } from '../store/useToastStore';
import type { CommandContext } from './types';

/**
 * A context holding one selected shape, so that the commands gated on a
 * selection of their own are offered and the read-only gate is the only thing
 * left that can withdraw them.
 */
function ctxWith(readOnly: boolean): CommandContext {
  return {
    store: {
      getState: () => ({
        readOnly,
        nodes: [{ id: 'n1', selected: true, data: {} }],
        edges: [],
        tool: 'select',
      }),
      setState: () => {},
    },
    clipboard: { get: () => null, set: () => {} },
    styleClipboard: { get: () => null, set: () => {} },
  } as unknown as CommandContext;
}

/** A command is offered when it has no gate, or its gate says yes. */
function offered(id: string, ctx: CommandContext): boolean {
  const command = registry.find(id);
  if (!command) throw new Error(`no such command: ${id}`);
  return !command.when || command.when(ctx);
}

describe('canEditDiagram', () => {
  it('follows the store\'s read-only flag', () => {
    expect(canEditDiagram(ctxWith(false))).toBe(true);
    expect(canEditDiagram(ctxWith(true))).toBe(false);
  });
});

describe('the read-only gate', () => {
  const editable = ctxWith(false);
  const readOnly = ctxWith(true);

  it('withdraws the commands that would change the diagram', () => {
    for (const id of [
      'tool.rectangle',
      'edit.delete',
      'edit.duplicate',
      'edit.editText',
      'clipboard.cut',
      'clipboard.paste',
      'style.paste',
      'arrange.bringToFront',
      'arrange.nudgeUp',
      'history.undo',
      'history.redo',
    ]) {
      expect(offered(id, readOnly), `${id} is still offered`).toBe(false);
    }
  });

  it('leaves looking, framing and copying alone', () => {
    for (const id of [
      'tool.select',
      'tool.pan',
      'select.all',
      'clipboard.copy',
      'clipboard.copyAsImage',
      'style.copy',
      'view.zoomIn',
      'view.fitView',
      'view.shortcuts',
      'view.toggleMinimap',
      // Reading *and* writing a comment are a viewer's right — a reviewer who
      // cannot write anything down is not reviewing.
      'comment.add',
    ]) {
      expect(offered(id, readOnly), `${id} was withdrawn`).toBe(true);
    }
  });

  it('keeps each command\'s own gate once editing is allowed', () => {
    // `clipboard.paste` falls through to the browser while our clipboard is
    // empty — a gate the read-only wrapper has to preserve, not replace.
    expect(offered('clipboard.paste', editable)).toBe(false);
    expect(offered('edit.delete', editable)).toBe(true);
  });

  it('gates every declared command that is not on the read-only list', () => {
    // The list is an allow-list, so a command added without being named there
    // is gated by default. This is what proves the mapping covers all of them.
    for (const declaration of commandDeclarations) {
      const gated = commands.find((c) => c.id === declaration.id)!;
      const stillOffered = !gated.when || gated.when(readOnly);
      // Either it survives read-only mode *and* was left exactly as declared,
      // or it does not survive.
      if (stillOffered) expect(gated.when, declaration.id).toBe(declaration.when);
    }
  });
});

describe('the save-as-default command', () => {
  const command = registry.find('style.saveDefault')!;

  /** A context with exactly these nodes and edges selected. */
  function ctxOf(nodes: unknown[], edges: unknown[] = []): CommandContext {
    return {
      store: { getState: () => ({ readOnly: false, nodes, edges, tool: 'select' }), setState: () => {} },
    } as unknown as CommandContext;
  }

  it('is offered on the shape menu and on the connector menu', () => {
    // A connector has a default of its own, and the shape menu is not where
    // anyone would look for it.
    expect(command.contextMenu).toEqual(['node', 'edge']);
  });

  it('carries ⌘⇧D and is withdrawn in read-only mode', () => {
    expect(command.shortcut).toEqual({ key: 'd', meta: true, shift: true });
    expect(offered('style.saveDefault', ctxWith(true))).toBe(false);
  });

  it('is offered for one shape or one connector, and for nothing else', () => {
    const shape = { id: 'n1', selected: true, type: 'shape', data: { shape: 'rectangle' } };
    const other = { id: 'n2', selected: true, type: 'shape', data: { shape: 'ellipse' } };
    const edge = { id: 'e1', selected: true, data: { stroke: '#123456' } };

    expect(command.when!(ctxOf([shape]))).toBe(true);
    expect(command.when!(ctxOf([], [edge]))).toBe(true);
    // Nothing selected, two things selected, or one of each: "make *this* the
    // default" has no answer for any of them.
    expect(command.when!(ctxOf([]))).toBe(false);
    expect(command.when!(ctxOf([shape, other]))).toBe(false);
    expect(command.when!(ctxOf([shape], [edge]))).toBe(false);
    // A group, a frame and an image have no style to copy.
    expect(command.when!(ctxOf([{ ...shape, type: 'group' }]))).toBe(false);
    expect(command.when!(ctxOf([{ ...shape, type: 'frame' }]))).toBe(false);
    expect(command.when!(ctxOf([{ ...shape, data: { shape: 'image' } }]))).toBe(false);
  });
});

describe('the board-thumbnail commands', () => {
  const set = registry.find('view.setThumbnail')!;
  const clear = registry.find('view.clearThumbnail')!;

  /** A context with these nodes selected and this thumbnail on the board. */
  function ctxOf(selected: string[], thumbnailNodeIds: string[] | null): CommandContext {
    const calls: (string[] | null)[] = [];
    const ctx = {
      store: {
        getState: () => ({
          readOnly: false,
          thumbnailNodeIds,
          nodes: ['a', 'b'].map((id) => ({ id, selected: selected.includes(id), data: {} })),
          edges: [],
          tool: 'select',
          setThumbnailNodeIds: (ids: string[] | null) => calls.push(ids),
        }),
        setState: () => {},
      },
    } as unknown as CommandContext;
    return Object.assign(ctx, { calls }) as CommandContext & { calls: (string[] | null)[] };
  }

  afterEach(() => useToastStore.getState().clear());

  const messages = () => useToastStore.getState().toasts.map((t) => t.message);

  it('sit on the right menus and carry no keystroke', () => {
    expect(set.contextMenu).toBe('node');
    // Clearing is on the pane menu too: the shape it was set on may be gone.
    expect(clear.contextMenu).toEqual(['node', 'pane']);
    expect(set.shortcut).toBeUndefined();
    expect(clear.shortcut).toBeUndefined();
  });

  it('are edits, so both are withdrawn in read-only mode', () => {
    expect(offered('view.setThumbnail', ctxWith(true))).toBe(false);
    expect(offered('view.clearThumbnail', ctxWith(true))).toBe(false);
  });

  it('offers "set" for a selection that is not already the thumbnail', () => {
    expect(set.when!(ctxOf(['a'], null))).toBe(true);
    expect(set.when!(ctxOf(['a', 'b'], ['a']))).toBe(true);
    // Nothing selected: there is no picture to make.
    expect(set.when!(ctxOf([], null))).toBe(false);
    // Already exactly this, in either order — the item would do nothing.
    expect(set.when!(ctxOf(['a'], ['a']))).toBe(false);
    expect(set.when!(ctxOf(['a', 'b'], ['b', 'a']))).toBe(false);
  });

  it('offers "remove" only while a custom thumbnail is set', () => {
    expect(clear.when!(ctxOf([], ['a']))).toBe(true);
    expect(clear.when!(ctxOf(['a'], null))).toBe(false);
  });

  it('write the selection, and clear it again, each with a word about it', () => {
    const setting = ctxOf(['a', 'b'], null) as CommandContext & { calls: (string[] | null)[] };
    set.run(setting);
    expect(setting.calls).toEqual([['a', 'b']]);
    expect(messages()).toEqual(['Board thumbnail set']);

    useToastStore.getState().clear();
    const clearing = ctxOf([], ['a']) as CommandContext & { calls: (string[] | null)[] };
    clear.run(clearing);
    expect(clearing.calls).toEqual([null]);
    expect(messages()).toEqual(['Board thumbnail cleared']);
  });
});

describe('the "paste as" commands', () => {
  const stickies = registry.find('clipboard.pasteAsStickies')!;
  const mermaid = registry.find('clipboard.pasteMermaid')!;

  /** A context whose store records what the two paste actions were handed. */
  function ctxWithClipboard(text: string | Error) {
    const calls: { action: string; text: string; origin: { x: number; y: number } }[] = [];
    const ctx = {
      store: {
        getState: () => ({
          readOnly: false,
          nodes: [],
          edges: [],
          pasteAsStickies: (t: string, origin: { x: number; y: number }) => {
            calls.push({ action: 'stickies', text: t, origin });
            return ['n1'];
          },
          pasteMermaid: async (t: string, origin: { x: number; y: number }) => {
            calls.push({ action: 'mermaid', text: t, origin });
            return parseMermaidFlowchart(t) ? ['n1'] : null;
          },
          pasteSequence: (t: string, origin: { x: number; y: number }) => {
            calls.push({ action: 'sequence', text: t, origin });
            return parseMermaidSequence(t) ? ['n1'] : null;
          },
        }),
        setState: () => {},
      },
      dropPoint: () => ({ x: 12, y: 34 }),
    } as unknown as CommandContext;

    vi.stubGlobal('navigator', {
      clipboard: {
        readText: async () => {
          if (text instanceof Error) throw text;
          return text;
        },
      },
    });
    return { ctx, calls };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    useToastStore.getState().clear();
  });

  const messages = () => useToastStore.getState().toasts.map((t) => t.message);

  it('are on the canvas menu, carry no keystroke and are withdrawn in read-only mode', () => {
    for (const command of [stickies, mermaid]) {
      expect(command.contextMenu).toBe('pane');
      expect(command.shortcut).toBeUndefined();
      expect(command.group).toBe('clipboard');
      expect(offered(command.id, ctxWith(true)), command.id).toBe(false);
    }
    // The text is only known once the clipboard has been read, so nothing else
    // gates them: an editor is always offered both.
    expect(offered(stickies.id, ctxWith(false))).toBe(true);
    expect(offered(mermaid.id, ctxWith(false))).toBe(true);
  });

  it('hand the clipboard\'s text, and the drop point, to the store', async () => {
    const { ctx, calls } = ctxWithClipboard('- one\n- two');
    stickies.run(ctx);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ action: 'stickies', text: '- one\n- two', origin: { x: 12, y: 34 } });
    expect(messages()).toEqual([]);
  });

  it('build a flowchart from Mermaid text and say so when it is not one', async () => {
    const good = ctxWithClipboard('flowchart TD\n A --> B');
    mermaid.run(good.ctx);
    // The sequence parser is offered the text first and refuses it, so the
    // flowchart branch is the second of the two calls.
    await vi.waitFor(() => expect(good.calls).toHaveLength(2));
    expect(good.calls.map((c) => c.action)).toEqual(['sequence', 'mermaid']);
    expect(messages()).toEqual([]);

    const bad = ctxWithClipboard('shopping list');
    mermaid.run(bad.ctx);
    await vi.waitFor(() =>
      expect(messages()).toEqual(["That isn't a Mermaid flowchart or sequence diagram"]),
    );
  });

  it('build a sequence diagram from the same menu item, without asking the flowchart parser', async () => {
    const { ctx, calls } = ctxWithClipboard('sequenceDiagram\n  A->>B: hi');
    mermaid.run(ctx);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      action: 'sequence',
      text: 'sequenceDiagram\n  A->>B: hi',
      origin: { x: 12, y: 34 },
    });
    expect(messages()).toEqual([]);
  });

  it('say so when the browser refuses the clipboard, and paste nothing', async () => {
    const { ctx, calls } = ctxWithClipboard(new DOMException('denied'));
    stickies.run(ctx);
    await vi.waitFor(() => expect(messages()).toEqual(['Clipboard access was refused']));
    expect(calls).toEqual([]);
  });

  it('say so when the clipboard holds no line worth a note', async () => {
    const ctx = {
      store: { getState: () => ({ pasteAsStickies: () => [] }), setState: () => {} },
      dropPoint: () => ({ x: 0, y: 0 }),
    } as unknown as CommandContext;
    vi.stubGlobal('navigator', { clipboard: { readText: async () => '   \n\n' } });

    stickies.run(ctx);
    await vi.waitFor(() => expect(messages()).toEqual(['There are no lines of text on the clipboard']));
  });
});

describe('the mind-map commands', () => {
  /** A mind-map node, an ordinary shape, and one branch between two of them. */
  function ctxOf(
    options: { selected?: string; editing?: string } = {},
  ): CommandContext {
    const node = (id: string, mindMap: boolean) => ({
      id,
      type: 'shape',
      selected: id === options.selected,
      data: { shape: 'rectangle', ...(mindMap ? { mindMap: { root: 'root' } } : {}) },
    });
    return {
      store: {
        getState: () => ({
          readOnly: false,
          editingNodeId: options.editing ?? null,
          editingEdgeId: null,
          nodes: [node('root', true), node('kid', true), node('plain', false)],
          edges: [{ id: 'e1', source: 'root', target: 'kid', data: { role: 'mindmap' } }],
        }),
        setState: () => {},
      },
    } as unknown as CommandContext;
  }

  const ids = [
    'mindmap.addChild',
    'mindmap.addSibling',
    'mindmap.addSiblingAbove',
    'mindmap.addParent',
    'mindmap.pasteChildren',
  ];

  it('carry the keystrokes Whimsical does', () => {
    expect(registry.find('mindmap.addRoot')!.shortcut).toEqual({ key: 'm' });
    expect(registry.find('mindmap.addChild')!.shortcut).toEqual({ key: 'Tab' });
    expect(registry.find('mindmap.addSibling')!.shortcut).toEqual({ key: 'Enter' });
    expect(registry.find('mindmap.addSiblingAbove')!.shortcut).toEqual({ key: 'Enter', meta: true });
    expect(registry.find('mindmap.addParent')!.shortcut).toEqual({ key: 'Enter', alt: true });
    expect(registry.find('mindmap.toggleCollapse')!.shortcut).toEqual({ key: '/', meta: true });
    // Reading the system clipboard is asynchronous and permissioned, so this
    // one is a menu item like the other "paste as" commands.
    expect(registry.find('mindmap.pasteChildren')!.shortcut).toBeUndefined();
  });

  it('are offered for one selected mind-map node and for nothing else', () => {
    for (const id of ids) {
      expect(offered(id, ctxOf({ selected: 'kid' })), id).toBe(true);
      expect(offered(id, ctxOf({ selected: 'plain' })), id).toBe(false);
      expect(offered(id, ctxOf()), id).toBe(false);
    }
  });

  it('act on the node being typed into, which is where the gesture lives', () => {
    // Tab is pressed while the label of the node just made is still open.
    expect(offered('mindmap.addChild', ctxOf({ editing: 'kid' }))).toBe(true);
    expect(offered('mindmap.addChild', ctxOf({ editing: 'plain' }))).toBe(false);
  });

  it('offer collapse only where there is a branch to fold', () => {
    expect(offered('mindmap.toggleCollapse', ctxOf({ selected: 'root' }))).toBe(true);
    expect(offered('mindmap.toggleCollapse', ctxOf({ selected: 'kid' }))).toBe(false);
  });

  it('withdraw the root command while a label is open, so M can be typed', () => {
    expect(offered('mindmap.addRoot', ctxOf())).toBe(true);
    expect(offered('mindmap.addRoot', ctxOf({ editing: 'kid' }))).toBe(false);
  });

  it('are all withdrawn in read-only mode', () => {
    for (const id of [...ids, 'mindmap.addRoot', 'mindmap.toggleCollapse']) {
      expect(offered(id, ctxWith(true)), id).toBe(false);
    }
  });

  describe('sharing Enter and Tab with the editing commands', () => {
    const enter = { key: 'Enter' };

    it('takes Enter for a mind-map node, and leaves it to `edit.editText` otherwise', () => {
      expect(registry.matchEvent(enter, ctxOf({ selected: 'kid' }))!.id).toBe('mindmap.addSibling');
      expect(registry.matchEvent(enter, ctxOf({ selected: 'plain' }))!.id).toBe('edit.editText');
    });

    it('leaves Tab alone unless a mind-map node is the target', () => {
      const tab = { key: 'Tab' };
      expect(registry.matchEvent(tab, ctxOf({ selected: 'kid' }))!.id).toBe('mindmap.addChild');
      expect(registry.matchEvent(tab, ctxOf({ selected: 'plain' }))).toBeUndefined();
    });
  });
});

describe('the comment command', () => {
  const command = registry.find('comment.add')!;

  it('is offered on the shape and canvas menus, but not on a connector', () => {
    expect(command.contextMenu).toEqual(['node', 'pane']);
  });

  it('does nothing on a canvas that cannot attribute a comment', () => {
    // The public share page supplies no `startComment`: there is no session
    // there to put a name against a remark.
    expect(() => command.run({ ui: {} } as unknown as CommandContext)).not.toThrow();
  });
});
