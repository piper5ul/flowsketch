/**
 * The comments side sheet: every conversation on this diagram, and the writing
 * of new ones.
 *
 * Reading *and* writing are a viewer's right here — a reviewer who cannot write
 * anything down is not reviewing — so this panel is offered to every member of
 * the diagram. What it withholds from a viewer is calling a thread settled,
 * which is an editorial decision about somebody else's board; see
 * `src/lib/comments.ts` for the mirror of the server's rules, and
 * `server/comments.ts` for the rules themselves.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, MessageSquare, RotateCcw, Trash2, X } from 'lucide-react';
import { useSession } from '../lib/authClient';
import {
  anchorLabel,
  canDeleteComment,
  canDeleteThread,
  canEditComment,
  canResolveThread,
  formatCommentTime,
  threadNumbers,
  visibleThreads,
} from '../lib/comments';
import { useCommentStore } from '../store/useCommentStore';
import { useDiagramStore } from '../store/useDiagramStore';
import {
  MAX_COMMENT_CHARS,
  type CommentInfo,
  type CommentThreadFilter,
  type CommentThreadInfo,
  type DiagramRole,
} from '../../shared/types';

const FILTERS: { value: CommentThreadFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

export function CommentsPanel() {
  const close = useCommentStore((s) => s.closePanel);
  const threads = useCommentStore((s) => s.threads);
  const filter = useCommentStore((s) => s.filter);
  const setFilter = useCommentStore((s) => s.setFilter);
  const activeThreadId = useCommentStore((s) => s.activeThreadId);
  const setActiveThread = useCommentStore((s) => s.setActiveThread);
  const composing = useCommentStore((s) => s.composing);
  const loaded = useCommentStore((s) => s.loaded);
  const nodes = useDiagramStore((s) => s.nodes);
  const role = useDiagramStore((s) => s.role);
  const userId = useSession().data?.user.id ?? null;

  const numbers = useMemo(() => threadNumbers(threads), [threads]);
  const shown = useMemo(() => visibleThreads(threads, filter), [threads, filter]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // Captured, so Escape closes the panel without also reaching the canvas
      // behind it and clearing the selection.
      event.stopPropagation();
      event.preventDefault();
      close();
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [close]);

  return (
    <aside
      role="dialog"
      aria-label="Comments"
      className="panel-in pointer-events-auto fixed right-0 top-0 z-30 flex h-screen w-[22rem] flex-col border-l border-line bg-panel/95 shadow-[-12px_0_40px_-20px_rgba(10,10,25,0.35)] backdrop-blur"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink-900">
          <MessageSquare size={15} /> Comments
        </h2>
        <button
          type="button"
          onClick={close}
          aria-label="Close comments"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-700/50 transition hover:bg-hover hover:text-ink-700"
        >
          <X size={15} />
        </button>
      </header>

      {composing && <Composer anchorNodes={nodes} />}

      <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-2">
        {FILTERS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={filter === tab.value}
            onClick={() => setFilter(tab.value)}
            className={
              filter === tab.value
                ? 'rounded-lg bg-hover-strong px-2.5 py-1 text-[12px] font-semibold text-ink-900'
                : 'rounded-lg px-2.5 py-1 text-[12px] font-medium text-ink-600 transition hover:bg-hover'
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {!loaded ? (
          <p className="flex items-center gap-2 px-2 py-3 text-[13px] text-ink-600">
            <Loader2 size={13} className="animate-spin" /> Loading…
          </p>
        ) : shown.length === 0 ? (
          <p className="px-2 py-3 text-[13px] text-ink-600">
            {filter === 'resolved'
              ? 'Nothing has been resolved yet.'
              : 'No comments yet. Right-click a shape or the canvas to start one.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {shown.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                number={numbers.get(thread.id) ?? 0}
                anchor={anchorLabel(thread, nodes)}
                expanded={activeThreadId === thread.id}
                role={role}
                userId={userId}
                onToggle={() => setActiveThread(activeThreadId === thread.id ? null : thread.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

/**
 * The first comment of a thread the user has just anchored. It carries the
 * anchor's own name so a right-click on a shape does not have to be remembered
 * — the composer says which shape it is about.
 */
