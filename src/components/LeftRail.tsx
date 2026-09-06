import { useCallback, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import clsx from 'clsx';
import {
  MousePointer2,
  Hand,
  ArrowRight,
  CornerDownRight,
  ChevronRight,
} from 'lucide-react';
import { Tooltip } from './Tooltip';
import { useDiagramStore } from '../store/useDiagramStore';
import { useImageInsert } from '../lib/useImageInsert';
import { SHAPE_ICONS, SHAPE_LABELS } from '../lib/shapeIcons';
import type { ShapeKind, Tool } from '../types';

const ImageIcon = SHAPE_ICONS.image;

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

/** Every tool that draws a shape is named after the kind it draws. */
type ShapeTool = Tool & ShapeKind;

/** Rendered as a button of its own; the label and icon come from the shared maps. */
const SHAPE_TOOLS: { tool: ShapeTool; shortcut: string }[] = [
  { tool: 'rectangle', shortcut: 'R' },
  { tool: 'ellipse', shortcut: 'O' },
  { tool: 'diamond', shortcut: 'D' },
  { tool: 'pill', shortcut: 'U' },
  { tool: 'triangle', shortcut: 'G' },
  { tool: 'hexagon', shortcut: 'X' },
  { tool: 'cylinder', shortcut: 'Y' },
  { tool: 'sticky', shortcut: 'S' },
];

function ShapeToolButton({ tool, shortcut }: { tool: ShapeTool; shortcut?: string }) {
  const active = useDiagramStore((s) => s.tool === tool);
  const setTool = useDiagramStore((s) => s.setTool);
  const Icon = SHAPE_ICONS[tool];
  return (
    <RailButton active={active} label={SHAPE_LABELS[tool]} shortcut={shortcut} onClick={() => setTool(tool)}>
      <Icon size={18} />
    </RailButton>
  );
}

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
          <ShapeToolButton key={s.tool} tool={s.tool} shortcut={s.shortcut} />
        ))}

        <ShapeToolButton tool="text" shortcut="T" />

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
