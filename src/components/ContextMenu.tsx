import { useEffect, useMemo, useRef } from 'react';
import { formatShortcut, registry } from '../commands/commands';
import type { Command, CommandContext, ContextMenuTarget } from '../commands/types';

export interface ContextMenuState {
  x: number;
  y: number;
  target: Exclude<ContextMenuTarget, 'any'>;
}

function offeredOn(command: Command, target: ContextMenuState['target']): boolean {
  if (!command.contextMenu) return false;
  const targets = Array.isArray(command.contextMenu) ? command.contextMenu : [command.contextMenu];
  return targets.includes('any') || targets.includes(target);
}

const MENU_WIDTH = 208;
/** Rough height per item plus the panel's own padding — enough to keep the menu on screen. */
const ITEM_HEIGHT = 30;
const MENU_PADDING = 12;

export function ContextMenu({
  state,
  ctx,
  onClose,
}: {
  state: ContextMenuState;
  ctx: CommandContext;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // The menu is rebuilt from the registry every time it opens, so a command
  // added to the registry shows up here without touching this file.
  const items = useMemo(
    () => registry.all().filter((command) => offeredOn(command, state.target) && (!command.when || command.when(ctx))),
    [state.target, ctx],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // Captured, so Escape dismisses the menu without also clearing the
      // selection the menu is acting on.
      event.stopPropagation();
      event.preventDefault();
      onClose();
    }
    function onPointerDown(event: PointerEvent) {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    }
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  if (items.length === 0) return null;

  // The node menu is long — every arrange command is on it — and `ITEM_HEIGHT`
  // is only an estimate: a title too wide for the panel wraps onto a second
  // line, so a menu that was expected to fit can still run off the bottom of a
  // short window, taking its last entries out of reach. The estimate still
  // decides *where* the menu opens; what guarantees it stays on screen is the
  // cap below, which is whatever room is left under that corner — and the menu
  // scrolls inside it rather than overflowing.
  const estimated = items.length * ITEM_HEIGHT + MENU_PADDING;
  const left = Math.min(state.x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.max(8, Math.min(state.y, window.innerHeight - estimated - 8));
  const maxHeight = window.innerHeight - top - 8;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Canvas actions"
      className="panel-in fixed z-50 flex flex-col gap-0.5 overflow-y-auto rounded-xl bg-panel p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.35)] ring-1 ring-line"
      style={{ left: Math.max(8, left), top, width: MENU_WIDTH, maxHeight }}
    >
      {items.map((command) => (
        <button
          key={command.id}
          role="menuitem"
          onClick={() => {
            command.run(ctx);
            onClose();
          }}
          className="flex shrink-0 items-center justify-between gap-4 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium text-ink-800 transition hover:bg-hover-strong"
        >
          <span>{command.title}</span>
          <span className="text-[11px] font-semibold text-ink-600/60">
            {formatShortcut(command.shortcut)}
          </span>
        </button>
      ))}
    </div>
  );
}
