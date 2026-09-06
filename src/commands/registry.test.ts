import { describe, expect, it } from 'vitest';
import { createRegistry, formatShortcut } from './registry';
import { bindingsOf, commands, registry } from './commands';
import type { Command, CommandContext, Keybinding } from './types';

/** A key event as the registry sees it — the fields it reads, nothing else. */
function key(
  k: string,
  mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean; code?: string } = {},
) {
  return {
    key: k,
    code: mods.code,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
  };
}

interface TestCtx {
  ran: string[];
  selection: number;
}

function makeCtx(selection = 0): TestCtx {
  return { ran: [], selection };
}

function cmd(id: string, shortcut: Keybinding | Keybinding[], extra: Partial<Command<TestCtx>> = {}): Command<TestCtx> {
  return {
    id,
    title: id,
    group: 'edit',
    shortcut,
    run: (ctx) => ctx.ran.push(id),
    ...extra,
  };
}

describe('createRegistry — matching', () => {
  it('matches a bare key with no modifiers held', () => {
    const reg = createRegistry([cmd('rect', { key: 'r' })]);
    expect(reg.matchEvent(key('r'), makeCtx())?.id).toBe('rect');
    expect(reg.matchEvent(key('R'), makeCtx())?.id).toBe('rect');
  });

  it('does not match a bare binding when a modifier is held', () => {
    const reg = createRegistry([cmd('rect', { key: 'r' })]);
    expect(reg.matchEvent(key('r', { meta: true }), makeCtx())).toBeUndefined();
    expect(reg.matchEvent(key('r', { shift: true }), makeCtx())).toBeUndefined();
    expect(reg.matchEvent(key('r', { alt: true }), makeCtx())).toBeUndefined();
  });

  it('does not match a modified binding when the modifier is missing', () => {
    const reg = createRegistry([cmd('undo', { key: 'z', meta: true })]);
    expect(reg.matchEvent(key('z'), makeCtx())).toBeUndefined();
  });

  it('treats meta and ctrl as the same modifier', () => {
    const reg = createRegistry([cmd('undo', { key: 'z', meta: true })]);
    expect(reg.matchEvent(key('z', { meta: true }), makeCtx())?.id).toBe('undo');
    expect(reg.matchEvent(key('z', { ctrl: true }), makeCtx())?.id).toBe('undo');
  });

  it('distinguishes shift and alt variants of the same key', () => {
    const reg = createRegistry([
      cmd('undo', { key: 'z', meta: true }),
      cmd('redo', { key: 'z', meta: true, shift: true }),
    ]);
    expect(reg.matchEvent(key('z', { meta: true }), makeCtx())?.id).toBe('undo');
    expect(reg.matchEvent(key('z', { meta: true, shift: true }), makeCtx())?.id).toBe('redo');
    expect(reg.matchEvent(key('z', { meta: true, alt: true }), makeCtx())).toBeUndefined();
  });

  it('matches any binding in a list', () => {
    const reg = createRegistry([cmd('del', [{ key: 'Backspace' }, { key: 'Delete' }])]);
    expect(reg.matchEvent(key('Backspace'), makeCtx())?.id).toBe('del');
    expect(reg.matchEvent(key('Delete'), makeCtx())?.id).toBe('del');
  });

  it('falls back to event.code when the layout mangles event.key', () => {
    // macOS turns ⌥C into "ç"; the physical key is still KeyC.
    const reg = createRegistry([cmd('copyStyle', { key: 'c', meta: true, alt: true })]);
    const event = key('ç', { meta: true, alt: true, code: 'KeyC' });
    expect(reg.matchEvent(event, makeCtx())?.id).toBe('copyStyle');
  });

  it('matches punctuation bindings through their code', () => {
    const reg = createRegistry([cmd('bigger', { key: '=', meta: true, alt: true })]);
    expect(reg.matchEvent(key('≠', { meta: true, alt: true, code: 'Equal' }), makeCtx())?.id).toBe('bigger');
  });

  it('ignores commands whose `when` returns false', () => {
    const reg = createRegistry([
      cmd('nudge', { key: 'ArrowUp' }, { when: (ctx) => ctx.selection > 0 }),
    ]);
    expect(reg.matchEvent(key('ArrowUp'), makeCtx(0))).toBeUndefined();
    expect(reg.matchEvent(key('ArrowUp'), makeCtx(1))?.id).toBe('nudge');
  });

  it('picks the first command whose `when` passes when two share a binding', () => {
    const reg = createRegistry([
      cmd('editNode', { key: 'Enter' }, { when: (ctx) => ctx.selection === 1 }),
      cmd('editEdge', { key: 'Enter' }, { when: (ctx) => ctx.selection === 0 }),
    ]);
    expect(reg.matchEvent(key('Enter'), makeCtx(1))?.id).toBe('editNode');
    expect(reg.matchEvent(key('Enter'), makeCtx(0))?.id).toBe('editEdge');
    expect(reg.matchEvent(key('Enter'), makeCtx(5))).toBeUndefined();
  });

  it('returns undefined for an unbound key', () => {
    const reg = createRegistry([cmd('rect', { key: 'r' })]);
    expect(reg.matchEvent(key('q'), makeCtx())).toBeUndefined();
  });

  it('never matches a command that has no shortcut', () => {
    const reg = createRegistry([{ id: 'x', title: 'X', group: 'edit', run: () => {} } as Command<TestCtx>]);
    expect(reg.matchEvent(key('x'), makeCtx())).toBeUndefined();
  });

  it('runs the matched command against the context', () => {
    const reg = createRegistry([cmd('rect', { key: 'r' })]);
    const ctx = makeCtx();
    reg.matchEvent(key('r'), ctx)!.run(ctx);
    expect(ctx.ran).toEqual(['rect']);
  });
});

