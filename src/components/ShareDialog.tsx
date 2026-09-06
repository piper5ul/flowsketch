/**
 * Who can see this diagram, and what they can do with it.
 *
 * Two independent grants sit side by side here, because they answer the same
 * question from opposite ends: the **public link** hands read access to anyone
 * holding a URL, and **members** hand named access to accounts that already
 * exist. Neither implies the other — revoking the link leaves the members, and
 * removing a member leaves the link.
 *
 * The owner is the only one who may change any of it (`server/access.ts` makes
 * every sharing route owner-only). An editor is still shown the members list —
 * they can already see the board, and a share dialog that hides who else is on
 * it is worse than one that names them — so they get this dialog read-only,
 * with no link section and no controls.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, X } from 'lucide-react';
import { api } from '../lib/api';
import { useDiagramStore } from '../store/useDiagramStore';
import { toastError } from '../store/useToastStore';
import { sharedDiagramPath, type DiagramMemberInfo, type DiagramMemberRole } from '../../shared/types';

/** How long the copy button stays on "Copied" before going back. */
const COPIED_MS = 2000;

/** The roles an invitation can grant, in the order the selects offer them. */
const MEMBER_ROLES: { value: DiagramMemberRole; label: string }[] = [
  { value: 'viewer', label: 'Can view' },
  { value: 'editor', label: 'Can edit' },
];

/** The absolute URL a share token is read at — what the user actually pastes. */
function shareUrl(token: string): string {
  return `${window.location.origin}${sharedDiagramPath(token)}`;
}

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const diagramId = useDiagramStore((s) => s.diagramId);
  const role = useDiagramStore((s) => s.role);
  const shareToken = useDiagramStore((s) => s.shareToken);
  const setShareToken = useDiagramStore((s) => s.setShareToken);
  const isOwner = role === 'owner';

  const [members, setMembers] = useState<DiagramMemberInfo[] | null>(null);
  /** Set while a request that would change something is in flight. */
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!diagramId) return;
    let cancelled = false;
    api
      .listMembers(diagramId)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (cancelled) return;
        setMembers([]);
        toastError('Could not load who this diagram is shared with.');
      });
    return () => {
      cancelled = true;
    };
  }, [diagramId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // Captured, so Escape closes the dialog without also reaching the canvas
      // behind it and clearing the selection.
      event.stopPropagation();
      event.preventDefault();
      onClose();
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const togglePublicLink = useCallback(
    async (on: boolean) => {
      if (!diagramId) return;
      setBusy(true);
      try {
        if (on) {
          // Idempotent on the server: a second call hands back the same token
          // rather than invalidating a URL the user has already pasted.
          const { shareToken: token } = await api.shareDiagram(diagramId);
          setShareToken(token);
        } else {
          await api.unshareDiagram(diagramId);
          setShareToken(null);
        }
      } catch {
        toastError(on ? 'Could not create the public link.' : 'Could not turn the public link off.');
      } finally {
        setBusy(false);
      }
    },
    [diagramId, setShareToken],
  );

  const changeRole = useCallback(
    async (member: DiagramMemberInfo, next: DiagramMemberRole) => {
      if (!diagramId) return;
      setBusy(true);
      try {
        // The same route as an invitation: `POST members` upserts, so changing
        // a role and granting one are one call, not two.
        const updated = await api.addMember(diagramId, member.email, next);
        setMembers((prev) =>
          (prev ?? []).map((m) => (m.userId === updated.userId ? updated : m)),
        );
      } catch {
        toastError(`Could not change ${member.name}'s access.`);
      } finally {
        setBusy(false);
      }
    },
    [diagramId],
  );

  const removeMember = useCallback(
    async (member: DiagramMemberInfo) => {
      if (!diagramId) return;
      setBusy(true);
      try {
        await api.removeMember(diagramId, member.userId);
        setMembers((prev) => (prev ?? []).filter((m) => m.userId !== member.userId));
      } catch {
        toastError(`Could not remove ${member.name}.`);
      } finally {
        setBusy(false);
      }
    },
    [diagramId],
  );

  const addMember = useCallback(
    async (email: string, memberRole: DiagramMemberRole) => {
      if (!diagramId) return { ok: false, error: 'No diagram open.' };
      setBusy(true);
      try {
        const member = await api.addMember(diagramId, email, memberRole);
        setMembers((prev) => {
          const rest = (prev ?? []).filter((m) => m.userId !== member.userId);
          return [...rest, member];
        });
        return { ok: true as const };
      } catch (err) {
        // The one failure worth spelling out in place: the address is fine, it
        // simply has no account behind it, and there is no invite-by-email flow
        // to fall back on yet.
        const notFound = err instanceof Error && err.message.includes('404');
        return {
          ok: false as const,
          error: notFound ? 'No account with that email' : 'Could not send the invitation.',
        };
      } finally {
        setBusy(false);
      }
    },
    [diagramId],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/20 p-6 pt-24 backdrop-blur-[2px]"
      onPointerDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Share"
        className="panel-in flex w-full max-w-lg flex-col gap-5 rounded-2xl bg-white p-5 shadow-[0_24px_60px_-12px_rgba(10,10,25,0.45)] ring-1 ring-black/[0.06]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink-950">Share</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share dialog"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-700/50 transition hover:bg-black/[0.04] hover:text-ink-700"
          >
            <X size={15} />
          </button>
        </div>

        {isOwner && (
          <PublicLinkSection token={shareToken} busy={busy} onToggle={togglePublicLink} />
        )}

        <MemberList
          members={members}
          canManage={isOwner}
          busy={busy}
          onChangeRole={changeRole}
          onRemove={removeMember}
        />

        {isOwner && <InviteForm busy={busy} onInvite={addMember} />}
      </div>
    </div>
  );
}

