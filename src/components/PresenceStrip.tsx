/**
 * "Who's here" — an avatar per peer in the top bar, and a dot saying whether
 * this window is still in touch with them.
 *
 * The connection dot is shown even when nobody else is here, because "nobody
 * else is here" and "we lost the connection and cannot tell" look identical
 * otherwise, and only one of those means the strip can be trusted.
 */
import clsx from 'clsx';
import { Tooltip } from './Tooltip';
import { useCollabStore } from '../store/useCollabStore';
import { initialsOf, type PresenceStatus } from '../lib/collab/presence';

/** How many avatars are drawn before the rest become "+3". */
const MAX_AVATARS = 4;

const STATUS_LABEL: Record<PresenceStatus, string> = {
  connecting: 'Connecting to collaborators',
  connected: 'Live',
  disconnected: 'Not connected to collaborators',
};

// Green / amber / red, spelled out rather than themed: these three mean the
// same thing on any background, and a "connected" that changed shade with the
// theme would be one more thing to learn.
const STATUS_DOT: Record<PresenceStatus, string> = {
  connecting: 'bg-amber-500',
  connected: 'bg-green-500',
  disconnected: 'bg-red-500',
};

export function PresenceStrip() {
  const peers = useCollabStore((s) => s.peers);
  const status = useCollabStore((s) => s.status);

  const shown = peers.slice(0, MAX_AVATARS);
  const overflow = peers.length - shown.length;

  return (
    <div className="ml-1 flex items-center gap-1.5" aria-label="Collaborators">
      {shown.map((peer) => (
        <Tooltip key={peer.clientId} label={peer.name} side="bottom">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-panel"
            style={{ background: peer.color }}
            aria-label={peer.name}
          >
            {initialsOf(peer.name)}
          </span>
        </Tooltip>
      ))}
      {overflow > 0 && (
        <span
          className="flex h-6 min-w-6 items-center justify-center rounded-full bg-hover-strong px-1 text-[10px] font-bold text-ink-700"
          aria-label={`${overflow} more ${overflow === 1 ? 'collaborator' : 'collaborators'}`}
        >
          +{overflow}
        </span>
      )}
      <Tooltip label={STATUS_LABEL[status]} side="bottom">
        <span
          className={clsx('h-2 w-2 rounded-full', STATUS_DOT[status])}
          role="status"
          aria-label={STATUS_LABEL[status]}
          data-collab-status={status}
        />
      </Tooltip>
    </div>
  );
}
