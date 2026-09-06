import { X } from 'lucide-react';
import clsx from 'clsx';
import { useToastStore } from '../store/useToastStore';

/**
 * Bottom-centre stack of transient messages, over the canvas and the
 * dashboard alike. Styled like the left rail so it reads as part of the app
 * chrome rather than a browser dialog.
 */
export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="panel-in pointer-events-auto flex max-w-[min(28rem,calc(100vw-2rem))] items-start gap-3 rounded-xl bg-ink-950/95 py-2.5 pl-3.5 pr-2 text-[13px] font-medium text-white/90 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)] backdrop-blur"
        >
          <span
            aria-hidden="true"
            className={clsx(
              'mt-[5px] h-2 w-2 shrink-0 rounded-full',
              toast.kind === 'error' ? 'bg-red-400' : 'bg-accent-400',
            )}
          />
          <span className="min-w-0 flex-1 leading-snug">{toast.message}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => dismiss(toast.id)}
            className="-mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
