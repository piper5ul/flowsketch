/**
 * The dashboard's left rail: the fixed views (all, starred, shared) and the
 * user's own folders, with the controls that create, rename and delete them.
 *
 * It owns no data. Every folder here comes from the dashboard's state and
 * every change leaves through a callback, so the counts beside the names are
 * derived from the same diagram list the grid is rendering — a card moved into
 * a folder bumps the number next to it in the same render, rather than after a
 * round trip.
 */
import { useRef, useState } from 'react';
import clsx from 'clsx';
import { Folder, FolderPlus, LayoutGrid, MoreHorizontal, Pencil, Star, Trash2, Users } from 'lucide-react';
import type { FolderInfo } from '../../shared/types';
import type { FolderSelection } from '../lib/diagramList';
import { DIAGRAM_DRAG_TYPE, isDiagramDrag } from '../lib/diagramDrag';
import { MAX_FOLDER_NAME_CHARS } from '../../shared/types';

/** Two selections are the same row of the sidebar. */
function sameSelection(a: FolderSelection, b: FolderSelection): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'folder' || a.id === (b as { id: string }).id;
}

export interface FolderSidebarProps {
  folders: FolderInfo[];
  /** How many diagrams each folder holds, by id — see `countByFolder`. */
  counts: Map<string, number>;
  selection: FolderSelection;
  /** True while there is at least one diagram somebody else shared. */
  hasShared: boolean;
  onSelect: (selection: FolderSelection) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** A card was dropped on a row: file it there, or unfile it for `null`. */
  onDropDiagram: (folderId: string | null, diagramId: string) => void;
}

