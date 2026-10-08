import { useRef } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useViewPreferences } from '../store/useViewPreferences';
import type { ThemePreference } from '../lib/theme';

const OPTIONS: { theme: ThemePreference; label: string; Icon: typeof Monitor }[] = [
  { theme: 'system', label: 'System', Icon: Monitor },
  { theme: 'light', label: 'Light', Icon: Sun },
  { theme: 'dark', label: 'Dark', Icon: Moon },
];

/** A labelled, keyboard-operable choice for the app's three theme preferences. */
export function ThemeSwitch() {
  const theme = useViewPreferences((state) => state.theme);
  const setTheme = useViewPreferences((state) => state.setTheme);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = (index + direction + OPTIONS.length) % OPTIONS.length;
    const nextTheme = OPTIONS[nextIndex].theme;
    setTheme(nextTheme);
    buttons.current[nextIndex]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-lg bg-field p-0.5">
      {OPTIONS.map(({ theme: option, label, Icon }, index) => {
        const checked = theme === option;
        return (
          <button
            key={option}
            ref={(element) => { buttons.current[index] = element; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => setTheme(option)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(index, -1);
              } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                move(index, 1);
              }
            }}
            className={`flex h-7 flex-1 items-center justify-center gap-1 rounded-md text-[12px] font-medium ${
              checked ? 'bg-panel text-ink-900 shadow-sm' : 'text-ink-600'
            }`}
          >
            <Icon size={14} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