function Composer({ anchorNodes }: { anchorNodes: { id: string; data: { label?: string } }[] }) {
  const composing = useCommentStore((s) => s.composing);
  const create = useCommentStore((s) => s.create);
  const cancel = useCommentStore((s) => s.cancelCompose);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Opened by a menu item the user has just clicked, so the caret belongs here
  // and not back on the canvas.
  useEffect(() => ref.current?.focus(), []);

  const submit = useCallback(async () => {
    if (!composing || !body.trim() || busy) return;
    setBusy(true);
    const ok = await create({ ...composing, body: body.trim() });
    setBusy(false);
    // A failure keeps the words: the store leaves the composer open, and
    // retyping a paragraph because the network blinked is unforgivable.
    if (ok) setBody('');
  }, [composing, body, busy, create]);

  if (!composing) return null;

  const name =
    'nodeId' in composing
      ? anchorNodes.find((node) => node.id === composing.nodeId)?.data.label?.trim() || 'this shape'
      : 'the canvas';

  return (
    <div className="shrink-0 border-b border-line px-3 py-3">
      <p className="mb-1.5 text-[12px] text-ink-600">New comment on {name}</p>
      <CommentEditor
        textareaRef={ref}
        value={body}
        onChange={setBody}
        onSubmit={submit}
        label="New comment"
        placeholder="Write a comment…"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !body.trim()}
          className="rounded-lg bg-accent-500 px-2.5 py-1 text-[13px] font-semibold text-white transition hover:bg-accent-600 disabled:opacity-50"
        >
          Comment
        </button>
        <button
          type="button"
          onClick={cancel}
          className="rounded-lg px-2 py-1 text-[13px] font-medium text-ink-700 transition hover:bg-hover"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  number,
  anchor,
  expanded,
  role,
  userId,
  onToggle,
}: {
  thread: CommentThreadInfo;
  number: number;
  anchor: string;
  expanded: boolean;
  role: DiagramRole;
  userId: string | null;
  onToggle: () => void;
}) {
  const setResolved = useCommentStore((s) => s.setResolved);
  const removeThread = useCommentStore((s) => s.removeThread);
  const [busy, setBusy] = useState(false);
  const first = thread.comments[0];
  const replies = thread.comments.length - 1;

  const toggleResolved = useCallback(async () => {
    setBusy(true);
    await setResolved(thread.id, !thread.resolved);
    setBusy(false);
  }, [setResolved, thread.id, thread.resolved]);

  return (
    <li className="rounded-lg px-2 py-2 transition hover:bg-hover-soft">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full flex-col items-start gap-0.5 text-left"
      >
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-700">
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-white">
            {number}
          </span>
          {anchor}
          {thread.resolved && <span className="font-medium text-ink-600">· Resolved</span>}
        </span>
        <span className="text-[12px] text-ink-600/70">
          {thread.createdBy.name} · {formatCommentTime(thread.createdAt)}
          {replies > 0 && ` · ${replies} ${replies === 1 ? 'reply' : 'replies'}`}
        </span>
        {!expanded && first && (
          <span className="line-clamp-2 text-[13px] text-ink-900">{first.body}</span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2">
          {thread.comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              thread={thread}
              role={role}
              userId={userId}
            />
          ))}

          <ReplyBox threadId={thread.id} />

          <div className="flex items-center gap-2">
            {canResolveThread(thread, role, userId) && (
              <button
                type="button"
                onClick={toggleResolved}
                disabled={busy}
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium text-ink-700 ring-1 ring-line-strong transition hover:bg-hover disabled:opacity-60"
              >
                {thread.resolved ? <RotateCcw size={11} /> : <Check size={11} />}
                {thread.resolved ? 'Reopen' : 'Resolve'}
              </button>
            )}
            {canDeleteThread(thread, role, userId) && (
              <button
                type="button"
                onClick={() => removeThread(thread.id)}
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium text-danger-ink transition hover:bg-danger-wash"
              >
                <Trash2 size={11} /> Delete thread
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function CommentRow({
  comment,
  thread,
  role,
  userId,
}: {
  comment: CommentInfo;
  thread: CommentThreadInfo;
  role: DiagramRole;
  userId: string | null;
}) {
  const edit = useCommentStore((s) => s.edit);
  const remove = useCommentStore((s) => s.remove);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  const save = useCallback(async () => {
    if (!draft.trim()) return;
    if (await edit(thread.id, comment.id, draft.trim())) setEditing(false);
  }, [draft, edit, thread.id, comment.id]);

  return (
    <div className="rounded-lg bg-hover-soft px-2.5 py-2">
      <p className="text-[12px] text-ink-600/70">
        {comment.author.name} · {formatCommentTime(comment.createdAt)}
        {comment.editedAt && ' · edited'}
      </p>
      {editing ? (
        <div className="mt-1.5">
          <CommentEditor
            value={draft}
            onChange={setDraft}
            onSubmit={save}
            label={`Edit comment by ${comment.author.name}`}
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!draft.trim()}
              className="rounded-md bg-accent-500 px-2 py-0.5 text-[12px] font-semibold text-white transition hover:bg-accent-600 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
              className="rounded-md px-2 py-0.5 text-[12px] font-medium text-ink-700 transition hover:bg-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] text-ink-900">
            {comment.body}
          </p>
          <div className="mt-1 flex items-center gap-2">
            {canEditComment(comment, userId) && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[12px] font-medium text-ink-600 transition hover:text-ink-900"
              >
                Edit
              </button>
            )}
            {canDeleteComment(comment, thread, role, userId) && (
              <button
                type="button"
                onClick={() => remove(thread.id, comment.id)}
                className="text-[12px] font-medium text-ink-600 transition hover:text-danger-ink"
              >
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ReplyBox({ threadId }: { threadId: string }) {
  const reply = useCommentStore((s) => s.reply);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    const ok = await reply(threadId, body.trim());
    setBusy(false);
    if (ok) setBody('');
  }, [body, busy, reply, threadId]);

  return (
    <div>
      <CommentEditor value={body} onChange={setBody} onSubmit={submit} label="Reply" placeholder="Reply…" />
      <button
        type="button"
        onClick={submit}
        disabled={busy || !body.trim()}
        className="mt-1.5 rounded-md bg-accent-500 px-2 py-0.5 text-[12px] font-semibold text-white transition hover:bg-accent-600 disabled:opacity-50"
      >
        Reply
      </button>
    </div>
  );
}

/**
 * The one text box every comment is written in.
 *
 * ⌘/Ctrl+Enter submits, and a bare Enter does not: a comment is prose, and a
 * paragraph break is a more common thing to want than a send. `maxLength` is
 * the server's own ceiling, so an over-long remark is refused here rather than
 * after a round trip.
 */
function CommentEditor({
  value,
  onChange,
  onSubmit,
  label,
  placeholder,
  textareaRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  label: string;
  placeholder?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onSubmit();
        }
      }}
      rows={2}
      maxLength={MAX_COMMENT_CHARS}
      aria-label={label}
      placeholder={placeholder}
      className="w-full resize-y rounded-lg bg-panel px-2.5 py-1.5 text-[13px] text-ink-900 ring-1 ring-line-strong outline-none placeholder:text-ink-600/40 focus:ring-accent-500/40"
    />
  );
}
