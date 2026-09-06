import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Star,
  Trash2,
  LogOut,
  MoreHorizontal,
  FileText,
  RotateCw,
  Copy,
  Pencil,
  Search,
  Upload,
} from 'lucide-react';
import { signOut, useSession } from '../lib/authClient';
import { api } from '../lib/api';
import {
  DIAGRAM_SORTS,
  filterDiagrams,
  loadDiagrams,
  sortDiagrams,
  splitByOwnership,
  type DiagramSort,
} from '../lib/diagramList';
import { parseDiagramExport } from '../lib/diagramFile';
import { migrateDiagramData } from '../lib/diagramMigrations';
import type { DiagramData, DiagramMeta } from '../../shared/types';
import { Tooltip, TooltipProvider } from '../components/Tooltip';
import { Toasts } from '../components/Toasts';
import { toastError } from '../store/useToastStore';

/** How many placeholder cards fill the grid while the list is loading. */
const SKELETON_COUNT = 8;

/** Shared by the real cards and their loading placeholders. */
const CARD_GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4';

type ListState = 'loading' | 'ready' | 'error';

export function DashboardPage() {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const [diagrams, setDiagrams] = useState<DiagramMeta[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  // Set to a diagram id while its menu is showing the delete confirmation.
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  // Set to a diagram id while its title is being edited in place.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<DiagramSort>('updated');
  const fileInput = useRef<HTMLInputElement>(null);

  // Two sections, each searched and sorted on its own: a starred diagram is
  // pinned to the front of the list it is in, not lifted out of it, and a
  // search that matches nothing of the user's own can still match one of the
  // diagrams they have been invited to.
  const { owned, shared } = useMemo(() => {
    const arrange = (list: DiagramMeta[]) => sortDiagrams(filterDiagrams(list, query), sort);
    const split = splitByOwnership(diagrams);
    return { owned: arrange(split.owned), shared: arrange(split.shared) };
  }, [diagrams, query, sort]);

  // Opening or closing a menu always drops any confirmation it was showing, so
  // a menu never reopens mid-confirm.
  const openMenu = useCallback((id: string | null) => {
    setMenuOpen(id);
    setConfirmingDelete(null);
  }, []);

  const refresh = useCallback(async () => {
    setListState('loading');
    const result = await loadDiagrams();
    if (!result.ok) {
      setListState('error');
      return;
    }
    setDiagrams(result.diagrams);
    setListState('ready');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createDiagram = useCallback(async () => {
    const diagram = await api.createDiagram();
    navigate(`/d/${diagram.id}`);
  }, [navigate]);

  const importDiagram = useCallback(async (file: File) => {
    let title: string;
    let data: DiagramData;
    try {
      const parsed = parseDiagramExport(await file.text());
      title = parsed.title;
      // The same door every stored diagram comes through: an older file is
      // upgraded, one from a newer build is refused with its own message.
      data = migrateDiagramData(parsed.data);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Could not read that file.');
      return;
    }

    try {
      const created = await api.createDiagram(title, data);
      navigate(`/d/${created.id}`);
    } catch {
      toastError('Could not import the diagram. Please try again.');
    }
  }, [navigate]);

  const toggleStar = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const result = await api.toggleStar(id);
      setDiagrams((prev) => prev.map((d) => (d.id === id ? { ...d, starred: result.starred } : d)));
    } catch {
      toastError('Could not update the star. Please try again.');
    }
  }, []);

  const deleteDiagram = useCallback(async (id: string) => {
    try {
      await api.deleteDiagram(id);
      setDiagrams((prev) => prev.filter((d) => d.id !== id));
    } catch {
      toastError('Could not delete the diagram. Please try again.');
    }
    openMenu(null);
  }, [openMenu]);

  const duplicateDiagram = useCallback(async (id: string) => {
    openMenu(null);
    try {
      const copy = await api.duplicateDiagram(id);
      setDiagrams((prev) => [copy, ...prev]);
    } catch {
      toastError('Could not duplicate the diagram. Please try again.');
    }
  }, [openMenu]);

  /** Commits an inline rename. An unchanged or emptied title is left alone. */
  const renameDiagram = useCallback(async (id: string, title: string) => {
    setRenaming(null);
    const next = title.trim();
    const current = diagrams.find((d) => d.id === id);
    if (!current || next === '' || next === current.title) return;
    // Optimistic: the card is being typed into, so it has to follow the
    // keystrokes rather than the round trip.
    setDiagrams((prev) => prev.map((d) => (d.id === id ? { ...d, title: next } : d)));
    try {
      await api.saveDiagram(id, { title: next });
    } catch {
      setDiagrams((prev) => prev.map((d) => (d.id === id ? { ...d, title: current.title } : d)));
      toastError('Could not rename the diagram. Please try again.');
    }
  }, [diagrams]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    navigate('/login');
  }, [navigate]);

  /** One card, wired to the dashboard's state. Both sections render the same one. */
  const renderCard = (d: DiagramMeta) => (
    <DiagramCard
      key={d.id}
      diagram={d}
      menuOpen={menuOpen === d.id}
      confirmingDelete={confirmingDelete === d.id}
      renaming={renaming === d.id}
      onOpen={() => navigate(`/d/${d.id}`)}
      onToggleStar={(e) => toggleStar(d.id, e)}
      onMenuToggle={() => openMenu(menuOpen === d.id ? null : d.id)}
      onRequestDelete={() => setConfirmingDelete(d.id)}
      onCancelDelete={() => openMenu(null)}
      onDelete={() => deleteDiagram(d.id)}
      onDuplicate={() => duplicateDiagram(d.id)}
      onRequestRename={() => { openMenu(null); setRenaming(d.id); }}
      onCommitRename={(title) => renameDiagram(d.id, title)}
      onCancelRename={() => setRenaming(null)}
    />
  );

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-canvas">
        {/* Header */}
        <header className="border-b border-black/[0.06] bg-white/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <h1 className="text-lg font-bold text-ink-950">Whimsy</h1>
            <div className="flex items-center gap-3">
              <span className="text-sm text-ink-600">{session?.user?.name || session?.user?.email}</span>
              <Tooltip label="Sign out" side="bottom">
                <button
                  onClick={handleSignOut}
                  aria-label="Sign out"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-600 transition hover:bg-black/[0.04] hover:text-ink-900"
                >
                  <LogOut size={16} />
                </button>
              </Tooltip>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="mx-auto max-w-6xl px-6 py-8">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink-900">My Diagrams</h2>
            <div className="flex items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Cleared so picking the same file twice fires `change` again.
                  e.target.value = '';
                  if (file) void importDiagram(file);
                }}
              />
              <button
                onClick={() => fileInput.current?.click()}
                className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-ink-700 shadow-[0_1px_3px_rgba(20,20,50,0.06)] ring-1 ring-black/[0.04] transition hover:text-ink-900"
              >
                <Upload size={16} />
                Import
              </button>
              <button
                onClick={createDiagram}
                className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-600"
              >
                <Plus size={16} />
                New Diagram
              </button>
            </div>
          </div>

          {listState === 'ready' && diagrams.length > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-600/50"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search diagrams"
                  placeholder="Search diagrams"
                  className="w-full rounded-lg bg-white py-2 pl-9 pr-3 text-sm text-ink-900 shadow-[0_1px_3px_rgba(20,20,50,0.06)] ring-1 ring-black/[0.04] outline-none placeholder:text-ink-600/50 focus:ring-accent-500/40"
                />
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as DiagramSort)}
                aria-label="Sort diagrams"
                className="rounded-lg bg-white px-3 py-2 text-sm text-ink-900 shadow-[0_1px_3px_rgba(20,20,50,0.06)] ring-1 ring-black/[0.04] outline-none focus:ring-accent-500/40"
              >
                {DIAGRAM_SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {listState === 'loading' ? (
            <SkeletonGrid />
          ) : listState === 'error' ? (
            <ErrorState onRetry={refresh} />
          ) : diagrams.length === 0 ? (
            <EmptyState onCreate={createDiagram} />
          ) : owned.length + shared.length === 0 ? (
            <p className="py-20 text-center text-sm text-ink-600">No diagrams match “{query.trim()}”.</p>
          ) : (
            <>
              {owned.length > 0 && <div className={CARD_GRID}>{owned.map(renderCard)}</div>}
              {shared.length > 0 && (
                <section className={owned.length > 0 ? 'mt-10' : ''}>
                  <h2 className="mb-4 text-lg font-semibold text-ink-900">Shared with me</h2>
                  <div className={CARD_GRID}>{shared.map(renderCard)}</div>
                </section>
              )}
            </>
          )}
        </main>

        <Toasts />
      </div>
    </TooltipProvider>
  );
}

