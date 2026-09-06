/**
 * The pure half of commenting: how a thread list is ordered, narrowed and
 * described, and who may do what to one.
 *
 * The permission helpers here are a **mirror** of `server/comments.ts`, never
 * the authority — the server refuses what it refuses whatever this file thinks.
 * They exist so the panel does not offer a button that is going to 403: an
 * action a viewer can see but never use is worse than one they are not shown.
 */
import type {
  CommentInfo,
  CommentThreadFilter,
  CommentThreadInfo,
  DiagramRole,
} from '../../shared/types';
import { formatVersionTime } from './versionHistory';

/**
 * When a comment was written. The same hand-rolled clock the history panel
 * reads on — "Today 14:03" answers "is this recent?" at a glance, and one
 * formatter means the two panels never disagree about what time it is.
 */
export const formatCommentTime = formatVersionTime;

/** The shape of a diagram node this module needs: an id and maybe a label. */
export interface AnchoredNode {
  id: string;
  data: { label?: string };
}

/**
 * The threads a filter tab shows.
 *
 * The list is narrowed here rather than by refetching, because the store holds
 * every thread whatever tab is open: the canvas pins and the button's badge
 * both have to know about threads the current tab is hiding.
 */
export function visibleThreads(
  threads: CommentThreadInfo[],
  filter: CommentThreadFilter,
): CommentThreadInfo[] {
  if (filter === 'all') return threads;
  return threads.filter((thread) => thread.resolved === (filter === 'resolved'));
}

/** How many conversations are still open — what the Comments button counts. */
export function openThreadCount(threads: CommentThreadInfo[]): number {
  return threads.filter((thread) => !thread.resolved).length;
}

/**
 * The number each thread's pin wears, oldest first.
 *
 * Numbering runs oldest-first — the opposite of the order the API answers in —
 * so a pin keeps its number for the life of the thread: numbering the newest
 * "1" would renumber the whole board every time somebody said something.
 * `createdAt` is ISO 8601, which sorts chronologically as a string, and `id`
 * breaks the tie the same way the server's own ordering does.
 */
export function threadNumbers(threads: CommentThreadInfo[]): Map<string, number> {
  const oldestFirst = [...threads].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  return new Map(oldestFirst.map((thread, index) => [thread.id, index + 1]));
}

/**
 * What a thread is pinned to, in words: the shape's own text, a generic name
 * for a shape that has none, "Canvas" for a positioned thread, and a note that
 * the shape has gone — `nodeId` is not a foreign key, so a pin outlives the
 * thing it was put on and the panel has to be able to say so.
 */
export function anchorLabel(thread: CommentThreadInfo, nodes: AnchoredNode[]): string {
  if (!thread.nodeId) return 'Canvas';
  const node = nodes.find((candidate) => candidate.id === thread.nodeId);
  if (!node) return 'Deleted shape';
  return node.data.label?.trim() || 'Shape';
}

/**
 * May this person call the thread settled, or reopen it? Editor+, or whoever
 * opened it: closing a discussion on somebody else's board is an editorial
 * call, but nobody needs permission to close their own question.
 */
export function canResolveThread(
  thread: CommentThreadInfo,
  role: DiagramRole,
  userId: string | null,
): boolean {
  return role === 'owner' || role === 'editor' || thread.createdBy.id === userId;
}

/** May this person rewrite the comment? Its author alone. */
export function canEditComment(comment: CommentInfo, userId: string | null): boolean {
  return userId !== null && comment.author.id === userId;
}

/**
 * May this person remove the comment? Its author, the person whose thread it
 * sits in, or the diagram's owner — the two hosts of the conversation plus
 * whoever said it.
 */
export function canDeleteComment(
  comment: CommentInfo,
  thread: CommentThreadInfo,
  role: DiagramRole,
  userId: string | null,
): boolean {
  return (
    role === 'owner' ||
    (userId !== null && (comment.author.id === userId || thread.createdBy.id === userId))
  );
}

/** May this person remove the whole thread? The owner, or whoever started it. */
export function canDeleteThread(
  thread: CommentThreadInfo,
  role: DiagramRole,
  userId: string | null,
): boolean {
  return role === 'owner' || (userId !== null && thread.createdBy.id === userId);
}
