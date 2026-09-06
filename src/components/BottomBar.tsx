import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@xyflow/react';
import { Undo2, Redo2, Minus, Plus, Maximize2, Map, Grid3x3, Sun, Moon, Monitor } from 'lucide-react';
import { useDiagramStore } from '../store/useDiagramStore';
import { useViewPreferences } from '../store/useViewPreferences';
import { formatShortcut, registry } from '../commands/commands';
import { nextTheme, type ThemePreference } from '../lib/theme';
import { Tooltip } from './Tooltip';

/**
 * The icon each state wears, and the word the tooltip uses for it. `'system'`
 * gets the monitor rather than whichever colour it happens to resolve to: the
 * button reports the *preference*, and "following your system" is a state of
 * its own worth being able to see.
 */
const THEME_FACES: Record<ThemePreference, { Icon: typeof Sun; label: string }> = {
  system: { Icon: Monitor, label: 'system theme' },
  light: { Icon: Sun, label: 'light theme' },
  dark: { Icon: Moon, label: 'dark theme' },
};

/** A command's own keystroke, so a tooltip can never drift from the binding. */
function shortcutOf(id: string): string | undefined {
  return formatShortcut(registry.find(id)?.shortcut) || undefined;
}

function IconButton({
  onClick,
  disabled,
  label,
  shortcut,
  /** Set on a toggle, where it also carries `aria-pressed`. Left off for plain actions. */
  pressed,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  shortcut?: string;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} shortcut={shortcut} side="top">
      <button
        onClick={onClick}
        disabled={disabled}
        aria-pressed={pressed}
        className={`flex h-9 w-9 items-center justify-center rounded-xl transition disabled:opacity-30 disabled:hover:bg-transparent ${
          pressed ? 'bg-accent-500/10 text-accent-600' : 'text-ink-700 hover:bg-hover'
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * The theme control: one button cycling system → light → dark.
 *
 * Not an `IconButton`, because it is not a toggle — there is no "pressed" to
 * report on three states. The icon says where the preference stands and the
 * tooltip says where a click will take it, which is the pair a cycling control
 * needs to be usable without trying it first.
 */
function ThemeButton({ preference, onClick }: { preference: ThemePreference; onClick: () => void }) {
  const { Icon } = THEME_FACES[preference];
  const upcoming = THEME_FACES[nextTheme(preference)].label;

  return (
    <Tooltip label={`Switch to ${upcoming}`} side="top">
      <button
        onClick={onClick}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-700 transition hover:bg-hover"
      >
        <Icon size={16} />
      </button>
    </Tooltip>
  );
}

export function BottomBar({ onRunCommand }: { onRunCommand: (id: string) => void }) {
  const undo = useDiagramStore((s) => s.undo);
  const redo = useDiagramStore((s) => s.redo);
  const canUndo = useDiagramStore((s) => s.canUndo);
  const canRedo = useDiagramStore((s) => s.canRedo);
  // Nothing on a read-only board can be undone, so the pair is dropped rather
  // than shown permanently greyed out.
  const readOnly = useDiagramStore((s) => s.readOnly);
  const zoom = useStore((s) => s.transform[2]);
  const minimap = useViewPreferences((s) => s.minimap);
  const gridSnap = useViewPreferences((s) => s.gridSnap);
  const theme = useViewPreferences((s) => s.theme);
  const [percent, setPercent] = useState(80);

  useEffect(() => {
    setPercent(Math.round(zoom * 100));
  }, [zoom]);

  const run = useCallback((id: string) => () => onRunCommand(id), [onRunCommand]);

  return (
    <div className="pointer-events-none absolute bottom-5 right-5 z-20 flex items-center gap-2">
      {!readOnly && (
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-2xl bg-panel/95 p-1 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-line-subtle backdrop-blur">
          <IconButton onClick={undo} disabled={!canUndo} label="Undo" shortcut={shortcutOf('history.undo')}>
            <Undo2 size={17} />
          </IconButton>
          <IconButton onClick={redo} disabled={!canRedo} label="Redo" shortcut={shortcutOf('history.redo')}>
            <Redo2 size={17} />
          </IconButton>
        </div>
      )}
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-2xl bg-panel/95 p-1 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-line-subtle backdrop-blur">
        <IconButton onClick={run('view.zoomOut')} label="Zoom out" shortcut={shortcutOf('view.zoomOut')}>
          <Minus size={16} />
        </IconButton>
        <Tooltip label="Reset zoom" shortcut={shortcutOf('view.zoomReset')} side="top">
          <button
            onClick={run('view.zoomReset')}
            className="w-12 rounded-lg py-1.5 text-center text-[13px] font-medium text-ink-700 tabular-nums transition hover:bg-hover"
          >
            {percent}%
          </button>
        </Tooltip>
        <IconButton onClick={run('view.zoomIn')} label="Zoom in" shortcut={shortcutOf('view.zoomIn')}>
          <Plus size={16} />
        </IconButton>
        <IconButton onClick={run('view.fitView')} label="Fit to view" shortcut={shortcutOf('view.fitView')}>
          <Maximize2 size={15} />
        </IconButton>
      </div>
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-2xl bg-panel/95 p-1 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-line-subtle backdrop-blur">
        <IconButton onClick={run('view.toggleMinimap')} label="Minimap" pressed={minimap}>
          <Map size={16} />
        </IconButton>
        <IconButton onClick={run('view.toggleGridSnap')} label="Snap to grid" pressed={gridSnap}>
          <Grid3x3 size={16} />
        </IconButton>
        <ThemeButton preference={theme} onClick={run('view.toggleTheme')} />
      </div>
      <div className="pointer-events-auto flex items-center rounded-2xl bg-panel/95 p-1 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-line-subtle backdrop-blur">
        <IconButton onClick={run('view.shortcuts')} label="Keyboard shortcuts">
          <span aria-hidden className="text-[15px] font-semibold leading-none">?</span>
        </IconButton>
      </div>
    </div>
  );
}
