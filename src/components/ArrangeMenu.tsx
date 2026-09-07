import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  BringToFront,
  ChevronDown,
  ChevronUp,
  Group,
  Lock,
  MoveHorizontal,
  MoveVertical,
  Scaling,
  SendToBack,
  Ungroup,
  Unlock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useDiagramStore } from '../store/useDiagramStore';
import { Tooltip } from './Tooltip';
import type { AlignMode, DistributeAxis, MatchDimension } from '../lib/arrange';

const BUTTON_CLASS =
  'flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30';

const ALIGN_BUTTONS: [AlignMode, LucideIcon, string][] = [
  ['left', AlignStartVertical, 'Align left'],
  ['centerX', AlignCenterVertical, 'Align horizontal centres'],
  ['right', AlignEndVertical, 'Align right'],
  ['top', AlignStartHorizontal, 'Align top'],
  ['centerY', AlignCenterHorizontal, 'Align vertical centres'],
  ['bottom', AlignEndHorizontal, 'Align bottom'],
];

const DISTRIBUTE_BUTTONS: [DistributeAxis, LucideIcon, string][] = [
  ['x', AlignHorizontalDistributeCenter, 'Distribute horizontally'],
  ['y', AlignVerticalDistributeCenter, 'Distribute vertically'],
];

const MATCH_BUTTONS: [MatchDimension, LucideIcon, string][] = [
  ['width', MoveHorizontal, 'Match width'],
  ['height', MoveVertical, 'Match height'],
  ['both', Scaling, 'Match width and height'],
];

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-white/35">{title}</span>
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  );
}

/**
 * Everything that moves the selection without changing how it is drawn — z
 * order, grouping and the lock, plus align / distribute / match size — folded
 * into one popover so the selection toolbar keeps its size.
 *
 * Ordering and locking apply to a single shape, so those two rows are always
 * there; the geometry rows need something to line a shape up *against* and are
 * dropped below two selected nodes. Distribute needs a middle node to move, so
 * its two buttons are disabled — rather than hidden — below three; the row
 * jumping in and out as the selection grows would be worse than a greyed-out
 * button.
 */
export function ArrangeMenu({
  selectedCount,
  canGroup,
  hasGroup,
  locked,
}: {
  selectedCount: number;
  /** Whether the selection is one `groupSelected` would actually make a group of. */
  canGroup: boolean;
  /** Whether the selection holds a group to break apart. */
  hasGroup: boolean;
  /** Whether the shape the button would unlock is already locked. */
  locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const alignSelected = useDiagramStore((s) => s.alignSelected);
  const distributeSelected = useDiagramStore((s) => s.distributeSelected);
  const matchSizeSelected = useDiagramStore((s) => s.matchSizeSelected);
  const bringToFront = useDiagramStore((s) => s.bringToFront);
  const sendToBack = useDiagramStore((s) => s.sendToBack);
  const bringForward = useDiagramStore((s) => s.bringForward);
  const sendBackward = useDiagramStore((s) => s.sendBackward);
  const groupSelected = useDiagramStore((s) => s.groupSelected);
  const ungroupSelected = useDiagramStore((s) => s.ungroupSelected);
  const toggleLock = useDiagramStore((s) => s.toggleLock);
  const canArrange = selectedCount > 1;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip label="Arrange" side="top">
        <Popover.Trigger asChild>
          <button
            aria-label="Arrange"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white data-[state=open]:bg-white/10 data-[state=open]:text-white"
          >
            <AlignStartVertical size={16} />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          sideOffset={10}
          className="panel-in z-50 flex flex-col gap-2.5 rounded-xl bg-ink-950 p-2 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)]"
        >
          <Row title="Order">
            <Tooltip label="Bring forward" side="bottom">
              <button aria-label="Bring forward" onClick={bringForward} className={BUTTON_CLASS}>
                <ChevronUp size={16} />
              </button>
            </Tooltip>
            <Tooltip label="Send backward" side="bottom">
              <button aria-label="Send backward" onClick={sendBackward} className={BUTTON_CLASS}>
                <ChevronDown size={16} />
              </button>
            </Tooltip>
            <Tooltip label="Bring to front" side="bottom">
              <button aria-label="Bring to front" onClick={bringToFront} className={BUTTON_CLASS}>
                <BringToFront size={16} />
              </button>
            </Tooltip>
            <Tooltip label="Send to back" side="bottom">
              <button aria-label="Send to back" onClick={sendToBack} className={BUTTON_CLASS}>
                <SendToBack size={16} />
              </button>
            </Tooltip>
          </Row>
          <Row title="Group">
            <Tooltip label="Group" shortcut="⌘G" side="bottom">
              <button
                aria-label="Group"
                onClick={groupSelected}
                disabled={!canGroup}
                className={BUTTON_CLASS}
              >
                <Group size={16} />
              </button>
            </Tooltip>
            <Tooltip label="Ungroup" shortcut="⌘⇧G" side="bottom">
              <button
                aria-label="Ungroup"
                onClick={ungroupSelected}
                disabled={!hasGroup}
                className={BUTTON_CLASS}
              >
                <Ungroup size={16} />
              </button>
            </Tooltip>
            <Tooltip label={locked ? 'Unlock' : 'Lock'} shortcut="⌘⇧L" side="bottom">
              <button aria-label={locked ? 'Unlock' : 'Lock'} onClick={toggleLock} className={BUTTON_CLASS}>
                {locked ? <Unlock size={16} /> : <Lock size={16} />}
              </button>
            </Tooltip>
          </Row>
          {canArrange && (
            <>
              <Row title="Align">
                {ALIGN_BUTTONS.map(([mode, Icon, label]) => (
                  <Tooltip key={mode} label={label} side="bottom">
                    <button onClick={() => alignSelected(mode)} className={BUTTON_CLASS}>
                      <Icon size={16} />
                    </button>
                  </Tooltip>
                ))}
              </Row>
              <Row title="Distribute">
                {DISTRIBUTE_BUTTONS.map(([axis, Icon, label]) => (
                  <Tooltip key={axis} label={label} side="bottom">
                    <button
                      onClick={() => distributeSelected(axis)}
                      disabled={selectedCount < 3}
                      className={BUTTON_CLASS}
                    >
                      <Icon size={16} />
                    </button>
                  </Tooltip>
                ))}
              </Row>
              <Row title="Match size">
                {MATCH_BUTTONS.map(([dim, Icon, label]) => (
                  <Tooltip key={dim} label={label} side="bottom">
                    <button onClick={() => matchSizeSelected(dim)} className={BUTTON_CLASS}>
                      <Icon size={16} />
                    </button>
                  </Tooltip>
                ))}
              </Row>
            </>
          )}
          <Popover.Arrow className="fill-ink-950" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
