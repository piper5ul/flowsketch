import { shortcutChips } from '../commands/registry';
import type { CommandContext, Platform } from '../commands/types';
import type { Registry } from '../commands/registry';

export type OverflowEntry = { id: string } | { submenu: string; ids: (string | '-')[] };

export const NODE_OVERFLOW: OverflowEntry[][] = [
  [
    { id: 'clipboard.copy' },
    { id: 'clipboard.copyAsImage' },
    { id: 'clipboard.cut' },
    { id: 'edit.delete' },
  ],
  [{ id: 'comment.addToSelection' }],
  [
    { id: 'style.copy' },
    { id: 'style.paste' },
    { id: 'style.saveDefault' },
  ],
  [
    {
      submenu: 'Arrange',
      ids: [
        'arrange.bringToFront',
        'arrange.bringForward',
        'arrange.sendBackward',
        'arrange.sendToBack',
        '-',
        'arrange.group',
        'arrange.ungroup',
      ],
    },
    {
      submenu: 'Align',
      ids: [
        'arrange.alignLeft',
        'arrange.alignCenterX',
        'arrange.alignRight',
        'arrange.alignTop',
        'arrange.alignCenterY',
        'arrange.alignBottom',
        '-',
        'arrange.distributeX',
        'arrange.distributeY',
        '-',
        'arrange.matchWidth',
        'arrange.matchHeight',
        'arrange.matchSize',
        '-',
        'arrange.layoutVertical',
        'arrange.layoutHorizontal',
      ],
    },
    { id: 'arrange.toggleLock' },
    { id: 'arrange.wrapInFrame' },
    { id: 'edit.link' },
    { id: 'view.toggleGridSnap' },
    { id: 'view.setThumbnail' },
    { id: 'view.clearThumbnail' },
    { id: 'view.presentFromFrame' },
  ],
];

export const EDGE_OVERFLOW: OverflowEntry[][] = [
  [{ id: 'edit.delete' }],
  [{ id: 'style.saveDefault' }],
  [{ id: 'view.toggleGridSnap' }],
];

export interface ResolvedItem {
  kind: 'item';
  id: string;
  title: string;
  chips: string[];
  enabled: boolean;
  checked?: boolean;
}

export interface ResolvedSubmenu {
  kind: 'submenu';
  title: string;
  items: (ResolvedItem | { kind: 'sep' })[];
}

export type ResolvedOverflowEntry = ResolvedItem | ResolvedSubmenu;

function resolveItem(
  id: string,
  title: string,
  shortcut: Parameters<typeof shortcutChips>[0],
  checked: boolean | undefined,
  enabled: boolean,
  includeChecked: boolean,
  platform: Platform,
): ResolvedItem {
  return {
    kind: 'item',
    id,
    title,
    chips: shortcutChips(shortcut, platform),
    enabled,
    ...(includeChecked ? { checked } : {}),
  };
}

function resolveCommand(
  id: string,
  reg: Registry,
  ctx: CommandContext,
  platform: Platform,
  enabled: boolean,
): ResolvedItem | undefined {
  const command = reg.find(id);
  if (!command) return undefined;
  return resolveItem(
    command.id,
    command.title,
    command.shortcut,
    command.checked?.(ctx),
    enabled,
    command.checked !== undefined,
    platform,
  );
}

function resolveSubmenu(
  entry: Extract<OverflowEntry, { submenu: string }>,
  reg: Registry,
  ctx: CommandContext,
  platform: Platform,
): ResolvedSubmenu | undefined {
  const items: ResolvedSubmenu['items'] = [];
  let separatorPending = false;
  let hasEnabledItem = false;

  for (const id of entry.ids) {
    if (id === '-') {
      if (items.length > 0) separatorPending = true;
      continue;
    }

    const command = reg.find(id);
    if (!command) continue;
    const enabled = !command.when || command.when(ctx);
    const item = resolveCommand(id, reg, ctx, platform, enabled);
    if (!item) continue;
    if (separatorPending && items.length > 0) items.push({ kind: 'sep' });
    items.push(item);
    separatorPending = false;
    hasEnabledItem ||= enabled;
  }

  return hasEnabledItem ? { kind: 'submenu', title: entry.submenu, items } : undefined;
}

export function resolveOverflow(
  sections: OverflowEntry[][],
  reg: Registry,
  ctx: CommandContext,
  platform: Platform,
): ResolvedOverflowEntry[][] {
  return sections
    .map((section) => section.flatMap((entry): ResolvedOverflowEntry[] => {
      if ('id' in entry) {
        const command = reg.find(entry.id);
        if (!command || (command.when && !command.when(ctx))) return [];
        const item = resolveCommand(entry.id, reg, ctx, platform, true);
        return item ? [item] : [];
      }

      const submenu = resolveSubmenu(entry, reg, ctx, platform);
      return submenu ? [submenu] : [];
    }))
    .filter((section) => section.length > 0);
}
