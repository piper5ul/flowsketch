import { afterEach, describe, expect, it } from 'vitest';
import { registry } from '../commands/commands';
import { shortcutChips } from '../commands/registry';
import type { CommandContext } from '../commands/types';
import { useViewPreferences } from '../store/useViewPreferences';
import { EDGE_OVERFLOW, NODE_OVERFLOW, resolveOverflow } from './overflowMenu';

function context(options: {
  nodes?: { id: string; selected: boolean; type?: string; data?: { shape?: string; locked?: boolean } }[];
  edges?: { id: string; selected: boolean; source?: string; target?: string; data?: Record<string, unknown> }[];
  style?: Record<string, unknown> | null;
} = {}): CommandContext {
  return {
    store: {
      getState: () => ({
        readOnly: false,
        nodes: options.nodes ?? [],
        edges: options.edges ?? [],
        thumbnailNodeIds: null,
      }),
    },
    styleClipboard: { get: () => options.style ?? null, set: () => {} },
    ui: { startCommentOn: () => {} },
  } as unknown as CommandContext;
}

function shapes(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    selected: true,
    type: 'shape',
    data: { shape: 'rectangle' },
  }));
}

function submenu(items: ReturnType<typeof resolveOverflow>[number], title: string) {
  return items.find((item) => item.kind === 'submenu' && item.title === title);
}

const initialGridSnap = useViewPreferences.getState().gridSnap;

afterEach(() => {
  useViewPreferences.setState({ gridSnap: initialGridSnap });
});

describe('resolveOverflow', () => {
  it('shows the one-node actions and gets Copy chips from the registry', () => {
    const resolved = resolveOverflow(NODE_OVERFLOW, registry, context({ nodes: shapes(1) }), 'mac');
    const flat = resolved.flatMap((section) => section.filter((entry) => entry.kind === 'item'));

    expect(resolved.flat().some((entry) => entry.kind === 'submenu' && entry.title === 'Align')).toBe(false);
    expect(flat.some((item) => item.id === 'edit.delete')).toBe(true);
    const copy = flat.find((item) => item.id === 'clipboard.copy');
    expect(copy?.chips).toEqual(shortcutChips(registry.find('clipboard.copy')!.shortcut, 'mac'));
    expect(flat.some((item) => item.id === 'style.paste')).toBe(false);
  });

  it('keeps Align for two shapes with distribution disabled, and enables it at three', () => {
    const two = resolveOverflow(NODE_OVERFLOW, registry, context({ nodes: shapes(2) }), 'mac');
    const twoAlign = submenu(two.flat(), 'Align');
    expect(twoAlign?.kind).toBe('submenu');
    if (twoAlign?.kind !== 'submenu') throw new Error('Align submenu missing');
    const twoDistribute = twoAlign.items.find((item) => item.kind === 'item' && item.id === 'arrange.distributeX');
    expect(twoDistribute?.kind === 'item' ? twoDistribute.enabled : undefined).toBe(false);

    const three = resolveOverflow(NODE_OVERFLOW, registry, context({ nodes: shapes(3) }), 'mac');
    const threeAlign = submenu(three.flat(), 'Align');
    expect(threeAlign?.kind).toBe('submenu');
    if (threeAlign?.kind !== 'submenu') throw new Error('Align submenu missing');
    const threeDistribute = threeAlign.items.find((item) => item.kind === 'item' && item.id === 'arrange.distributeX');
    expect(threeDistribute?.kind === 'item' ? threeDistribute.enabled : undefined).toBe(true);
  });

  it('carries checked Lock and Snap to grid state', () => {
    const oldGridSnap = useViewPreferences.getState().gridSnap;
    useViewPreferences.setState({ gridSnap: !oldGridSnap });
    const resolved = resolveOverflow(
      NODE_OVERFLOW,
      registry,
      context({ nodes: [{ ...shapes(1)[0], data: { shape: 'rectangle', locked: true } }] }),
      'mac',
    );
    const items = resolved.flat().filter((item) => item.kind === 'item');
    expect(items.find((item) => item.id === 'arrange.toggleLock')?.checked).toBe(true);
    expect(items.find((item) => item.id === 'view.toggleGridSnap')?.checked).toBe(!oldGridSnap);
  });

  it('drops empty sections and normalizes submenu separators', () => {
    const resolved = resolveOverflow(
      [
        [],
        [{ id: 'missing.command' }],
        [{ submenu: 'Arrange', ids: ['-', 'arrange.alignLeft', '-', '-', 'arrange.alignRight', '-'] }],
      ],
      registry,
      context({ nodes: shapes(2) }),
      'mac',
    );
    expect(resolved).toHaveLength(1);
    const align = submenu(resolved.flat(), 'Arrange');
    expect(align?.kind).toBe('submenu');
    if (align?.kind !== 'submenu') throw new Error('Arrange submenu missing');
    expect(align.items.map((item) => item.kind)).toEqual(['item', 'sep', 'item']);
  });

  it('resolves the connector overflow actions', () => {
    const resolved = resolveOverflow(
      EDGE_OVERFLOW,
      registry,
      context({ edges: [{ id: 'e1', selected: true, source: 'a', target: 'b', data: {} }] }),
      'other',
    );
    expect(resolved.map((section) => section.map((item) => item.kind === 'item' ? item.id : item.title))).toEqual([
      ['edit.delete'],
      ['style.saveDefault'],
      ['view.toggleGridSnap'],
    ]);
  });
});
