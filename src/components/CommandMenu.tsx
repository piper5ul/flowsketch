/**
 * The ⌘K command menu: every command the registry offers right now, searchable,
 * with the ones used most recently at the top and each one's shortcut beside
 * it — so a command can be found by name once and by key thereafter.
 *
 * What is offered is decided by each command's own `when`, with the context the
 * canvas built, so the menu and the keyboard never disagree about what can be
 * done; a viewer's menu is the read-only set for the same reason. Recents are
 * a per-browser preference, like the minimap: not part of the diagram.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { GROUP_LABELS, detectPlatform, registry, shortcutLabels } from '../commands/commands';
import type { Command, CommandContext } from '../commands/types';
import { rankCommands, rememberRecent, sanitizeRecents } from '../lib/commandMenu';
import { getPreference, setPreference } from '../lib/preferences';

/** Commands that make no sense to pick from a list. */
const NOT_LISTED = new Set(['view.commandMenu', 'view.pan']);

export function CommandMenu({ ctx, onClose }: { ctx: CommandContext; onClose: () => void }) {
  const platform = useMemo(detectPlatform, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<string[]>(() => sanitizeRecents(getPreference<unknown>('commandRecents', [])));

  // Offered as of opening: a command's `when` reads the store, and the menu
  // is modal, so nothing changes underneath it.
  const offered = useMemo(
    () => registry.all().filter((c) => !c.hidden && !NOT_LISTED.has(c.id) && (c.when?.(ctx) ?? true)),
    [ctx],
  );
  const shown = useMemo(() => rankCommands(query, offered, recents), [query, offered, recents]);
  const groupLabel = useMemo(() => new Map(GROUP_LABELS.map(({ group, label }) => [group, label])), []);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (command: Command) => {
    const next = rememberRecent(recents, command.id);
    setRecents(next);
    setPreference('commandRecents', next);
    onClose();
    command.run(ctx);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/40 p-6 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        className="panel-in flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-panel shadow-[0_30px_80px_-20px_rgba(10,10,25,0.5)]"
      >
        <label className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Search size={16} className="shrink-0 text-ink-600" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, shown.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (shown[active]) run(shown[active]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
            placeholder="Type a command…"
            aria-label="Search commands"
            aria-controls="command-menu-list"
            aria-activedescendant={shown[active] ? `command-${shown[active].id}` : undefined}
            className="w-full bg-transparent text-[14px] text-ink-900 outline-none placeholder:text-ink-600/60"
          />
        </label>
        <ul ref={listRef} id="command-menu-list" role="listbox" className="overflow-y-auto p-1.5">
          {shown.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-ink-600">No command matches</li>}
          {shown.map((command, index) => {
            const recent = query.trim() === '' && index < recents.length && recents.includes(command.id) && index < 3;
            return (
              <li
                key={command.id}
                id={`command-${command.id}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(command)}
                className={`flex cursor-pointer items-center justify-between gap-4 rounded-lg px-3 py-1.5 ${index === active ? 'bg-hover' : ''}`}
              >
                <span className="flex items-baseline gap-2 truncate">
                  <span className="truncate text-[13px] text-ink-800">{command.title}</span>
                  <span className="shrink-0 text-[11px] text-ink-600/70">{recent ? 'Recent' : groupLabel.get(command.group)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {shortcutLabels(command.shortcut, platform).map((label, i) => (
                    <kbd key={`${command.id}-${i}`} className="rounded bg-hover-strong px-1.5 py-0.5 font-sans text-[11px] font-semibold text-ink-700">
                      {label}
                    </kbd>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
