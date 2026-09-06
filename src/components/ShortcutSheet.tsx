import { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { GROUP_LABELS, detectPlatform, registry, shortcutLabels } from '../commands/commands';

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const platform = useMemo(detectPlatform, []);

  // Captured on the window so Escape closes the sheet without also reaching
  // the canvas, which would clear the selection behind it.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      onClose();
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const sections = useMemo(
    () =>
      GROUP_LABELS.map(({ group, label }) => ({
        label,
        commands: registry.all().filter((command) => command.group === group && !command.hidden && command.shortcut),
      })).filter((section) => section.commands.length > 0),
    [],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/40 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="panel-in flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_30px_80px_-20px_rgba(10,10,25,0.5)]"
      >
        <div className="flex items-center justify-between border-b border-black/[0.06] px-6 py-4">
          <h2 className="text-[15px] font-semibold text-ink-900">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-600 transition hover:bg-black/[0.04]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-x-10 gap-y-6 overflow-y-auto px-6 py-5 sm:grid-cols-2">
          {sections.map((section) => (
            <section key={section.label}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-600/70">
                {section.label}
              </h3>
              <ul className="flex flex-col gap-1">
                {section.commands.map((command) => (
                  <li key={command.id} className="flex items-baseline justify-between gap-4">
                    <span className="text-[13px] text-ink-800">{command.title}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {shortcutLabels(command.shortcut, platform).map((label, index) => (
                        <kbd
                          key={`${command.id}-${index}`}
                          className="rounded bg-black/[0.05] px-1.5 py-0.5 font-sans text-[11px] font-semibold text-ink-700"
                        >
                          {label}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
