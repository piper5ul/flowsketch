import { useCallback, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Eye, History, MessageSquare, Star, Check, Loader2, Download, Image, FileText, FileJson, Shapes, Users } from 'lucide-react';
import clsx from 'clsx';
import { Tooltip } from './Tooltip';
import { HistoryPanel } from './HistoryPanel';
import { CommentsPanel } from './CommentsPanel';
import { ShareDialog } from './ShareDialog';
import { PresenceStrip } from './PresenceStrip';
import { openThreadCount } from '../lib/comments';
import { connectionDisplay } from '../lib/collab/connectionStatus';
import { useCollabStore } from '../store/useCollabStore';
import { useCommentStore } from '../store/useCommentStore';
import { useDiagramStore, serializeDiagram, type SaveStatus } from '../store/useDiagramStore';
import { renderDiagramPng, renderDiagramSvg } from '../lib/exportImage';
import { buildDiagramExport, diagramFileName } from '../lib/diagramFile';
import { api } from '../lib/api';
import { toastError } from '../store/useToastStore';

export function TopBar() {
  const navigate = useNavigate();
  const title = useDiagramStore((s) => s.title);
  const setTitle = useDiagramStore((s) => s.setTitle);
  const starred = useDiagramStore((s) => s.starred);
  const setStarred = useDiagramStore((s) => s.setStarred);
  const diagramId = useDiagramStore((s) => s.diagramId);
  const saveStatus = useDiagramStore((s) => s.saveStatus);
  const role = useDiagramStore((s) => s.role);
  const readOnly = useDiagramStore((s) => s.readOnly);
  // A bound diagram has no save to report: the document is the save. What is
  // worth reporting there is the connection — see `LiveIndicator`.
  const bound = useCollabStore((s) => s.bound);

  const toggleStar = useCallback(async () => {
    if (!diagramId) return;
    const result = await api.toggleStar(diagramId);
    setStarred(result.starred);
  }, [diagramId, setStarred]);

  return (
    <>
    <div className="pointer-events-none absolute left-4 right-4 top-4 z-20 flex items-center justify-between">
      <div className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-panel/95 py-1.5 pl-2 pr-2 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-line-subtle backdrop-blur">
        <Tooltip label="Back to dashboard" side="bottom">
          <button
            onClick={() => navigate('/')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-700/50 transition hover:bg-hover hover:text-ink-700"
          >
            <ArrowLeft size={15} />
          </button>
        </Tooltip>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          // Clearing the field is a normal thing to do while retyping a name,
          // so the fallback waits until the user leaves it rather than
          // fighting them mid-edit.
          onBlur={() => setTitle(title.trim() || 'Untitled')}
          readOnly={readOnly}
          aria-label="Diagram title"
          className="min-w-0 max-w-[16rem] bg-transparent text-[14px] font-semibold text-ink-900 outline-none"
        />
        {/* `starred` is one column on the diagram row rather than a per-user
            flag, so the server refuses it from anyone but the owner. */}
        {role === 'owner' && (
          <Tooltip label={starred ? 'Unstar' : 'Star'} side="bottom">
            <button
              onClick={toggleStar}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-700/50 transition hover:bg-hover hover:text-ink-700"
            >
              <Star size={15} className={clsx(starred && 'fill-yellow-400 text-yellow-400')} />
            </button>
          </Tooltip>
        )}
        {readOnly ? <ViewOnlyPill /> : bound ? <LiveIndicator /> : <SaveIndicator status={saveStatus} />}
        {/* Next to the save indicator because it answers the neighbouring
            question: not "where are my edits going" but "who else is making
            them". Shown to viewers too — being in the room is not an edit. */}
        <PresenceStrip />
      </div>

      <div className="flex items-center gap-2">
        {/* Reading the history is a viewer's right too: being shown what a
            board looked like last week is the same permission as being shown
            what it looks like now. The panel withholds the two writes. */}
        <HistoryButton />
        {/* Offered to every member, viewers included: reading and writing a
            comment are both a viewer's right, because a reviewer who cannot
            write anything down is not reviewing. The public share page mounts
            no TopBar at all, which is what keeps it off an anonymous reader —
            every comment route needs a session and a name. */}
        <CommentsButton />
        {/* Owner-only in substance — every sharing route is — but an editor is
            still offered it, because the dialog is the only place the list of
            collaborators lives and they are allowed to read it. A viewer gets
            nothing: they have no say in who else is here. */}
        {(role === 'owner' || role === 'editor') && <ShareButton />}
        <ExportMenu />
      </div>
    </div>
    <ConflictBanner />
    </>
  );
}

function HistoryButton() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className="pointer-events-auto">
      <div className="flex items-center gap-2 rounded-2xl bg-panel/95 px-2 py-1.5 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-line-subtle backdrop-blur">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-ink-700 hover:bg-hover"
        >
          <History size={15} /> History
        </button>
      </div>
      {open && <HistoryPanel onClose={close} />}
    </div>
  );
}

