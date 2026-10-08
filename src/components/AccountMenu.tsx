import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { LogOut } from 'lucide-react';
import { signOut, useSession } from '../lib/authClient';
import { initialsOf } from '../lib/collab/presence';
import { toastError } from '../store/useToastStore';
import { ThemeSwitch } from './ThemeSwitch';

/** Account details and app-wide appearance preferences. */
export function AccountMenu({ beforeSignOut }: { beforeSignOut?: () => Promise<boolean> }) {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const name = session?.user?.name || session?.user?.email || 'Account';
  const email = session?.user?.email || '';

  const handleSignOut = async () => {
    if (beforeSignOut) {
      let flushed = false;
      try {
        flushed = await beforeSignOut();
      } catch {
        flushed = false;
      }
      if (!flushed) {
        toastError('Pending changes could not be saved. Try signing out again.');
        return;
      }
    }
    await signOut();
    navigate('/login');
  };

  return (
    <div className="pointer-events-auto">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label="Account"
            aria-haspopup="dialog"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-500 text-[10px] font-semibold text-white transition hover:bg-accent-600"
          >
            {initialsOf(name)}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            sideOffset={8}
            align="end"
            aria-label="Account"
            className="panel-in z-50 w-60 rounded-xl bg-panel p-2 text-ink-900 shadow-lg ring-1 ring-line"
          >
            <div className="px-2 py-1.5">
              <div className="truncate text-[13px] font-semibold text-ink-900">{name}</div>
              {email && <div className="truncate text-[12px] text-ink-600">{email}</div>}
            </div>
            <div className="my-1.5 border-t border-line" />
            <div className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase text-ink-600">Appearance</div>
            <ThemeSwitch />
            <div className="my-1.5 border-t border-line" />
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium text-ink-700 transition hover:bg-hover hover:text-ink-900"
            >
              <LogOut size={15} aria-hidden="true" />
              Sign out
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
