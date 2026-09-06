/**
 * What the top bar says about the connection, now that it is what the top bar
 * says at all.
 *
 * Phase 3 of `docs/realtime.md`: for a diagram that lives in a shared document
 * there is no save to report. The document *is* the save — the server writes it
 * and renders `Diagram.data` from it — so "Saving… / Saved / Retrying / Save
 * failed" answers a question that no longer has an answer, and the one the user
 * actually has is whether this window is still in touch with everybody else.
 *
 * A diagram with no document behind it keeps the old indicator; see
 * `SaveIndicator` in `TopBar.tsx`.
 *
 * Pure and separate from the component for the reason `theme.ts` is: it is the
 * whole of the decision, and it is worth testing without a DOM.
 */
import type { PresenceStatus } from './presence';

/**
 * How the state reads, not which colour it is: the label and the tone travel
 * together (an amber "Live" would be a contradiction) and the classes belong to
 * the component that draws them.
 */
export type ConnectionTone = 'live' | 'reconnecting' | 'offline';

export interface ConnectionDisplay {
  label: string;
  tone: ConnectionTone;
}

/**
 * `connecting` reads as "Reconnecting…" rather than "Connecting…" because that
 * is what it nearly always is: the first attempt lasts a fraction of a second
 * on a page that has only just loaded, and every attempt after it really is a
 * reconnection. One word for one state is worth more than a distinction the
 * user sees for 200 ms.
 *
 * `disconnected` says what happens next, because the honest answer is
 * reassuring: a CRDT keeps the edits made offline and merges them on the way
 * back, so the sentence is a promise the document can actually keep.
 */
const DISPLAY: Record<PresenceStatus, ConnectionDisplay> = {
  connecting: { label: 'Reconnecting…', tone: 'reconnecting' },
  connected: { label: 'Live', tone: 'live' },
  disconnected: { label: 'Offline — changes will sync when you’re back', tone: 'offline' },
};

export function connectionDisplay(status: PresenceStatus): ConnectionDisplay {
  return DISPLAY[status];
}