/**
 * Opens the comments sheet, and is where the diagram's threads are loaded.
 *
 * The fetch lives here rather than in the panel because the count on this
 * button — and the pins on the canvas — have to be right whether or not the
 * panel has ever been opened. It is mounted exactly when a signed-in member has
 * the diagram open, which is exactly when there is a conversation to fetch.
 */
function CommentsButton() {
  const diagramId = useDiagramStore((s) => s.diagramId);
  const open = useCommentStore((s) => s.panelOpen);
  const threads = useCommentStore((s) => s.threads);
  const openCount = openThreadCount(threads);

  useEffect(() => {
    if (!diagramId) return;
    void useCommentStore.getState().load(diagramId);
    // A different diagram is a different conversation, and an unmounted canvas
    // has none at all.
    return () => useCommentStore.getState().reset();
  }, [diagramId]);

  const toggle = useCallback(() => {
    const store = useCommentStore.getState();
    if (store.panelOpen) store.closePanel();
    else store.openPanel();
  }, []);

  return (
    <div className="pointer-events-auto">
      <div className="flex items-center gap-2 rounded-2xl bg-panel/95 px-2 py-1.5 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-line-subtle backdrop-blur">
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-ink-700 hover:bg-hover"
        >
          <MessageSquare size={15} /> Comments
          {openCount > 0 && (
            <span
              aria-label={`${openCount} open ${openCount === 1 ? 'thread' : 'threads'}`}
              className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-white"
            >
              {openCount}
            </span>
          )}
        </button>
      </div>
      {open && <CommentsPanel />}
    </div>
  );
}

function ShareButton() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className="pointer-events-auto">
      <div className="flex items-center gap-2 rounded-2xl bg-panel/95 px-2 py-1.5 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-line-subtle backdrop-blur">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-ink-700 hover:bg-hover"
        >
          <Users size={15} /> Share
        </button>
      </div>
      {open && <ShareDialog onClose={close} />}
    </div>
  );
}

/**
 * Shown when a save was refused because another tab wrote first. Autosave is
 * already stood down by then (see `CanvasPage`), so this is the only way
 * forward: take their version, or keep this one.
 */
