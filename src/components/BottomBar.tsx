import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@xyflow/react';
import { Undo2, Redo2, Minus, Plus, Maximize2, Map, Grid3x3 } from 'lucide-react';
import { useDiagramStore } from '../store/useDiagramStore';
import { useViewPreferences } from '../store/useViewPreferences';
import { formatShortcut, registry } from '../commands/commands';
import { Tooltip } from './Tooltip';

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
          pressed ? 'bg-accent-500/10 text-accent-600' : 'text-ink-700 hover:bg-black/[0.04]'
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function BottomBar({ onRunCommand }: { onRunCommand: (id: string) => void }) {
  const undo = useDiagramStore((s) => s.undo);
  const redo = useDiagramStore((s) => s.redo);
  const canUndo = useDiagramStore((s) => s.canUndo);
  const canRedo = useDiagramStore((s) => s.canRedo);
  const zoom = useStore((s) => s.transform[2]);
  const minimap = useViewPreferences((s) => s.minimap);
  const gridSnap = useViewPreferences((s) => s.gridSnap);
  const [percent, setPercent] = useState(80);

  useEffect(() => {
    setPercent(Math.round(zoom * 100));
  }, [zoom]);

  const run = useCallback((id: string) => () => onRunCommand(id), [onRunCommand]);

  return (
    <div className="pointer-events-none absolute bottom-5 right-5 z-20 flex items-center gap-2">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-2xl bg-white/95 p-1 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-black/[0.04] backdrop-blur">
        <IconButton onClick={undo} disabled={!canUndo} label="Undo" shortcut={shortcutOf('history.undo')}>
          <Undo2 size={17} />
        </IconButton>
        <IconButton onClick={redo} disabled={!canRedo} label="Redo" shortcut={shortcutOf('history.redo')}>
          <Redo2 size={17} />
        </IconButton>
      </div>
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-2xl bg-white/95 p-1 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-black/[0.04] backdrop-blur">
        <IconButton onClick={run('view.zoomOut')} label="Zoom out" shortcut={shortcutOf('view.zoomOut')}>
          <Minus size={16} />
        </IconButton>
        <Tooltip label="Reset zoom" shortcut={shortcutOf('view.zoomReset')} side="top">
          <button
            onClick={run('view.zoomReset')}
            className="w-12 rounded-lg py-1.5 text-center text-[13px] font-medium text-ink-700 tabular-nums transition hover:bg-black/[0.04]"
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
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-2xl bg-white/95 p-1 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-black/[0.04] backdrop-blur">
        <IconButton onClick={run('view.toggleMinimap')} label="Minimap" pressed={minimap}>
          <Map size={16} />
        </IconButton>
        <IconButton onClick={run('view.toggleGridSnap')} label="Snap to grid" pressed={gridSnap}>
          <Grid3x3 size={16} />
        </IconButton>
      </div>
      <div className="pointer-events-auto flex items-center rounded-2xl bg-white/95 p-1 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-black/[0.04] backdrop-blur">
        <IconButton onClick={run('view.shortcuts')} label="Keyboard shortcuts">
          <span aria-hidden className="text-[15px] font-semibold leading-none">?</span>
        </IconButton>
      </div>
    </div>
  );
}
