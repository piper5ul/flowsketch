import { useCallback, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import clsx from 'clsx';
import {
  MousePointer2,
  Hand,
  ArrowRight,
  CornerDownRight,
  ChevronRight,
  Frame,
  Shapes,
  Spline,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { useDiagramStore } from '../store/useDiagramStore';
import { useImageInsert } from '../lib/useImageInsert';
import { SHAPE_ICONS, SHAPE_LABELS } from '../lib/shapeIcons';
import type { ConnectorKind, ShapeKind, Tool } from '../types';

const ImageIcon = SHAPE_ICONS.image;

/**
 * The kinds the connector button can be set to draw. Each also names the icon
 * the rail button itself wears while that kind is the default, so the tool
 * shows what it would draw before it draws it.
 */
const CONNECTOR_KINDS: { kind: ConnectorKind; label: string; Icon: LucideIcon }[] = [
  { kind: 'elbow', label: 'Elbow', Icon: CornerDownRight },
  { kind: 'straight', label: 'Straight', Icon: ArrowRight },
  { kind: 'curved', label: 'Curved', Icon: Spline },
];

// Props are forwarded to the button so a Radix `asChild` trigger can wrap this
// the way it wraps a plain one.
type RailButtonProps = React.ComponentPropsWithRef<'button'> & {
  active?: boolean;
  label: string;
  shortcut?: string;
};

function RailButton({ active, label, shortcut, className, children, ...rest }: RailButtonProps) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        {...rest}
        className={clsx(
          'flex h-10 w-10 items-center justify-center rounded-xl transition-colors',
          active ? 'bg-accent-500 text-white shadow-[0_4px_14px_-2px_rgba(124,92,255,0.55)]' : 'text-white/70 hover:bg-white/10 hover:text-white',
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** Every tool that draws a shape is named after the kind it draws. */
type ShapeTool = Tool & ShapeKind;

/**
 * The shapes with a button of their own. The rail is a column beside the
 * canvas, so it can hold about this many before it stops being a glance and
 * starts being a list — everything else lives behind "More shapes".
 */
const SHAPE_TOOLS: { tool: ShapeTool; shortcut: string }[] = [
  { tool: 'rectangle', shortcut: 'R' },
  { tool: 'ellipse', shortcut: 'O' },
  { tool: 'diamond', shortcut: 'D' },
  { tool: 'pill', shortcut: 'U' },
];

/** The rest, in the "More shapes" grid. The four with a keystroke keep it. */
const MORE_SHAPE_TOOLS: { tool: ShapeTool; shortcut?: string }[] = [
  { tool: 'triangle', shortcut: 'G' },
  { tool: 'hexagon', shortcut: 'X' },
  { tool: 'cylinder', shortcut: 'Y' },
  { tool: 'sticky', shortcut: 'S' },
  { tool: 'parallelogram', shortcut: 'P' },
  { tool: 'document' },
  { tool: 'cloud' },
  { tool: 'star' },
  { tool: 'callout' },
  { tool: 'arrow' },
];

/**
 * What the "More shapes" popover offers, in grid order.
 *
 * Every entry but the last names a `ShapeKind`, so its icon and label come from
 * the shared shape tables. A frame is not a shape — it is a section other
 * shapes go into — so it brings its own, and lives here rather than on the rail
 * itself because it is drawn far less often than a rectangle.
 */
const MORE_TOOLS: {
  tool: Tool;
  label: string;
  // Wider than `LucideIcon`: the shape table's icons are hand-drawn components
  // of its own, and this list holds both.
  Icon: React.ComponentType<{ size?: number }>;
  shortcut?: string;
}[] = [
  ...MORE_SHAPE_TOOLS.map(({ tool, shortcut }) => ({
    tool: tool as Tool,
    label: SHAPE_LABELS[tool],
    Icon: SHAPE_ICONS[tool],
    shortcut,
  })),
  { tool: 'frame', label: 'Frame', Icon: Frame, shortcut: 'F' },
];

const MORE_SHAPE_SET = new Set<Tool>(MORE_TOOLS.map((s) => s.tool));

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

/** The overflow of the shape rail: one button that opens a grid of the rest. */
function MoreShapesMenu() {
  const tool = useDiagramStore((s) => s.tool);
  const setTool = useDiagramStore((s) => s.setTool);
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <RailButton active={MORE_SHAPE_SET.has(tool)} label="More shapes">
          <Shapes size={18} />
        </RailButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          sideOffset={12}
          aria-label="More shapes"
          className="panel-in z-50 rounded-2xl bg-ink-950 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)]"
        >
          <div className="grid grid-cols-5 gap-0.5">
            {MORE_TOOLS.map(({ tool: kind, label, Icon, shortcut }) => {
              return (
                <Tooltip key={kind} label={label} shortcut={shortcut} side="top">
                  <button
                    onClick={() => {
                      setTool(kind);
                      setOpen(false);
                    }}
                    className={clsx(
                      'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                      tool === kind ? 'bg-accent-500 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <Icon size={18} />
                  </button>
                </Tooltip>
              );
            })}
          </div>
          <Popover.Arrow className="fill-ink-950" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
  const ConnectorToolIcon =
    CONNECTOR_KINDS.find((c) => c.kind === defaultConnector)?.Icon ?? CornerDownRight;

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
      <div className="pointer-events-auto flex flex-col gap-1 rounded-2xl bg-ink-950/95 ring-1 ring-white/[0.07] p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)] backdrop-blur">
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

        <MoreShapesMenu />

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
                <ConnectorToolIcon size={18} />
              </RailButton>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConnectorMenuOpen((v) => !v);
                }}
                // A lifted disc on the dark rail, so its ground is spelled out
                // rather than taken from the themed ink scale — `ink-700`
                // inverts with the theme and would turn this white-on-white.
                className="absolute -right-0.5 -bottom-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white/15 text-white/70"
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
              {CONNECTOR_KINDS.map(({ kind, label, Icon }) => (
                <button
                  key={kind}
                  onClick={() => {
                    setDefaultStyle({ connector: kind });
                    setTool('connector');
                    setConnectorMenuOpen(false);
                  }}
                  className={clsx(
                    'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10',
                    defaultConnector === kind && 'bg-accent-500/90 text-white hover:bg-accent-500',
                  )}
                >
                  <Icon size={16} /> {label}
                </button>
              ))}
              <Popover.Arrow className="fill-ink-950" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}
