import { useCallback, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import clsx from 'clsx';
import {
  MousePointer2,
  Hand,
  ArrowRight,
  CornerDownRight,
  ChevronRight,
  Eraser,
  Frame,
  Highlighter,
  LayoutTemplate,
  Pencil,
  Shapes,
  Spline,
  Table,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { defaultConnectorKind, useDiagramStore } from '../store/useDiagramStore';
import { useImageInsert } from '../lib/useImageInsert';
import { SHAPE_ICONS, SHAPE_LABELS } from '../lib/shapeIcons';
import { WIRE_ICONS } from '../lib/wireIcons';
import { WIRE_COMPONENTS, WIRE_LABELS } from '../lib/wireframe';
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
 * Every entry but the last two names a `ShapeKind`, so its icon and label come
 * from the shared shape tables. A frame is not a shape — it is a section other
 * shapes go into — and nor is a table, which is a grid of cells whose box is
 * its own contents; both bring their own icon, and both live here rather than
 * on the rail itself because they are drawn far less often than a rectangle.
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
  { tool: 'table', label: 'Table', Icon: Table, shortcut: 'E' },
];

const MORE_SHAPE_SET = new Set<Tool>(MORE_TOOLS.map((s) => s.tool));

/**
 * The freehand tools. The keys are B / ⇧B / ⇧E rather than Whimsical's
 * H / ⇧H / E: H is this app's hand tool and E its table — see the note in
 * `TOOL_COMMANDS`.
 */
const INK_TOOLS: { tool: Tool; label: string; shortcut: string; Icon: LucideIcon }[] = [
  { tool: 'pen', label: 'Pen', shortcut: 'B', Icon: Pencil },
  { tool: 'highlighter', label: 'Highlighter', shortcut: '⇧B', Icon: Highlighter },
  { tool: 'eraser', label: 'Eraser', shortcut: '⇧E', Icon: Eraser },
];

const INK_TOOL_SET = new Set<Tool>(INK_TOOLS.map((t) => t.tool));

/**
 * One rail button for the three freehand tools, with the other two on a
 * popover — the shape the connector button already has.
 *
 * A band of three buttons would read more directly, and the rail cannot afford
 * it: it is a column beside the canvas, and it is already as tall as a laptop
 * window can hold. The button wears the last pen picked, so the tool shows what
 * it would draw before it draws it.
 */
function PenMenu() {
  const tool = useDiagramStore((s) => s.tool);
  const setTool = useDiagramStore((s) => s.setTool);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Tool>('pen');
  const current = INK_TOOLS.find((t) => t.tool === picked) ?? INK_TOOLS[0];

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <div className="relative">
          <RailButton
            active={INK_TOOL_SET.has(tool)}
            label={current.label}
            shortcut={current.shortcut}
            onClick={() => setTool(current.tool)}
          >
            <current.Icon size={18} />
          </RailButton>
          <button
            aria-label="More pens"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
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
          aria-label="Pens"
          className="panel-in z-50 flex flex-col gap-0.5 rounded-xl bg-ink-950 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)]"
        >
          {INK_TOOLS.map(({ tool: pen, label, shortcut, Icon }) => (
            <button
              key={pen}
              onClick={() => {
                setPicked(pen);
                setTool(pen);
                setOpen(false);
              }}
              className={clsx(
                'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10',
                tool === pen && 'bg-accent-500/90 text-white hover:bg-accent-500',
              )}
            >
              <Icon size={16} /> {label}
              <span className="ml-auto pl-3 text-[10px] font-semibold text-white/40">{shortcut}</span>
            </button>
          ))}
          <Popover.Arrow className="fill-ink-950" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The wireframe library: **one** rail button opening a grid of the fourteen
 * components.
 *
 * One button and not fourteen for the reason the pen menu is one: the rail is a
 * column beside the canvas and is already about as tall as a laptop window can
 * hold. W opens this grid rather than arming a tool — there is no single
 * "wireframe" to place — and picking a component arms `wire` with it, so the
 * next click on the board drops it.
 *
 * Open state is the canvas's, not this component's: the keystroke runs through
 * the command registry and reaches the canvas's `ctx.ui`, which is where the
 * shortcut sheet and the ⌘K menu already live.
 */
function WireframeMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const armed = useDiagramStore((s) => s.tool === 'wire');
  const current = useDiagramStore((s) => s.wireComponent);
  const setWireTool = useDiagramStore((s) => s.setWireTool);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <RailButton active={armed} label="Wireframe" shortcut="W">
          <LayoutTemplate size={18} />
        </RailButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          sideOffset={12}
          aria-label="Wireframe components"
          className="panel-in z-50 rounded-2xl bg-ink-950 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)]"
        >
          <div className="grid grid-cols-4 gap-0.5">
            {WIRE_COMPONENTS.map((component) => {
              const Icon = WIRE_ICONS[component];
              return (
                <button
                  key={component}
                  onClick={() => {
                    setWireTool(component);
                    onOpenChange(false);
                  }}
                  className={clsx(
                    'flex h-14 w-16 flex-col items-center justify-center gap-1 rounded-lg px-1 transition-colors',
                    armed && current === component
                      ? 'bg-accent-500 text-white'
                      : 'text-white/70 hover:bg-white/10 hover:text-white',
                  )}
                >
                  <Icon size={18} />
                  {/* The name is spelled out rather than left to a tooltip: a
                      grid of fourteen abstract glyphs is a guessing game. */}
                  <span className="w-full truncate text-center text-[10px] font-medium leading-none">
                    {WIRE_LABELS[component]}
                  </span>
                </button>
              );
            })}
          </div>
          <Popover.Arrow className="fill-ink-950" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

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

/**
 * `wirePickerOpen` and its setter come from the canvas because the W command
 * opens the picker, and a command reaches the canvas's UI through `ctx.ui`.
 * Every other popover here opens only from a click and keeps its own state.
 */
export function LeftRail({
  wirePickerOpen,
  onWirePickerOpenChange,
}: {
  wirePickerOpen: boolean;
  onWirePickerOpenChange: (open: boolean) => void;
}) {
  const tool = useDiagramStore((s) => s.tool);
  const setTool = useDiagramStore((s) => s.setTool);
  // Derived rather than stored: what the rail shows as picked is exactly what
  // `newConnectorData` will build, board default and session layer included.
  const defaults = useDiagramStore((s) => s.defaults);
  const lastStyle = useDiagramStore((s) => s.lastStyle);
  const defaultConnector = defaultConnectorKind({ defaults, lastStyle });
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

  // The rail is a column of a dozen buttons beside the canvas, and on a short
  // window that is nearly the whole window: it must never grow past the board
  // it sits on. `max-h-[calc(100%-2rem)]` bounds it to the canvas with a 1 rem
  // margin top and bottom, `overflow-y-auto` lets what is left scroll inside
  // that box, and `.rail-stack` tightens the gaps and the padding under
  // `max-height: 800px` (see `index.css`) so the scrolling is the last resort
  // rather than the first. The scrollbar is hidden — a 10 px gutter inside a
  // 52 px rail would be a third of the icon wide — and every popover trigger
  // keeps working: Radix portals its content, so nothing here can clip it.
  return (
    <div className="pointer-events-none absolute left-4 top-1/2 z-20 max-h-[calc(100%-2rem)] -translate-y-1/2">
      {/* Named, for the reason `FloatingToolbar` is: several of these buttons
          share a label with one somewhere else ("Text" picks the text tool
          here and opens typography there), and the name is what tells them
          apart in a test. */}
      <div
        role="toolbar"
        aria-label="Tools"
        aria-orientation="vertical"
        className="rail-stack pointer-events-auto flex max-h-full flex-col gap-1 overflow-y-auto rounded-2xl bg-ink-950/95 ring-1 ring-white/[0.07] p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)] backdrop-blur"
      >
        <RailButton active={tool === 'select'} label="Select" shortcut="V" onClick={() => setTool('select')}>
          <MousePointer2 size={18} />
        </RailButton>
        <RailButton active={tool === 'pan'} label="Pan" shortcut="H" onClick={() => setTool('pan')}>
          <Hand size={18} />
        </RailButton>

        <div className="rail-divider my-1 h-px bg-white/10" />

        {SHAPE_TOOLS.map((s) => (
          <ShapeToolButton key={s.tool} tool={s.tool} shortcut={s.shortcut} />
        ))}

        <MoreShapesMenu />

        {/* The wireframe library. One button, because the rail is already as
            tall as a laptop window can hold — see `WireframeMenu`. */}
        <WireframeMenu open={wirePickerOpen} onOpenChange={onWirePickerOpenChange} />

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

        <div className="rail-divider my-1 h-px bg-white/10" />

        {/* The pen, the highlighter and the eraser. Each stays held after a
            stroke — you draw several — and Escape (or the select tool) is the
            way back. */}
        <PenMenu />

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