describe('createRegistry — lookup', () => {
  it('exposes every command through all() in registration order', () => {
    const reg = createRegistry([cmd('a', { key: 'a' }), cmd('b', { key: 'b' })]);
    expect(reg.all().map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('finds a command by id', () => {
    const reg = createRegistry([cmd('a', { key: 'a' })]);
    expect(reg.find('a')?.id).toBe('a');
    expect(reg.find('nope')).toBeUndefined();
  });
});

describe('formatShortcut', () => {
  it('renders mac modifiers as symbols', () => {
    expect(formatShortcut({ key: 'z', meta: true, shift: true }, 'mac')).toBe('⌘⇧Z');
    expect(formatShortcut({ key: 'c', meta: true, alt: true }, 'mac')).toBe('⌘⌥C');
    expect(formatShortcut({ key: 'z', meta: true }, 'mac')).toBe('⌘Z');
  });

  it('renders non-mac modifiers as words', () => {
    expect(formatShortcut({ key: 'z', meta: true, shift: true }, 'other')).toBe('Ctrl+Shift+Z');
    expect(formatShortcut({ key: 'c', meta: true, alt: true }, 'other')).toBe('Ctrl+Alt+C');
    expect(formatShortcut({ key: 'r' }, 'other')).toBe('R');
  });

  it('names the keys that have no printable glyph', () => {
    expect(formatShortcut({ key: ' ' }, 'mac')).toBe('Space');
    expect(formatShortcut({ key: 'ArrowUp' }, 'mac')).toBe('↑');
    expect(formatShortcut({ key: 'Escape' }, 'other')).toBe('Esc');
    expect(formatShortcut({ key: 'Backspace' }, 'mac')).toBe('⌫');
    expect(formatShortcut({ key: 'Backspace' }, 'other')).toBe('Backspace');
    expect(formatShortcut({ key: 'Enter' }, 'mac')).toBe('↩');
  });

  it('formats the first binding of a list', () => {
    expect(formatShortcut([{ key: '1' }, { key: '0', meta: true }], 'mac')).toBe('1');
  });

  it('returns an empty string when there is no binding', () => {
    expect(formatShortcut(undefined, 'mac')).toBe('');
    expect(formatShortcut([], 'mac')).toBe('');
  });
});

describe('the FlowSketch command set', () => {
  it('gives every command a unique id and a title', () => {
    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of commands) {
      expect(command.title.length).toBeGreaterThan(0);
      expect(command.id.length).toBeGreaterThan(0);
    }
  });

  it('binds no two unconditional commands to the same keystroke', () => {
    const seen = new Map<string, string>();
    for (const command of commands) {
      // A `when` guard is what lets two commands share a keystroke (Enter
      // edits a shape or a connector label depending on the selection).
      if (command.when) continue;
      for (const binding of bindingsOf(command)) {
        const signature = [
          binding.key.toLowerCase(),
          binding.meta ? 'meta' : '',
          binding.shift ? 'shift' : '',
          binding.alt ? 'alt' : '',
        ].join('|');
        const owner = seen.get(signature);
        expect(owner, `${command.id} duplicates the binding of ${owner}`).toBeUndefined();
        seen.set(signature, command.id);
      }
    }
  });

  it('registers a command for every tool the left rail offers', () => {
    for (const tool of ['select', 'pan', 'rectangle', 'ellipse', 'diamond', 'pill', 'triangle', 'hexagon', 'cylinder', 'sticky', 'text', 'connector']) {
      expect(registry.find(`tool.${tool}`), `tool.${tool} is missing`).toBeDefined();
    }
  });

  it('puts the hexagon tool on X', () => {
    expect(bindingsOf(registry.find('tool.hexagon')!)).toEqual([{ key: 'x' }]);
  });

  it('tags the context-menu commands with a target', () => {
    for (const id of ['edit.delete', 'edit.duplicate', 'clipboard.paste', 'select.all', 'view.fitView']) {
      expect(registry.find(id)?.contextMenu, `${id} is not tagged`).toBeDefined();
    }
  });
});

describe('the align and distribute shortcuts', () => {
  /**
   * A context holding `n` selected nodes. The align/distribute gates only read
   * the selection, so the rest of the real context is never reached.
   */
  function withSelection(n: number): CommandContext {
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, selected: true }));
    return { store: { getState: () => ({ nodes, edges: [] }) } } as unknown as CommandContext;
  }

  /**
   * The keystroke each command answers to. ⌥ rewrites `event.key` on macOS
   * (⌥⇧H arrives as "Ó"), so the letters are pressed the way the browser
   * actually reports them — mangled key, real `code`.
   */
  const ALIGN: [string, ReturnType<typeof key>][] = [
    ['arrange.alignLeft', key('ArrowLeft', { alt: true, shift: true })],
    ['arrange.alignRight', key('ArrowRight', { alt: true, shift: true })],
    ['arrange.alignTop', key('ArrowUp', { alt: true, shift: true })],
    ['arrange.alignBottom', key('ArrowDown', { alt: true, shift: true })],
    ['arrange.alignCenterX', key('Ó', { alt: true, shift: true, code: 'KeyH' })],
    ['arrange.alignCenterY', key('◊', { alt: true, shift: true, code: 'KeyV' })],
  ];

  const DISTRIBUTE: [string, ReturnType<typeof key>][] = [
    ['arrange.distributeX', key('Ó', { meta: true, alt: true, shift: true, code: 'KeyH' })],
    ['arrange.distributeY', key('◊', { meta: true, alt: true, shift: true, code: 'KeyV' })],
  ];

  it('binds every align command to its own keystroke', () => {
    for (const [id, event] of ALIGN) {
      expect(registry.matchEvent(event, withSelection(2))?.id, id).toBe(id);
    }
  });

  it('binds every distribute command to its own keystroke', () => {
    for (const [id, event] of DISTRIBUTE) {
      expect(registry.matchEvent(event, withSelection(3))?.id, id).toBe(id);
    }
  });

  it('needs two nodes to align and three to distribute', () => {
    for (const [, event] of ALIGN) {
      expect(registry.matchEvent(event, withSelection(1))).toBeUndefined();
    }
    for (const [, event] of DISTRIBUTE) {
      expect(registry.matchEvent(event, withSelection(2))).toBeUndefined();
    }
  });

  it('leaves the ⌘⌥ style shortcuts alone', () => {
    // Distribute carries ⇧ precisely so it cannot shadow paste-style, which
    // this registry cannot tell apart from a ⌃⌥V press.
    expect(registry.matchEvent(key('◊', { meta: true, alt: true, code: 'KeyV' }), withSelection(3))?.id)
      .toBe('style.paste');
    expect(registry.matchEvent(key('ç', { meta: true, alt: true, code: 'KeyC' }), withSelection(3))?.id)
      .toBe('style.copy');
  });

  it('offers align and distribute on the shape right-click menu', () => {
    for (const [id] of [...ALIGN, ...DISTRIBUTE]) {
      expect(registry.find(id)?.contextMenu, `${id} is not tagged`).toBe('node');
    }
  });
});
