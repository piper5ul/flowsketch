import { useCallback, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import clsx from 'clsx';
import {
  MousePointer2,
  Hand,
  Square,
  Circle,
  Diamond,
  StickyNote,
  Type,
  ArrowRight,
  CornerDownRight,
  ChevronRight,
  Triangle,
  Hexagon,
  Database,
  Image as ImageIcon,
} from 'lucide-react';
import { Tooltip } from './Tooltip';
import { useDiagramStore } from '../store/useDiagramStore';
import { useImageInsert } from '../lib/useImageInsert';
import type { Tool } from '../types';

function RailButton({
  active,
  label,
  shortcut,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  shortcut?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        onClick={onClick}
        className={clsx(
          'flex h-10 w-10 items-center justify-center rounded-xl transition-colors',
          active ? 'bg-accent-500 text-white shadow-[0_4px_14px_-2px_rgba(124,92,255,0.55)]' : 'text-white/70 hover:bg-white/10 hover:text-white',
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

const PillIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="14" height="8" rx="4" />
  </svg>
);

const SHAPE_TOOLS: { tool: Tool; label: string; shortcut: string; icon: React.ReactNode }[] = [
  { tool: 'rectangle', label: 'Rectangle', shortcut: 'R', icon: <Square size={18} /> },
  { tool: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: <Circle size={18} /> },
  { tool: 'diamond', label: 'Diamond', shortcut: 'D', icon: <Diamond size={18} /> },
  { tool: 'pill', label: 'Pill', shortcut: 'U', icon: <PillIcon /> },
  { tool: 'triangle', label: 'Triangle', shortcut: 'G', icon: <Triangle size={18} /> },
  { tool: 'hexagon', label: 'Hexagon', shortcut: 'X', icon: <Hexagon size={18} /> },
  { tool: 'cylinder', label: 'Cylinder', shortcut: 'Y', icon: <Database size={18} /> },
  { tool: 'sticky', label: 'Sticky note', shortcut: 'S', icon: <StickyNote size={18} /> },
];

export function LeftRail() {
  const tool = useDiagramStore((s) => s.tool);
  const setTool = useDiagramStore((s) => s.setTool);
  const defaultConnector = useDiagramStore((s) => s.defaultConnector);
  const setDefaultStyle = useDiagramStore((s) => s.setDefaultStyle);
  const [connectorMenuOpen, setConnectorMenuOpen] = useState(false);
  const insertImages = useImageInsert();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFilesPicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      // Clearing the input lets the same file be picked twice in a row, which
      // would otherwise fire no change event the second time.
      event.target.value = '';
      insertImages(files);
    },
    [insertImages],
  );

  return (
    <div className="pointer-events-none absolute left-4 top-1/2 z-20 -translate-y-1/2">
      <div className="pointer-events-auto flex flex-col gap-1 rounded-2xl bg-ink-950/95 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)] backdrop-blur">
        <RailButton active={tool === 'select'} label="Select" shortcut="V" onClick={() => setTool('select')}>
          <MousePointer2 size={18} />
        </RailButton>
        <RailButton active={tool === 'pan'} label="Pan" shortcut="H" onClick={() => setTool('pan')}>
          <Hand size={18} />
        </RailButton>

        <div className="my-1 h-px bg-white/10" />

        {SHAPE_TOOLS.map((s) => (
          <RailButton
            key={s.tool}
            active={tool === s.tool}
            label={s.label}
            shortcut={s.shortcut}
            onClick={() => setTool(s.tool)}
          >
            {s.icon}
          </RailButton>
        ))}

        <RailButton active={tool === 'text'} label="Text" shortcut="T" onClick={() => setTool('text')}>
          <Type size={18} />
        </RailButton>

        {/* An image is inserted, not drawn, so this is a one-shot action
            rather than a tool the canvas stays in. */}
        <RailButton label="Insert image" onClick={() => fileInputRef.current?.click()}>
          <ImageIcon size={18} />
        </RailButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onFilesPicked}
        />

        <div className="my-1 h-px bg-white/10" />

        <Popover.Root open={connectorMenuOpen} onOpenChange={setConnectorMenuOpen}>
          <Popover.Trigger asChild>
            <div className="relative">
              <RailButton
                active={tool === 'connector'}
                label="Connector"
                shortcut="A"
                onClick={() => setTool('connector')}
              >
                {defaultConnector === 'elbow' ? <CornerDownRight size={18} /> : <ArrowRight size={18} />}
              </RailButton>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConnectorMenuOpen((v) => !v);
                }}
                className="absolute -right-0.5 -bottom-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-ink-700 text-white/70"
              >
                <ChevronRight size={9} />
              </button>
            </div>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="right"
              sideOffset={12}
              className="panel-in z-50 flex flex-col gap-0.5 rounded-xl bg-ink-950 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)]"
            >
              <button
                onClick={() => {
                  setDefaultStyle({ connector: 'elbow' });
                  setTool('connector');
                  setConnectorMenuOpen(false);
                }}
                className={clsx(
                  'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10',
                  defaultConnector === 'elbow' && 'bg-accent-500/90 text-white hover:bg-accent-500',
                )}
              >
                <CornerDownRight size={16} /> Elbow
              </button>
              <button
                onClick={() => {
                  setDefaultStyle({ connector: 'straight' });
                  setTool('connector');
                  setConnectorMenuOpen(false);
                }}
                className={clsx(
                  'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10',
                  defaultConnector === 'straight' && 'bg-accent-500/90 text-white hover:bg-accent-500',
                )}
              >
                <ArrowRight size={16} /> Straight
              </button>
              <Popover.Arrow className="fill-ink-950" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}