function PublicLinkSection({
  token,
  busy,
  onToggle,
}: {
  token: string | null;
  busy: boolean;
  onToggle: (on: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(async () => {
    const input = inputRef.current;
    if (!input) return;
    // Selected first, and left selected: the clipboard API is refused on an
    // insecure origin and can be denied outright, and a selected field is a
    // ⌘C away from the same result.
    input.select();
    try {
      await navigator.clipboard.writeText(input.value);
      setCopied(true);
    } catch {
      // Nothing to say — the link is on screen and selected.
    }
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <label className="flex items-center gap-2.5 text-[13px] font-medium text-ink-900">
        <input
          type="checkbox"
          checked={!!token}
          disabled={busy}
          onChange={(event) => onToggle(event.target.checked)}
          className="h-4 w-4 accent-accent-500"
        />
        Anyone with the link can view
      </label>

      {token && (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            readOnly
            value={shareUrl(token)}
            aria-label="Public link"
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-0 flex-1 rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-[13px] text-ink-700 ring-1 ring-black/[0.05] outline-none"
          />
          <button
            type="button"
            onClick={copy}
            aria-label="Copy link"
            className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-2.5 py-1.5 text-[13px] font-semibold text-white transition hover:bg-accent-600"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => onToggle(false)}
            disabled={busy}
            className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-ink-600 transition hover:bg-black/[0.04] hover:text-ink-900 disabled:opacity-60"
          >
            Turn off
          </button>
        </div>
      )}
    </section>
  );
}

function MemberList({
  members,
  canManage,
  busy,
  onChangeRole,
  onRemove,
}: {
  members: DiagramMemberInfo[] | null;
  canManage: boolean;
  busy: boolean;
  onChangeRole: (member: DiagramMemberInfo, role: DiagramMemberRole) => void;
  onRemove: (member: DiagramMemberInfo) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold text-ink-900">People with access</h3>
      {members === null ? (
        <p className="flex items-center gap-2 py-2 text-[13px] text-ink-600">
          <Loader2 size={13} className="animate-spin" /> Loading…
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center gap-2 py-1">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink-900">{member.name}</p>
                <p className="truncate text-[12px] text-ink-600/70">{member.email}</p>
              </div>
              {/* The owner's row is a statement of fact: ownership is not
                  transferable, and they cannot be removed from their own
                  diagram, so it carries no controls at all. */}
              {member.role === 'owner' ? (
                <span className="text-[12px] font-medium text-ink-600">Owner</span>
              ) : canManage ? (
                <>
                  <select
                    value={member.role}
                    disabled={busy}
                    aria-label={`Role for ${member.email}`}
                    onChange={(event) => onChangeRole(member, event.target.value as DiagramMemberRole)}
                    className="rounded-lg bg-white px-2 py-1 text-[12px] text-ink-900 ring-1 ring-black/[0.08] outline-none focus:ring-accent-500/40"
                  >
                    {MEMBER_ROLES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onRemove(member)}
                    disabled={busy}
                    aria-label={`Remove ${member.email}`}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-700/50 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
                  >
                    <X size={14} />
                  </button>
                </>
              ) : (
                <span className="text-[12px] font-medium text-ink-600">
                  {member.role === 'editor' ? 'Can edit' : 'Can view'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InviteForm({
  busy,
  onInvite,
}: {
  busy: boolean;
  onInvite: (email: string, role: DiagramMemberRole) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<DiagramMemberRole>('viewer');
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const address = email.trim();
      if (address === '') return;
      setError(null);
      const result = await onInvite(address, role);
      if (result.ok) setEmail('');
      else setError(result.error ?? 'Could not send the invitation.');
    },
    [email, role, onInvite],
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-black/[0.06] pt-4">
      <h3 className="text-[13px] font-semibold text-ink-900">Invite by email</h3>
      <div className="flex items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
          aria-label="Invite by email"
          placeholder="name@example.com"
          className="min-w-0 flex-1 rounded-lg bg-white px-2.5 py-1.5 text-[13px] text-ink-900 ring-1 ring-black/[0.08] outline-none placeholder:text-ink-600/40 focus:ring-accent-500/40"
        />
        <select
          value={role}
          aria-label="Invite as"
          onChange={(event) => setRole(event.target.value as DiagramMemberRole)}
          className="rounded-lg bg-white px-2 py-1.5 text-[12px] text-ink-900 ring-1 ring-black/[0.08] outline-none focus:ring-accent-500/40"
        >
          {MEMBER_ROLES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || email.trim() === ''}
          className="rounded-lg bg-accent-500 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:bg-accent-600 disabled:opacity-50"
        >
          Invite
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[12px] font-medium text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