function ConflictBanner() {
  const conflict = useDiagramStore((s) => s.conflict);
  const diagramId = useDiagramStore((s) => s.diagramId);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!diagramId) return;
    setBusy(true);
    try {
      const diagram = await api.getDiagram(diagramId);
      // Discards this tab's unsaved edits by design — the user asked for the
      // other version. `loadDiagram` clears the conflict and resets the guard.
      useDiagramStore
        .getState()
        .loadDiagram(diagram.id, diagram.title, diagram.starred, diagram.data, diagram.updatedAt, {
          role: diagram.role,
          shareToken: diagram.shareToken ?? null,
        });
    } catch {
      toastError('Could not reload the diagram. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [diagramId]);

  const overwrite = useCallback(async () => {
    setBusy(true);
    // Resends without the guard. A failure leaves the conflict in place, so the
    // banner stays up rather than pretending the edit was kept.
    await useDiagramStore.getState().saveDiagram({ overwrite: true });
    setBusy(false);
  }, []);

  if (!conflict || !diagramId) return null;

  return (
    <div
      role="alert"
      className="pointer-events-auto absolute left-1/2 top-16 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-warn-wash px-3.5 py-2 text-[13px] text-warn-ink shadow-[0_10px_30px_-10px_rgba(20,20,50,0.35)] ring-1 ring-warn-ink/25"
    >
      <AlertTriangle size={15} className="shrink-0 text-warn-ink" />
      <span>This diagram changed in another tab.</span>
      <button
        type="button"
        onClick={reload}
        disabled={busy}
        className="rounded-lg bg-amber-600 px-2.5 py-1 text-[13px] font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
      >
        Reload
      </button>
      <button
        type="button"
        onClick={overwrite}
        disabled={busy}
        className="rounded-lg px-2.5 py-1 text-[13px] font-medium text-warn-ink underline-offset-2 transition hover:underline disabled:opacity-60"
      >
        Overwrite
      </button>
    </div>
  );
}

/** Hands the browser a URL to save under `name`. */
function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const title = useDiagramStore((s) => s.title);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const exportPng = useCallback(async () => {
    setOpen(false);
    // Null for an empty diagram — nothing worth downloading.
    const dataUrl = await renderDiagramPng();
    if (!dataUrl) return;
    download(dataUrl, diagramFileName(title, 'png'));
  }, [title]);

  const exportJson = useCallback(() => {
    setOpen(false);
    // The board's defaults travel with the file: importing a diagram and then
    // drawing on it should carry on in the style it was saved in.
    const { nodes, edges, defaults } = useDiagramStore.getState();
    const file = buildDiagramExport(title, serializeDiagram(nodes, edges, null, defaults));
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
    );
    download(url, diagramFileName(title, 'json'));
    // Not revoked in the same tick: the click only queues the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [title]);

  const exportSvg = useCallback(async () => {
    setOpen(false);
    const dataUrl = await renderDiagramSvg();
    if (!dataUrl) return;
    download(dataUrl, diagramFileName(title, 'svg'));
  }, [title]);

  const printDiagram = useCallback(async () => {
    setOpen(false);
    const dataUrl = await renderDiagramPng();
    if (!dataUrl) return;
    const printWindow = window.open('');
    if (!printWindow) return;
    printWindow.document.write(`<img src="${dataUrl}" style="max-width:100%" />`);
    printWindow.document.title = title || 'diagram';
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }, [title]);

  return (
    <div ref={menuRef} className="pointer-events-auto relative">
      <div className="flex items-center gap-2 rounded-2xl bg-panel/95 px-2 py-1.5 shadow-[0_10px_30px_-10px_rgba(20,20,50,0.25)] ring-1 ring-line-subtle backdrop-blur">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-ink-700 hover:bg-hover"
        >
          <Download size={15} /> Export
        </button>
      </div>
      {open && (
        <div className="panel-in absolute right-0 top-full mt-2 flex w-44 flex-col gap-0.5 rounded-xl bg-ink-950 p-1.5 shadow-[0_16px_40px_-10px_rgba(10,10,25,0.55)]">
          <button
            onClick={exportPng}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10"
          >
            <Image size={15} /> Export as PNG
          </button>
          <button
            onClick={exportJson}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10"
          >
            <FileJson size={15} /> Export as JSON
          </button>
          <button
            onClick={exportSvg}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10"
          >
            <Shapes size={15} /> Export as SVG
          </button>
          <button
            onClick={printDiagram}
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-white/85 hover:bg-white/10"
          >
            <FileText size={15} /> Print / PDF
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Stands where the save indicator would, because it answers the same question:
 * what is happening to my edits? Here, nothing — there are none to make.
 */
export function ViewOnlyPill() {
  return (
    <span className="ml-1 flex items-center gap-1.5 rounded-full bg-hover-strong px-2 py-0.5 text-xs font-medium text-ink-700">
      <Eye size={12} /> View only
    </span>
  );
}

/**
 * Where the save indicator stands, for a diagram that lives in a shared
 * document: the connection, because that is the only thing left that can go
 * wrong with an edit. See `src/lib/collab/connectionStatus.ts`.
 *
 * The three tones are spelled out rather than themed, exactly as the presence
 * dot's are: green, amber and red mean the same thing on any background.
 */
const TONE_CLASS = {
  live: 'text-green-500/70',
  reconnecting: 'text-amber-500',
  offline: 'text-red-500',
} as const;

function LiveIndicator() {
  const status = useCollabStore((s) => s.status);
  const synced = useCollabStore((s) => s.synced);
  const { label, tone } = connectionDisplay(status);

  return (
    <span
      className={clsx('ml-1 flex items-center gap-1.5 text-xs', TONE_CLASS[tone])}
      role="status"
      // Not shown: "Live" is the answer either way, and a label that flickered
      // between two words on every keystroke would be worse than one that
      // stands still. It is here because *something* has to be able to tell
      // "connected" from "connected and everything I did has arrived" — the
      // end-to-end tests wait on it where they used to wait on "Saved".
      data-collab-sync={synced ? 'synced' : 'pending'}
    >
      {tone === 'live' && <Check size={12} />}
      {tone === 'reconnecting' && <Loader2 size={12} className="animate-spin" />}
      {tone === 'offline' && <AlertTriangle size={12} />}
      {label}
    </span>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'saving') {
    return (
      <span className="ml-1 flex items-center gap-1.5 text-xs text-ink-600/50">
        <Loader2 size={12} className="animate-spin" /> Saving...
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="ml-1 flex items-center gap-1.5 text-xs text-green-500/70">
        <Check size={12} /> Saved
      </span>
    );
  }
  if (status === 'retrying') {
    // Amber, not red: the edit is not lost, the autosaver is still working on it.
    return (
      <span className="ml-1 flex items-center gap-1.5 text-xs text-amber-500">
        <Loader2 size={12} className="animate-spin" /> Retrying...
      </span>
    );
  }
  if (status === 'error') {
    return <span className="ml-1 text-xs text-red-500">Save failed</span>;
  }
  return null;
}
