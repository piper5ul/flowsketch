import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Square, Timer, Volume2, VolumeX } from 'lucide-react';
import { useDiagramStore } from '../store/useDiagramStore';
import { useViewPreferences } from '../store/useViewPreferences';
import { canPlayChime, playChime } from '../lib/chime';
import {
  MAX_TIMER_SECONDS,
  TIMER_PRESET_MINUTES,
  formatRemaining,
  remainingSeconds,
  timerState,
} from '../lib/timer';

/** How long the control pulses when the countdown runs out. Matches `.timer-flash`. */
const FLASH_MS = 1500;

/**
 * The TopBar's Timer control — Whimsical's board timer.
 *
 * **The countdown is computed here, not stored.** `DiagramData.timer` holds the
 * instant it runs out and nothing else, so every window subtracts its own clock
 * once a second and nothing ticks through the shared document (see
 * `src/lib/timer.ts`). The interval below is therefore the *only* thing running
 * per second, in one component, and it stops as soon as there is no timer.
 *
 * A viewer and the public `/s/:token` page get the readout and not the
 * controls: watching the clock is looking, starting one is an edit. Stopping a
 * running timer is offered to anybody who can edit, whoever started it — a
 * facilitator who has left the board should not be able to leave a countdown
 * nobody can take down.
 *
 * **Reaching zero flashes, says "Time's up" and chimes**, and the chime is the
 * one of the three that is not about the board: it is generated here
 * (`src/lib/chime.ts`), plays only on the transition seen *in this window*, and
 * is switched off per browser through `useViewPreferences.timerSound` — the
 * speaker in the panel. Everyone watching hears it, viewers and the public page
 * included, because a countdown running out is the moment it exists for.
 */
export function TimerButton() {
  const timer = useDiagramStore((s) => s.timer);
  const readOnly = useDiagramStore((s) => s.readOnly);
  const viewerId = useDiagramStore((s) => s.viewerId);
  const canControl = !readOnly && viewerId !== null;

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const now = useTick(timer !== null);
  const state = timerState(timer, now);
  const flashing = useEndFlash(state);
  useEndChime(state);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const start = useCallback((seconds: number) => {
    setOpen(false);
    useDiagramStore.getState().startTimer(seconds);
  }, []);

  // Nothing to show and nothing this reader could start.
  if (!canControl && state === 'none') return null;

  const label =
    state === 'done'
      ? "Time's up"
      : state === 'running' && timer
        ? formatRemaining(remainingSeconds(timer.endsAt, now))
        : 'Timer';

  return (
    <div ref={ref} className="pointer-events-auto relative">
      <div
        // What the timer is doing, for the tests — the countdown itself is a
        // number that changes every second and is a poor thing to assert on
        // directly, the way `data-collab-sync` stands in for "synced".
        data-timer-state={state}
        className={clsx(
          'flex items-center gap-0.5 rounded-2xl bg-panel/95 px-2 py-1.5 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-line-subtle backdrop-blur',
          flashing && 'timer-flash',
        )}
      >
        <button
          type="button"
          onClick={() => (canControl ? setOpen((v) => !v) : undefined)}
          disabled={!canControl}
          aria-expanded={canControl ? open : undefined}
          className={clsx(
            'flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium tabular-nums',
            state === 'done' ? 'text-warn-ink' : 'text-ink-700',
            canControl && 'hover:bg-hover',
          )}
        >
          <Timer size={15} /> {label}
        </button>
        {/* The one thing worth announcing. A live region carrying the countdown
            would read a new number out loud every second, which is worse than
            not reading it at all; reaching zero is the moment that matters. */}
        <span role="status" className="sr-only">
          {state === 'done' ? "Time's up" : ''}
        </span>
        {/* Stopping is the one control a running timer offers outside the
            panel: it is the thing somebody reaches for in a hurry. */}
        {canControl && state !== 'none' && (
          <button
            type="button"
            aria-label="Stop timer"
            onClick={() => useDiagramStore.getState().stopTimer()}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-ink-700/60 hover:bg-hover hover:text-ink-700"
          >
            <Square size={12} />
          </button>
        )}
      </div>
      {open && canControl && <TimerPanel onStart={start} />}
    </div>
  );
}

