/**
 * The sound the board timer makes when it runs out.
 *
 * **Generated, not a file.** Two sine notes through the Web Audio API is a
 * couple of dozen lines and no asset at all — where an mp3 would be a request,
 * a cache entry, a licence and a second thing to keep in step with the build.
 * It is also the only sound this app makes, so there is nothing for a shared
 * audio pipeline to be shared with.
 *
 * Split the way every other lib here is: `chimeNotes` is the pure description of
 * what is played and is what the tests assert on, and `playChime` is the thin
 * wrapper that actually touches an `AudioContext` — passed in, so a caller (a
 * test) can hand it something else.
 *
 * **Nothing here decides whether to play.** That is `canPlayChime` plus the
 * `timerSound` preference, both read by `TimerButton`: a browser refuses audio
 * on a page nobody has interacted with, and a chime somebody has muted must not
 * sound on the share page either.
 */

/** One note of the chime, in seconds from the start of it. */
export interface ChimeNote {
  /** Hz. */
  frequency: number;
  /** When it starts, relative to the chime. */
  startsAt: number;
  /** How long it sounds for. */
  duration: number;
  /** Its loudest point, 0–1. Deliberately quiet: this interrupts a meeting. */
  peak: number;
}

/**
 * The two notes: A5, then E6 a beat later — a rising fifth, which reads as
 * "finished" rather than as an alarm. The second overlaps the first's tail, so
 * the whole thing is one gesture and not two beeps.
 */
export function chimeNotes(): ChimeNote[] {
  return [
    { frequency: 880, startsAt: 0, duration: 0.18, peak: 0.16 },
    { frequency: 1318.51, startsAt: 0.12, duration: 0.18, peak: 0.14 },
  ];
}

/** How long the whole chime lasts, in seconds — the last note's end. */
export const CHIME_DURATION_S = chimeNotes().reduce(
  (end, note) => Math.max(end, note.startsAt + note.duration),
  0,
);

/** What `playChime` needs of the browser. `window.AudioContext`, in practice. */
export type AudioContextCtor = new () => AudioContext;

/**
 * Whether this page may make a sound at all.
 *
 * Every browser refuses audio on a page the user has never touched, and the
 * refusal is a rejected promise or a silently suspended context rather than
 * anything worth showing somebody. `userActivation` is the one place that
 * answers the question directly; where it is not implemented the answer is
 * "try", because a page with a timer running on it has almost certainly been
 * clicked.
 */
export function canPlayChime(nav: Navigator | undefined = globalThis.navigator): boolean {
  return nav?.userActivation?.hasBeenActive !== false;
}

/**
 * Play the chime once. Best-effort in every direction: a browser that refuses
 * the context, a suspended one, a `close()` that rejects — none of that is
 * worth a toast, let alone an exception reaching a render.
 *
 * The context is created per chime and closed after it, rather than kept: this
 * fires at most once a countdown, and an `AudioContext` held open for the life
 * of the page is a resource a diagram tool has no other use for.
 */
export function playChime(ctor: AudioContextCtor | undefined = globalThis.AudioContext): void {
  if (!ctor) return;
  try {
    const ctx = new ctor();
    const start = ctx.currentTime;
    for (const note of chimeNotes()) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = note.frequency;
      // Ramped rather than switched on: a square edge on a sine is a click.
      const at = start + note.startsAt;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(note.peak, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + note.duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + note.duration);
    }
    // Long enough after the last note that nothing is cut off.
    setTimeout(() => void ctx.close().catch(() => {}), (CHIME_DURATION_S + 0.2) * 1000);
  } catch {
    // No audio on this page. The label still says "Time's up" and the control
    // still flashes, which is what the sound was decorating.
  }
}
