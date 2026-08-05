import { useState, useEffect, useCallback } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { Undo2, Redo2, Minus, Plus } from 'lucide-react';
import { useDiagramStore } from '../store/useDiagramStore';
import { Tooltip } from './Tooltip';

function IconButton({
  onClick,
  disabled,
  label,
  shortcut,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  shortcut?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} shortcut={shortcut} side="top">
      <button
        onClick={onClick}
        disabled={disabled}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-700 transition hover:bg-black/[0.04] disabled:opacity-30 disabled:hover:bg-transparent"
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function BottomBar() {
  const { zoomIn, zoomOut, setViewport, getViewport } = useReactFlow();
  const undo = useDiagramStore((s) => s.undo);
  const redo = useDiagramStore((s) => s.redo);
  const zoom = useStore((s) => s.transform[2]);
  const [percent, setPercent] = useState(80);

  useEffect(() => {
    setPercent(Math.round(zoom * 100));
  }, [zoom]);

  const resetZoom = useCallback(() => {
    const vp = getViewport();
    setViewport({ ...vp, zoom: 1 }, { duration: 200 });
  }, [getViewport, setViewport]);

  return (
    <div className="pointer-events-none absolute bottom-5 right-5 z-20 flex items-center gap-2">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-2xl bg-white/95 p-1 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-black/[0.04] backdrop-blur">
        <IconButton onClick={undo} label="Undo" shortcut="⌘Z">
          <Undo2 size={17} />
        </IconButton>
        <IconButton onClick={redo} label="Redo" shortcut="⌘⇧Z">
          <Redo2 size={17} />
        </IconButton>
      </div>
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-2xl bg-white/95 p-1 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-black/[0.04] backdrop-blur">
        <IconButton onClick={() => zoomOut({ duration: 150 })} label="Zoom out" shortcut="-">
          <Minus size={16} />
        </IconButton>
        <Tooltip label="Reset zoom" side="top">
          <button
            onClick={resetZoom}
            className="w-12 rounded-lg py-1.5 text-center text-[13px] font-medium text-ink-700 tabular-nums transition hover:bg-black/[0.04]"
          >
            {percent}%
          </button>
        </Tooltip>
        <IconButton onClick={() => zoomIn({ duration: 150 })} label="Zoom in" shortcut="+">
          <Plus size={16} />
        </IconButton>
      </div>
    </div>
  );
}
