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
  MoveHorizontal,
  MoveVertical,
  Scaling,
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
 * The arrange commands, folded into one popover so the selection toolbar keeps
 * its size. Distribute needs a middle node to move, so its two buttons are
 * disabled — rather than hidden — below three selected nodes; the row jumping
 * in and out as the selection grows would be worse than a greyed-out button.
 */
export function ArrangeMenu({ selectedCount }: { selectedCount: number }) {
  const [open, setOpen] = useState(false);
  const alignSelected = useDiagramStore((s) => s.alignSelected);
  const distributeSelected = useDiagramStore((s) => s.distributeSelected);
  const matchSizeSelected = useDiagramStore((s) => s.matchSizeSelected);

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
          <Popover.Arrow className="fill-ink-950" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
