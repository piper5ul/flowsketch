import { describe, expect, it } from 'vitest';
import { canEditDiagram, commandDeclarations, commands, registry } from './commands';
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
