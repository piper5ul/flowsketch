/**
 * Version history: what this diagram looked like before, and putting one of
 * those states back.
 *
 * A snapshot is taken automatically at most once per editing burst
 * (`server/versions.ts`), so this list is a handful of entries a day rather
 * than one per autosave — which is why it can be a flat list with no paging.
 *
 * Reading it is a viewer's right: being shown what a board looked like last
 * week is the same permission as being shown what it looks like now. Taking a
 * snapshot and restoring one are writes, so they are an editor's.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, GitFork, History, Loader2, Pause, Play, RotateCcw, X } from 'lucide-react';
import { api, ConflictError } from '../lib/api';
import { isCanvasPointerActive, subscribeCanvasPointerState } from '../lib/canvasPointerState';
import { migrateDiagramData } from '../lib/diagramMigrations';
import { MAX_VERSION_LABEL_CHARS, describeVersion, scrubIndex } from '../lib/versionHistory';
import { buildVersionPreview } from '../lib/versionPreview';
import { hasUncoveredLocalUpdates } from '../lib/collab/stateVector';
import { getBoundDocument } from '../store/useCollabStore';
import {
  flushPendingDiagramTitle,
  isDocumentBound,
  prepareCanvasForVersionRestore,
  useDiagramStore,
} from '../store/useDiagramStore';
import { toastError } from '../store/useToastStore';
import type { DiagramVersion, DiagramVersionMeta } from '../../shared/types';

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const diagramId = useDiagramStore((s) => s.diagramId);
  const readOnly = useDiagramStore((s) => s.readOnly);
  const boardTitle = useDiagramStore((s) => s.title);

  const [versions, setVersions] = useState<DiagramVersionMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [canvasPointerActive, setCanvasPointerActive] = useState(isCanvasPointerActive);
  const [label, setLabel] = useState('');
  /** The version whose preview is open, and the body once it has arrived. */
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<DiagramVersion | null>(null);
  /** The version whose "are you sure?" is showing. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** Whether the scrubber is stepping through the versions on its own. */
  const [playing, setPlaying] = useState(false);
  const navigate = useNavigate();

  useEffect(() => subscribeCanvasPointerState(setCanvasPointerActive), []);

  const refresh = useCallback(async () => {
    if (!diagramId) return;
    try {
      setVersions(await api.listVersions(diagramId));
    } catch {
      setVersions([]);
      toastError('Could not load this diagram\'s history.');
    }
  }, [diagramId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // Captured, so Escape closes the panel without also reaching the canvas
      // behind it and clearing the selection.
      event.stopPropagation();
      event.preventDefault();
      onClose();
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const snapshot = useCallback(async () => {
    if (!diagramId) return;
    setBusy(true);
    try {
      // The server snapshots the row as it stands, so anything still sitting
      // in the autosave debounce would be missing from the snapshot the user
      // just asked for. Flushed first, and a failure there is reported by
      // `saveDiagram` itself.
      await useDiagramStore.getState().saveDiagram();
      await api.createVersion(diagramId, label.trim() || undefined);
      setLabel('');
      await refresh();
    } catch {
      toastError('Could not take a snapshot.');
    } finally {
      setBusy(false);
    }
  }, [diagramId, label, refresh]);

  const openPreview = useCallback(
    async (versionId: string) => {
      if (!diagramId) return;
      // A second click on the open one closes it.
      if (previewId === versionId) {
        setPreviewId(null);
        setPreview(null);
        return;
      }
      setPreviewId(versionId);
      setPreview(null);
      try {
        const version = await api.getVersion(diagramId, versionId);
        // The user can have moved on while this was in flight.
        setPreviewId((current) => {
          if (current === versionId) setPreview(version);
          return current;
        });
      } catch {
        toastError('Could not load that version.');
        setPreviewId(null);
      }
    },
    [diagramId, previewId],
  );

  /** Opens `versionId`'s preview (the row's own click toggles; the scrubber only ever shows). */
  const showPreview = useCallback(
    async (versionId: string) => {
      if (!diagramId || previewId === versionId) return;
      setPreviewId(versionId);
      setPreview(null);
      try {
        const version = await api.getVersion(diagramId, versionId);
        setPreviewId((current) => {
          if (current === versionId) setPreview(version);
          return current;
        });
      } catch {
        toastError('Could not load that version.');
        setPreviewId(null);
      }
    },
    [diagramId, previewId],
  );

  // The list is newest first; the scrubber runs oldest → newest, so its index
  // counts from the end of the list.
  const count = versions?.length ?? 0;
  const scrubAt = useMemo(() => {
    if (!versions || previewId === null) return count - 1;
    const i = versions.findIndex((v) => v.id === previewId);
    return i === -1 ? count - 1 : count - 1 - i;
  }, [versions, previewId, count]);
  const scrubTo = useCallback(
    (index: number) => {
      if (!versions || versions.length === 0) return;
      const clamped = scrubIndex(index, 0, versions.length);
      void showPreview(versions[versions.length - 1 - clamped].id);
    },
    [versions, showPreview],
  );
  useEffect(() => {
    if (!playing) return;
    if (scrubAt >= count - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => scrubTo(scrubAt + 1), 1200);
    return () => window.clearTimeout(timer);
  }, [playing, scrubAt, count, scrubTo]);

  const fork = useCallback(
    async (versionId: string) => {
      if (!diagramId) return;
      setBusy(true);
      try {
        const copy = await api.forkVersion(diagramId, versionId);
        navigate(`/d/${copy.id}`);
      } catch {
        toastError('Could not fork that version.');
      } finally {
        setBusy(false);
      }
    },
    [diagramId, navigate],
  );

  const restore = useCallback(
    async (versionId: string) => {
      if (!diagramId) return;
      const stopForCanvasPointer = () => {
        if (!isCanvasPointerActive()) return false;
        toastError("Finish what you're doing, then restore");
        return true;
      };
      if (stopForCanvasPointer()) return;
      setBusy(true);
      try {
        const prepareLiveRestore = async (): Promise<boolean> => {
          if (!isDocumentBound()) {
            toastError('Reconnect to restore a version');
            return false;
          }
          if (stopForCanvasPointer()) return false;
          prepareCanvasForVersionRestore();
          // Editable labels commit synchronously on blur; this lets their
          // unmount cleanup finish before the title and provider flushes.
          await Promise.resolve();
          if (stopForCanvasPointer()) return false;
          if (!(await flushPendingDiagramTitle())) {
            toastError("Couldn't save the diagram title");
            return false;
          }
          if (stopForCanvasPointer()) return false;
          // A bound save waits until the provider has sent this window's
          // document updates. Never fall through to a row data save if the
          // binding disappeared while title persistence was pending.
          if (!isDocumentBound()) {
            toastError('Reconnect to restore a version');
            return false;
          }
          if (await useDiagramStore.getState().saveDiagram() !== 'saved') {
            toastError(isDocumentBound() ? 'Could not restore that version.' : 'Reconnect to restore a version');
            return false;
          }
          if (stopForCanvasPointer()) return false;
          return true;
        };

        const applyLiveResponse = (data: unknown, serverStateVector: string): 'applied' | 'stale' | 'aborted' => {
          // This whole response check is synchronous: committing editors can
          // add local Yjs updates, and the state vector must be compared after
          // those commits and immediately before the one undoable apply.
          if (stopForCanvasPointer()) return 'aborted';
          prepareCanvasForVersionRestore();
          const document = getBoundDocument();
          if (!document) {
            toastError('Reconnect to restore a version');
            return 'aborted';
          }
          if (hasUncoveredLocalUpdates(Y.encodeStateVector(document), serverStateVector)) return 'stale';
          if (!useDiagramStore.getState().applyVersionRestore(data)) {
            toastError(isDocumentBound() ? 'Could not restore that version.' : 'Reconnect to restore a version');
            return 'aborted';
          }
          return 'applied';
        };

        const restoreLiveVersion = async (): Promise<boolean> => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            if (!(await prepareLiveRestore())) return false;
            const restored = await api.restoreVersion(diagramId, versionId);
            if (!('sv' in restored)) {
              toastError('Reconnect to restore a version');
              return false;
            }
            const result = applyLiveResponse(restored.data, restored.sv);
            if (result === 'applied') return true;
            if (result === 'aborted') {
              // The server already persisted its live snapshot. Keep history
              // current if a pointer gesture or a binding change prevented
              // this response from being applied.
              await refresh();
              return false;
            }
          }
          toastError('The board is busy, try restoring again');
          await refresh();
          return false;
        };

        if (isDocumentBound()) {
          if (!(await restoreLiveVersion())) return;
        } else {
          // The row-based route returns the persisted title alongside restored
          // content, so commit this window's title before the server reads it.
          if (!(await flushPendingDiagramTitle())) {
            toastError("Couldn't save the diagram title");
            return;
          }
          const restored = await api.restoreVersion(diagramId, versionId);
          if ('sv' in restored) {
            // A document may have connected while the row request was in
            // flight. Discard this response and restart through the bound
            // preparation and sync path before taking a fresh server snapshot.
            if (!isDocumentBound()) {
              toastError('Reconnect to restore a version');
              return;
            }
            if (!(await restoreLiveVersion())) return;
          } else {
            if (isDocumentBound()) {
              toastError('Reconnect to restore a version');
              return;
            }
            // `viewerId` travels with the role and the token for the reason both
            // of those do: a restore changes content, never who is reading it.
            // Read the title now so an edit made while the row request was in
            // flight wins over the older title attached to its response.
            const { title, starred, role, shareToken, viewerId } = useDiagramStore.getState();
            useDiagramStore
              .getState()
              .loadDiagram(restored.id, title, starred, restored.data, restored.updatedAt, {
                role,
                shareToken,
                viewerId,
              });
            // The row-based restore wrote the Diagram row, so advance the
            // conflict guard before its next autosave.
            if (restored.updatedAt) useDiagramStore.getState().noteSaved(restored.updatedAt);
          }
        }
        setConfirming(null);
        setPreviewId(null);
        setPreview(null);
        // The restore left a "Before restore" entry that is not in this list yet.
        await refresh();
      } catch (error) {
        toastError(error instanceof ConflictError ? 'Reconnect to restore a version' : 'Could not restore that version.');
      } finally {
        setBusy(false);
      }
    },
    [diagramId, refresh],
  );

  return (
    <aside
      role="dialog"
      aria-label="Version history"
      className="panel-in pointer-events-auto fixed right-0 top-0 z-30 flex h-screen w-[22rem] flex-col border-l border-line bg-panel/95 shadow-[-12px_0_40px_-20px_rgba(10,10,25,0.35)] backdrop-blur"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink-900">
            <History size={15} /> Version history
          </h2>
          <p className="truncate pl-5 text-[12px] text-ink-600">
            Board title: {boardTitle}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close history"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-700/50 transition hover:bg-hover hover:text-ink-700"
        >
          <X size={15} />
        </button>
      </header>

      {!readOnly && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={MAX_VERSION_LABEL_CHARS}
            aria-label="Snapshot label"
            placeholder="Label (optional)"
            className="min-w-0 flex-1 rounded-lg bg-panel px-2.5 py-1.5 text-[13px] text-ink-900 ring-1 ring-line-strong outline-none placeholder:text-ink-600/40 focus:ring-accent-500/40"
          />
          <button
            type="button"
            onClick={snapshot}
            disabled={busy}
            className="shrink-0 rounded-lg bg-accent-500 px-2.5 py-1.5 text-[13px] font-semibold text-white transition hover:bg-accent-600 disabled:opacity-50"
          >
            Snapshot now
          </button>
        </div>
      )}

      {versions !== null && versions.length > 1 && (
        <div
          role="group"
          aria-label="Scrub through versions"
          className="flex shrink-0 items-center gap-1.5 border-b border-line px-3 py-2"
        >
          <button
            type="button"
            aria-label="Older version"
            disabled={scrubAt <= 0}
            onClick={() => scrubTo(scrubAt - 1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-700 transition hover:bg-hover disabled:opacity-30"
          >
            <ChevronLeft size={15} />
          </button>
          <input
            type="range"
            aria-label="Version"
            min={0}
            max={count - 1}
            value={Math.max(0, scrubAt)}
            onChange={(event) => {
              setPlaying(false);
              scrubTo(Number(event.target.value));
            }}
            className="min-w-0 flex-1 accent-accent-500"
          />
          <button
            type="button"
            aria-label="Newer version"
            disabled={scrubAt >= count - 1}
            onClick={() => scrubTo(scrubAt + 1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-700 transition hover:bg-hover disabled:opacity-30"
          >
            <ChevronRight size={15} />
          </button>
          <button
            type="button"
            aria-label={playing ? 'Pause' : 'Play through history'}
            aria-pressed={playing}
            onClick={() => {
              // Play from the beginning once the end has been reached.
              if (!playing && scrubAt >= count - 1) scrubTo(0);
              setPlaying((p) => !p);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-700 transition hover:bg-hover"
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <span className="ml-1 shrink-0 tabular-nums text-[12px] text-ink-600">
            {Math.max(0, scrubAt) + 1} / {count}
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {versions === null ? (
          <p className="flex items-center gap-2 px-2 py-3 text-[13px] text-ink-600">
            <Loader2 size={13} className="animate-spin" /> Loading…
          </p>
        ) : versions.length === 0 ? (
          <p className="px-2 py-3 text-[13px] text-ink-600">
            No versions yet. One is kept for each burst of editing, and you can take your own at any
            time.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {versions.map((version) => (
              <VersionRow
                key={version.id}
                version={version}
                canRestore={!readOnly}
                busy={busy}
                canvasPointerActive={canvasPointerActive}
                previewOpen={previewId === version.id}
                preview={previewId === version.id ? preview : null}
                confirming={confirming === version.id}
                onPreview={() => openPreview(version.id)}
                onRequestRestore={() => setConfirming(version.id)}
                onCancelRestore={() => setConfirming(null)}
                onRestore={() => restore(version.id)}
                onFork={() => fork(version.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function VersionRow({
  version,
  canRestore,
  busy,
  canvasPointerActive,
  previewOpen,
  preview,
  confirming,
  onPreview,
  onRequestRestore,
  onCancelRestore,
  onRestore,
  onFork,
}: {
  version: DiagramVersionMeta;
  canRestore: boolean;
  busy: boolean;
  canvasPointerActive: boolean;
  previewOpen: boolean;
  preview: DiagramVersion | null;
  confirming: boolean;
  onPreview: () => void;
  onRequestRestore: () => void;
  onCancelRestore: () => void;
  onRestore: () => void;
  onFork: () => void;
}) {
  const beforeRestore = version.label === 'Before restore';

  return (
    <li className="rounded-lg px-2 py-2 transition hover:bg-hover-soft">
      <p className="text-[13px] font-medium text-ink-900">{describeVersion(version)}</p>
      {beforeRestore && (
        <p className="truncate text-[12px] text-ink-600/70">Title before restore: {version.title}</p>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={onPreview}
          aria-expanded={previewOpen}
          className="rounded-md px-2 py-0.5 text-[12px] font-medium text-ink-700 ring-1 ring-line-strong transition hover:bg-hover"
        >
          Preview
        </button>
        {canRestore && !confirming && (
          <button
            type="button"
            onClick={onRequestRestore}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium text-ink-700 ring-1 ring-line-strong transition hover:bg-hover"
          >
            <RotateCcw size={11} /> Restore
          </button>
        )}
        {!confirming && (
          <button
            type="button"
            onClick={onFork}
            disabled={busy}
            title="A new diagram of your own holding this version"
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium text-ink-700 ring-1 ring-line-strong transition hover:bg-hover disabled:opacity-50"
          >
            <GitFork size={11} /> Fork
          </button>
        )}
      </div>

      {confirming && (
        <div className="mt-2 rounded-lg bg-warn-wash px-2.5 py-2 ring-1 ring-warn-ink/25">
          {/* Said out loud because it is the reassurance that makes the button
              pressable: the current state is captured alongside the restore
              and saved to history too. */}
          <p className="mb-2 text-[12px] text-warn-ink">
            {canvasPointerActive
              ? "Finish what you're doing, then restore"
              : "Restore this version's content? Your current content will be saved to history too. The board title stays the same."}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRestore}
              disabled={busy || canvasPointerActive}
              className="rounded-md bg-amber-600 px-2 py-0.5 text-[12px] font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
            >
              Restore this version
            </button>
            <button
              type="button"
              onClick={onCancelRestore}
              className="rounded-md px-2 py-0.5 text-[12px] font-medium text-warn-ink transition hover:bg-warn-ink/15"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {previewOpen && <VersionPreview version={preview} />}
    </li>
  );
}

/** Every preview draws in this box; the `viewBox` does the scaling. */
const PREVIEW_CLASS = 'mt-2 flex h-40 items-center justify-center rounded-lg bg-canvas ring-1 ring-line';

/**
 * The version's own board, drawn small — boxes and centre-to-centre lines,
 * from `buildVersionPreview`. See that module for why this is not React Flow.
 */
function VersionPreview({ version }: { version: DiagramVersion | null }) {
  const geometry = useMemo(() => {
    if (!version) return null;
    try {
      // A snapshot can hold any format this app has ever written, and one from
      // a newer build throws — which is a preview that cannot be shown, not a
      // panel that should come down.
      return buildVersionPreview(migrateDiagramData(version.data));
    } catch {
      return null;
    }
  }, [version]);

  if (!version) {
    return (
      <div className={`${PREVIEW_CLASS} text-[12px] text-ink-600`}>
        <Loader2 size={13} className="mr-1.5 animate-spin" /> Loading preview…
      </div>
    );
  }

  if (!geometry) {
    return (
      <div className={`${PREVIEW_CLASS} px-3 text-center text-[12px] text-ink-600`}>
        Nothing to show for this version.
      </div>
    );
  }

  return (
    <div className={PREVIEW_CLASS}>
      <svg
        viewBox={geometry.viewBox}
        role="img"
        aria-label="Version preview"
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Connectors first, so a shape is never drawn over by the line into it. */}
        {geometry.lines.map((line) => (
          <line
            key={line.id}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={line.stroke}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {geometry.boxes.map((box) => (
          <rect
            key={box.id}
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            rx={4}
            fill={box.fill}
            stroke={box.stroke}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}
