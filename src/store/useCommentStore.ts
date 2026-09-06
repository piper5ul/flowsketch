/**
 * The comment threads on the diagram that is open, and the panel's own state.
 *
 * Deliberately **not** part of `useDiagramStore`: a comment is not part of the
 * board. Nothing here is serialized into `DiagramData`, nothing pushes an undo
 * entry, and a comment is written straight to the server rather than waiting
 * for the autosave — so an editing session and a discussion never have to
 * agree about whose turn it is to save.
 *
 * **Every write refetches.** The API answers each mutation with the row it
 * wrote, and splicing that into the list by hand would mean a second way of
 * being right about thread order, resolved counts and — after deleting the last
 * comment in a thread — whether the thread is still there at all. A board
 * carries tens of threads, so one more GET is cheaper than that class of bug.
 */
import { create } from 'zustand';
import { api } from '../lib/api';
import { visibleThreads } from '../lib/comments';
import { toastError } from './useToastStore';
import type { CommentThreadFilter, CommentThreadInfo } from '../../shared/types';

/** Where a thread is pinned: to a shape, or to a point on the board. */
export type CommentAnchor = { nodeId: string } | { x: number; y: number };

/** A thread about to be created — an anchor and the comment that starts it. */
export type CommentDraft = CommentAnchor & { body: string };

function anchorOf(draft: CommentDraft): CommentAnchor {
  return 'nodeId' in draft ? { nodeId: draft.nodeId } : { x: draft.x, y: draft.y };
}

interface CommentState {
  /** The diagram these threads belong to; `null` before the first `load`. */
  diagramId: string | null;
  /** Every thread on the diagram, resolved ones included — see `load`. */
  threads: CommentThreadInfo[];
  /** Which tab of the panel is showing. Narrows `threads`, never the request. */
  filter: CommentThreadFilter;
  /** The thread expanded in the panel, if any. */
  activeThreadId: string | null;
  panelOpen: boolean;
  /** False until the first listing has come back, so the panel can say so. */
  loaded: boolean;
  /** The anchor of a thread being composed, or `null` when nothing is. */
  composing: CommentAnchor | null;

  load: (diagramId: string) => Promise<void>;
  setFilter: (filter: CommentThreadFilter) => void;
  setActiveThread: (threadId: string | null) => void;
  openPanel: (threadId?: string) => void;
  closePanel: () => void;
  beginCompose: (anchor: CommentAnchor) => void;
  cancelCompose: () => void;

  create: (draft: CommentDraft) => Promise<boolean>;
  reply: (threadId: string, body: string) => Promise<boolean>;
  setResolved: (threadId: string, resolved: boolean) => Promise<boolean>;
  edit: (threadId: string, commentId: string, body: string) => Promise<boolean>;
  remove: (threadId: string, commentId: string) => Promise<boolean>;
  removeThread: (threadId: string) => Promise<boolean>;

  /** Forgets everything — called when the canvas unmounts or changes diagram. */
  reset: () => void;
}

const EMPTY = {
  diagramId: null,
  threads: [],
  filter: 'open',
  activeThreadId: null,
  panelOpen: false,
  loaded: false,
  composing: null,
} satisfies Omit<
  CommentState,
  | 'load' | 'setFilter' | 'setActiveThread' | 'openPanel' | 'closePanel' | 'beginCompose'
  | 'cancelCompose' | 'create' | 'reply' | 'setResolved' | 'edit' | 'remove' | 'removeThread'
  | 'reset'
>;

export const useCommentStore = create<CommentState>((set, get) => {
  /**
   * Refetches after a write, and keeps the expansion honest: a thread that the
   * write has just hidden (resolved under the "Open" tab) or deleted outright
   * must not stay expanded over nothing.
   */
  async function refresh(): Promise<void> {
    const diagramId = get().diagramId;
    if (diagramId) await get().load(diagramId);
  }

  /** Runs a write, refetches, and turns any failure into one toast. */
  async function write(action: (diagramId: string) => Promise<unknown>, failure: string) {
    const diagramId = get().diagramId;
    if (!diagramId) return false;
    try {
      await action(diagramId);
      await refresh();
      return true;
    } catch {
      toastError(failure);
      return false;
    }
  }

  return {
    ...EMPTY,

    /**
     * Loads every thread on the diagram — `all`, not the open ones the canvas
     * draws. The pins and the Comments badge have to know about threads the
     * open tab is hiding, and one listing serves all three; `visibleThreads`
     * does the narrowing.
     */
    load: async (diagramId) => {
      // A different diagram is a different conversation: drop the old one
      // rather than showing it while the new listing is in flight.
      if (get().diagramId !== diagramId) set({ ...EMPTY, diagramId });
      try {
        const threads = await api.listThreads(diagramId, 'all');
        // The user can have left for another diagram while this was away.
        if (get().diagramId !== diagramId) return;
        const stillThere = new Set(threads.map((thread) => thread.id));
        const active = get().activeThreadId;
        set({
          threads,
          loaded: true,
          activeThreadId: active && stillThere.has(active) ? active : null,
        });
      } catch {
        if (get().diagramId !== diagramId) return;
        // The threads already on screen are left alone: a refetch that failed
        // is a stale list, which is a great deal better than an empty one.
        set({ loaded: true });
        toastError('Could not load comments.');
      }
    },

    setFilter: (filter) => {
      const { threads, activeThreadId } = get();
      const visible = visibleThreads(threads, filter);
      set({
        filter,
        activeThreadId:
          activeThreadId && visible.some((thread) => thread.id === activeThreadId)
            ? activeThreadId
            : null,
      });
    },

    setActiveThread: (threadId) => set({ activeThreadId: threadId, composing: null }),

    openPanel: (threadId) =>
      set(threadId ? { panelOpen: true, activeThreadId: threadId, composing: null } : { panelOpen: true }),

    closePanel: () => set({ panelOpen: false, composing: null }),

    /** Opens the panel with an empty composer pinned to `anchor`. */
    beginCompose: (anchor) =>
      set({ panelOpen: true, composing: anchor, activeThreadId: null }),

    cancelCompose: () => set({ composing: null }),

    create: async (draft) => {
      const diagramId = get().diagramId;
      if (!diagramId) return false;
      try {
        const thread = await api.createThread(diagramId, anchorOf(draft), draft.body);
        // Expanded before the refetch, so the new thread is already the one
        // the panel is showing when the list lands.
        set({ composing: null, panelOpen: true, activeThreadId: thread.id });
        await refresh();
        return true;
      } catch {
        toastError('Could not post that comment.');
        return false;
      }
    },

    reply: (threadId, body) =>
      write((diagramId) => api.addComment(diagramId, threadId, body), 'Could not post that reply.'),

    setResolved: (threadId, resolved) =>
      write(
        (diagramId) => api.setThreadResolved(diagramId, threadId, resolved),
        resolved ? 'Could not resolve that thread.' : 'Could not reopen that thread.',
      ),

    edit: (threadId, commentId, body) =>
      write(
        (diagramId) => api.editComment(diagramId, threadId, commentId, body),
        'Could not save that edit.',
      ),

    // Deleting the last comment deletes the thread with it, server-side — which
    // is exactly why this refetches rather than removing one entry by hand.
    remove: (threadId, commentId) =>
      write(
        (diagramId) => api.deleteComment(diagramId, threadId, commentId),
        'Could not delete that comment.',
      ),

    removeThread: (threadId) =>
      write((diagramId) => api.deleteThread(diagramId, threadId), 'Could not delete that thread.'),

    reset: () => set({ ...EMPTY }),
  };
});