function DiagramCard({
  diagram,
  menuOpen,
  confirmingDelete,
  renaming,
  onOpen,
  onToggleStar,
  onMenuToggle,
  onRequestDelete,
  onCancelDelete,
  onDelete,
  onDuplicate,
  onRequestRename,
  onCommitRename,
  onCancelRename,
}: {
  diagram: DiagramMeta;
  menuOpen: boolean;
  confirmingDelete: boolean;
  renaming: boolean;
  onOpen: () => void;
  onToggleStar: (e: React.MouseEvent) => void;
  onMenuToggle: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onRequestRename: () => void;
  onCommitRename: (title: string) => void;
  onCancelRename: () => void;
}) {
  const timeAgo = formatRelativeTime(diagram.updatedAt);
  // Star, rename, duplicate and delete are all owner-only on the server — the
  // star because it is one column on the row rather than a per-user flag — so
  // a card for somebody else's diagram carries none of them, and says who it
  // belongs to and what this user may do with it instead.
  const isOwner = diagram.role === 'owner';

  return (
    <div
      // A card being renamed must not open the diagram under the input.
      onClick={renaming ? undefined : onOpen}
      className="group cursor-pointer rounded-xl bg-white shadow-[0_1px_3px_rgba(20,20,50,0.08)] ring-1 ring-black/[0.04] transition hover:shadow-[0_4px_12px_rgba(20,20,50,0.12)] hover:ring-accent-500/30"
    >
      {/* Thumbnail */}
      <div className="flex h-36 items-center justify-center overflow-hidden rounded-t-xl bg-gradient-to-br from-canvas to-white">
        {diagram.thumbnail ? (
          <img
            src={diagram.thumbnail}
            alt=""
            // `contain`, so a wide board and a tall one are both shown whole
            // rather than cropped to the card.
            className="h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <FileText size={32} className="text-ink-600/30" />
        )}
      </div>

      {/* Info */}
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between">
          {renaming ? (
            <RenameInput title={diagram.title} onCommit={onCommitRename} onCancel={onCancelRename} />
          ) : (
            <p className="truncate text-sm font-medium text-ink-900">{diagram.title}</p>
          )}
          <div className="flex shrink-0 items-center gap-0.5">
            {!isOwner && (
              <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-medium text-ink-600">
                {diagram.role === 'editor' ? 'Can edit' : 'Can view'}
              </span>
            )}
            {isOwner && (
            <button
              onClick={onToggleStar}
              // The name changes with the state so a screen reader hears what
              // the click will do, and `aria-pressed` carries where it stands.
              aria-label={diagram.starred ? 'Unstar diagram' : 'Star diagram'}
              aria-pressed={diagram.starred}
              className="flex h-6 w-6 items-center justify-center rounded text-ink-600/40 transition hover:text-yellow-400"
            >
              <Star size={13} className={diagram.starred ? 'fill-yellow-400 text-yellow-400' : ''} />
            </button>
            )}
            {isOwner && (
            <div className="relative">
              <button
                aria-label="Diagram actions"
                onClick={(e) => { e.stopPropagation(); onMenuToggle(); }}
                className="flex h-6 w-6 items-center justify-center rounded text-ink-600/40 opacity-0 transition group-hover:opacity-100 hover:text-ink-900"
              >
                <MoreHorizontal size={14} />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-7 z-50 w-44 rounded-lg bg-white py-1 shadow-lg ring-1 ring-black/[0.08]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {confirmingDelete ? (
                    <div className="px-3 py-2">
                      <p className="mb-2 text-sm text-ink-900">Delete this diagram?</p>
                      <div className="flex items-center gap-2">
                        <button
                          aria-label="Confirm delete"
                          onClick={onDelete}
                          className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-red-700"
                        >
                          Delete
                        </button>
                        <button
                          onClick={onCancelDelete}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-ink-600 transition hover:bg-black/[0.04] hover:text-ink-900"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={onRequestRename}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-black/[0.04]"
                      >
                        <Pencil size={13} /> Rename
                      </button>
                      <button
                        onClick={onDuplicate}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-black/[0.04]"
                      >
                        <Copy size={13} /> Duplicate
                      </button>
                      <button
                        onClick={onRequestDelete}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            )}
          </div>
        </div>
        <p className="mt-0.5 text-xs text-ink-600/60">
          {diagram.ownerName ? `${diagram.ownerName} · ${timeAgo}` : timeAgo}
        </p>
      </div>
    </div>
  );
}

/**
 * The card title, in place, while it is being renamed.
 *
 * Enter and Escape both leave through blur, so there is exactly one commit
 * path however the edit ends — clicking elsewhere included.
 */
function RenameInput({
  title,
  onCommit,
  onCancel,
}: {
  title: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(title);
  // A ref, not state: `blur()` dispatches its event synchronously, so a state
  // update made just before it would not be visible to the blur handler.
  const cancelled = useRef(false);

  return (
    <input
      autoFocus
      value={value}
      aria-label="Diagram title"
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={() => (cancelled.current ? onCancel() : onCommit(value))}
      className="min-w-0 flex-1 rounded border border-accent-500/40 bg-white px-1 py-0.5 text-sm font-medium text-ink-900 outline-none"
    />
  );
}

/**
 * Card-shaped placeholders in the same grid the real cards land in, so the
 * layout does not jump once the list arrives.
 */
function SkeletonGrid() {
  return (
    <div className={CARD_GRID} aria-hidden="true">
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <div key={i} className="animate-pulse rounded-xl bg-white ring-1 ring-black/[0.04]">
          <div className="h-36 rounded-t-xl bg-black/[0.05]" />
          <div className="space-y-2 px-3 py-3">
            <div className="h-3 w-2/3 rounded bg-black/[0.06]" />
            <div className="h-2.5 w-1/3 rounded bg-black/[0.04]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center py-20">
      <h3 className="mb-1 text-base font-semibold text-ink-900">Could not load your diagrams</h3>
      <p className="mb-5 text-sm text-ink-600">The server did not answer. Your work is safe.</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-600"
      >
        <RotateCw size={16} />
        Retry
      </button>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center py-20">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-500/10">
        <FileText size={28} className="text-accent-500" />
      </div>
      <h3 className="mb-1 text-base font-semibold text-ink-900">No diagrams yet</h3>
      <p className="mb-5 text-sm text-ink-600">Create your first diagram to get started.</p>
      <button
        onClick={onCreate}
        className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-600"
      >
        <Plus size={16} />
        New Diagram
      </button>
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}
