import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import clsx from 'clsx';
import { Tooltip } from '../Tooltip';
import { suppressNextBlurCommit } from '../../store/useDiagramStore';

interface ToolButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'popover'> {
  label: string;
  shortcut?: string;
  active?: boolean;
  popover?: boolean;
  children: ReactNode;
}

export const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton(
  { label, shortcut, active, popover, className, children, type = 'button', ...buttonProps },
  ref,
) {
  return (
    <Tooltip label={label} shortcut={shortcut} side="top">
      <button
        {...buttonProps}
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        data-popover={popover ? '' : undefined}
        data-active={active ? '' : undefined}
        className={clsx('chrome-btn', className)}
      >
        {children}
      </button>
    </Tooltip>
  );
});

interface ChromePopoverProps {
  label: string;
  side?: 'top' | 'bottom';
  sideOffset?: number;
  keepEditorFocus?: boolean;
  width?: number;
  children: ReactNode;
}

/** The measured dark popover shell shared by toolbar pickers and controls. */
export function ChromePopover({
  label,
  side = 'top',
  sideOffset = 9,
  keepEditorFocus = false,
  width,
  children,
}: ChromePopoverProps) {
  return (
    <Popover.Portal>
      <Popover.Content
        aria-label={label}
        side={side}
        sideOffset={sideOffset}
        align="center"
        style={width === undefined ? undefined : { width }}
        className="chrome-pop z-50"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (!keepEditorFocus) {
            const content = event.currentTarget as HTMLElement;
            content.querySelector<HTMLButtonElement>('[role="group"] button[tabindex="0"]')?.focus();
          }
        }}
        onMouseDown={
          keepEditorFocus
            ? (event) => {
                event.preventDefault();
                suppressNextBlurCommit();
              }
            : undefined
        }
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        {children}
        <Popover.Arrow width={12} height={6} className="fill-[var(--color-chrome)]" />
      </Popover.Content>
    </Popover.Portal>
  );
}