/** The presets, and a field for a length that is not one of them. */
function TimerPanel({ onStart }: { onStart: (seconds: number) => void }) {
  const [minutes, setMinutes] = useState('');
  const custom = Number(minutes);
  const customValid = Number.isFinite(custom) && custom >= 1 && custom * 60 <= MAX_TIMER_SECONDS;

  return (
    <div
      role="dialog"
      aria-label="Timer"
      className="panel-in absolute right-0 top-full mt-2 flex w-56 flex-col gap-0.5 rounded-xl bg-ink-950 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)]"
    >
      <div className="flex items-center justify-between gap-2 px-2.5 pb-1 pt-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
          Start a timer
        </span>
        {/* Per browser, not per board — see `useViewPreferences.timerSound`.
            It sits here because the panel is the one place the timer is
            configured, and it is a mute switch rather than a menu item. */}
        <SoundToggle />
      </div>
      {TIMER_PRESET_MINUTES.map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => onStart(preset * 60)}
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10"
        >
          <Timer size={15} /> {preset} minute{preset === 1 ? '' : 's'}
        </button>
      ))}
      <div className="mx-1 my-0.5 h-px bg-white/10" />
      <form
        className="flex items-center gap-1.5 px-2.5 py-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (customValid) onStart(Math.floor(custom * 60));
        }}
      >
        <input
          type="number"
          min={1}
          max={MAX_TIMER_SECONDS / 60}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          placeholder="15"
          aria-label="Minutes"
          className="w-16 rounded-md bg-white/10 px-2 py-0.5 text-[13px] text-white outline-none placeholder:text-white/30 focus:ring-1 focus:ring-accent-500"
        />
        <span className="text-[12px] text-white/40">min</span>
        <button
          type="submit"
          disabled={!customValid}
          className="ml-auto rounded-md bg-accent-500 px-2 py-0.5 text-[12px] font-semibold text-white transition hover:bg-accent-600 disabled:opacity-30"
        >
          Start
        </button>
      </form>
    </div>
  );
}

/** Mute or unmute the chime for this browser. Nothing about it reaches the board. */
function SoundToggle() {
  const timerSound = useViewPreferences((s) => s.timerSound);
  const toggle = useViewPreferences((s) => s.toggleTimerSound);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={timerSound}
      aria-label={timerSound ? 'Mute the timer chime' : 'Unmute the timer chime'}
      title={timerSound ? 'Chime when the timer ends' : 'Timer chime is off'}
      className="flex h-6 w-6 items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white/85"
    >
      {timerSound ? <Volume2 size={14} /> : <VolumeX size={14} />}
    </button>
  );
}

/**
 * `Date.now()`, re-read once a second while `running`.
 *
 * The clock is the component's, not the diagram's: a timer is an end time, so
 * this is the only thing in the app that has to run on an interval, and it runs
 * in exactly one place. It stops dead when there is no timer, so a board with
 * none costs nothing.
 */
function useTick(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return now;
}

/**
 * True for a moment and a half after the countdown reaches zero.
 *
 * Watches the *transition* rather than the state, so re-opening a board whose
 * timer ran out an hour ago does not flash at somebody who was not there — the
 * label still says "Time's up", which is the part that has to survive.
 */
/**
 * Sound the chime once, on the same transition the flash watches.
 *
 * The transition and not the state, for the same reason: opening a board whose
 * timer ran out an hour ago must not make a noise at somebody who was not there
 * when it did. Three things have to be true before anything is played — the
 * countdown reached zero *in this window*, the person at this browser has not
 * muted it, and the page has been interacted with, or the browser would refuse
 * the audio anyway (`canPlayChime`).
 *
 * The preference is read through `getState()` rather than subscribed to: this
 * is a decision made at one instant, and a component that re-rendered every
 * time somebody toggled the speaker would be watching for nothing.
 */
function useEndChime(state: ReturnType<typeof timerState>): void {
  const previous = useRef(state);

  useEffect(() => {
    const was = previous.current;
    previous.current = state;
    if (was !== 'running' || state !== 'done') return;
    if (!useViewPreferences.getState().timerSound) return;
    if (!canPlayChime()) return;
    playChime();
  }, [state]);
}

function useEndFlash(state: ReturnType<typeof timerState>): boolean {
  const [flashing, setFlashing] = useState(false);
  const previous = useRef(state);

  useEffect(() => {
    const was = previous.current;
    previous.current = state;
    if (was !== 'running' || state !== 'done') return;
    setFlashing(true);
    const id = setTimeout(() => setFlashing(false), FLASH_MS);
    return () => clearTimeout(id);
  }, [state]);

  return flashing;
}