export function FolderSidebar({
  folders,
  counts,
  selection,
  hasShared,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onDropDiagram,
}: FolderSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  // The row a card is currently hovering over, so it can light up. `null` for
  // no drag, `'root'` for the "All diagrams" row — which unfiles rather than files.
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const closeMenu = () => {
    setMenuOpen(null);
    setConfirmingDelete(null);
  };

  /** Wires one row up as a drop target for `folderId` (`null` unfiles). */
  const dropProps = (key: string, folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!isDiagramDrag(e)) return;
      // Without this the browser refuses the drop entirely.
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((current) => (current === key ? null : current)),
    onDrop: (e: React.DragEvent) => {
      if (!isDiagramDrag(e)) return;
      e.preventDefault();
      setDropTarget(null);
      const diagramId = e.dataTransfer.getData(DIAGRAM_DRAG_TYPE);
      if (diagramId) onDropDiagram(folderId, diagramId);
    },
  });

  return (
    <nav aria-label="Folders" className="flex w-full shrink-0 flex-col gap-1 min-[880px]:w-56">
      <SidebarRow
        icon={<LayoutGrid size={15} />}
        label="All diagrams"
        selected={sameSelection(selection, { kind: 'all' })}
        highlighted={dropTarget === 'root'}
        onClick={() => onSelect({ kind: 'all' })}
        {...dropProps('root', null)}
      />
      <SidebarRow
        icon={<Star size={15} />}
        label="Starred"
        selected={sameSelection(selection, { kind: 'starred' })}
        onClick={() => onSelect({ kind: 'starred' })}
      />

      <p className="mt-4 px-3 text-[11px] font-semibold uppercase tracking-wide text-ink-600/60">
        Folders
      </p>

      {folders.length === 0 && !creating && (
        <p className="px-3 py-1.5 text-xs text-ink-600/70">No folders yet.</p>
      )}

      {folders.map((folder) => {
        const count = counts.get(folder.id) ?? 0;
        if (renaming === folder.id) {
          return (
            <div key={folder.id} className="px-1 py-0.5">
              <FolderNameInput
                initial={folder.name}
                label="Folder name"
                onCommit={(name) => {
                  setRenaming(null);
                  if (name !== folder.name) onRename(folder.id, name);
                }}
                onCancel={() => setRenaming(null)}
              />
            </div>
          );
        }
        return (
          <div key={folder.id} className="group/folder relative">
            <SidebarRow
              icon={<Folder size={15} />}
              label={folder.name}
              // The count rides in the accessible name rather than being a
              // decoration beside it: "which folder, holding how many" is one
              // piece of information, and a screen reader should hear both.
              accessibleName={`${folder.name}, ${count} ${count === 1 ? 'diagram' : 'diagrams'}`}
              count={count}
              selected={sameSelection(selection, { kind: 'folder', id: folder.id })}
              highlighted={dropTarget === folder.id}
              onClick={() => onSelect({ kind: 'folder', id: folder.id })}
              {...dropProps(folder.id, folder.id)}
            />
            <button
              aria-label={`Actions for ${folder.name}`}
              onClick={() => {
                if (menuOpen === folder.id) {
                  closeMenu();
                  return;
                }
                setMenuOpen(folder.id);
                setConfirmingDelete(null);
              }}
              className={clsx(
                'absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-ink-600/50 transition hover:bg-hover-strong hover:text-ink-900',
                menuOpen === folder.id ? 'opacity-100' : 'opacity-0 group-hover/folder:opacity-100 focus-visible:opacity-100',
              )}
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen === folder.id && (
              <div className="absolute right-1 top-9 z-50 w-52 rounded-lg bg-panel py-1 shadow-lg ring-1 ring-line-strong">
                {confirmingDelete === folder.id ? (
                  <div className="px-3 py-2">
                    <p className="mb-1 text-sm text-ink-900">Delete “{folder.name}”?</p>
                    <p className="mb-2 text-xs text-ink-600">
                      Its diagrams are kept — they move back to All diagrams.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        aria-label="Confirm delete folder"
                        onClick={() => {
                          closeMenu();
                          onDelete(folder.id);
                        }}
                        className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-red-700"
                      >
                        Delete
                      </button>
                      <button
                        onClick={closeMenu}
                        className="rounded-md px-2.5 py-1 text-xs font-medium text-ink-600 transition hover:bg-hover hover:text-ink-900"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        closeMenu();
                        setRenaming(folder.id);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-hover"
                    >
                      <Pencil size={13} /> Rename folder
                    </button>
                    <button
                      onClick={() => setConfirmingDelete(folder.id)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-danger-ink hover:bg-danger-wash"
                    >
                      <Trash2 size={13} /> Delete folder
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {creating ? (
        <div className="px-1 py-0.5">
          <FolderNameInput
            initial=""
            label="New folder name"
            onCommit={(name) => {
              setCreating(false);
              if (name !== '') onCreate(name);
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm font-medium text-ink-600 transition hover:bg-hover hover:text-ink-900"
        >
          <FolderPlus size={15} /> New folder
        </button>
      )}

      {hasShared && (
        <SidebarRow
          icon={<Users size={15} />}
          label="Shared with me"
          className="mt-4"
          selected={sameSelection(selection, { kind: 'shared' })}
          onClick={() => onSelect({ kind: 'shared' })}
        />
      )}
    </nav>
  );
}

/** One clickable row. The folder rows add a count and a drop target on top. */
function SidebarRow({
  icon,
  label,
  accessibleName,
  count,
  selected,
  highlighted,
  className,
  onClick,
  ...dnd
}: {
  icon: React.ReactNode;
  label: string;
  accessibleName?: string;
  count?: number;
  selected: boolean;
  highlighted?: boolean;
  className?: string;
  onClick: () => void;
} & Partial<Pick<React.HTMLAttributes<HTMLButtonElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'>>) {
  return (
    <button
      {...dnd}
      onClick={onClick}
      aria-label={accessibleName}
      aria-current={selected ? 'true' : undefined}
      className={clsx(
        'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition',
        selected ? 'bg-hover-strong font-semibold text-ink-900' : 'font-medium text-ink-600 hover:bg-hover hover:text-ink-900',
        // The drop target outranks the selection: while a card is over a row,
        // what matters is where it would land, not where the grid is.
        highlighted && 'ring-2 ring-accent-500/60',
        className,
      )}
    >
      <span className="shrink-0 text-ink-600/70">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span aria-hidden="true" className="shrink-0 text-xs tabular-nums text-ink-600/60">
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * The inline input behind "New folder" and "Rename folder".
 *
 * Enter and Escape both leave through blur, so there is one commit path
 * however the edit ends — the same shape the card's rename input uses.
 */
function FolderNameInput({
  initial,
  label,
  onCommit,
  onCancel,
}: {
  initial: string;
  label: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  // A ref rather than state: `blur()` fires synchronously, so a state update
  // made just before it would not be visible to the blur handler.
  const cancelled = useRef(false);

  return (
    <input
      autoFocus
      value={value}
      aria-label={label}
      maxLength={MAX_FOLDER_NAME_CHARS}
      placeholder="Folder name"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={() => (cancelled.current ? onCancel() : onCommit(value.trim()))}
      className="w-full rounded-lg border border-accent-500/40 bg-panel px-2 py-1.5 text-sm text-ink-900 outline-none placeholder:text-ink-600/50"
    />
  );
}
