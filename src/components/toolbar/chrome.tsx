import { forwardRef, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
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

/** Shared chrome button with one accessible name and consistent toolbar state. */
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

export function Separator() {
  return <span aria-hidden="true" className="chrome-sep" />;
}

export function Segmented({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={clsx('chrome-track', className)}>
      {children}
    </div>
  );
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
  const editorRef = useRef<HTMLElement | null>(null);
  const selectionRef = useRef<Range | null>(null);

  return (
    <Popover.Portal>
      <Popover.Content
        aria-label={label}
        side={side}
        sideOffset={sideOffset}
        align="center"
        tabIndex={-1}
        style={width === undefined ? undefined : { width }}
        className="chrome-pop z-50"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (keepEditorFocus) {
            const active = document.activeElement;
            editorRef.current = active instanceof HTMLElement && active.isContentEditable ? active : null;
            const selection = window.getSelection();
            selectionRef.current = editorRef.current && selection?.rangeCount
              ? selection.getRangeAt(0).cloneRange()
              : null;
          } else {
            const content = event.currentTarget as HTMLElement;
            const activeGroupButton = content.querySelector<HTMLElement>(
              '[role="group"] button[tabindex="0"], [role="group"] button[aria-pressed="true"]',
            );
            const firstFocusable = content.querySelector<HTMLElement>(
              'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
            );
            (activeGroupButton ?? firstFocusable ?? content).focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          if (keepEditorFocus) {
            event.preventDefault();
            const editor = editorRef.current;
            if (editor?.isConnected) {
              editor.focus();
              const range = selectionRef.current;
              if (range && editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
              }
            }
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') event.stopPropagation();
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
