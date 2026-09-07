import { useCallback, useEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import clsx from 'clsx';
import type { ShapeNode as ShapeNodeType } from '../store/useDiagramStore';
import { useDiagramStore } from '../store/useDiagramStore';
import { useSearchHighlight } from '../store/useSearchStore';
import { peerOutlineStyle, usePeerSelection } from '../store/useCollabStore';
import { resolveFontSize } from '../lib/text';
import {
  DEFAULT_ROW_HEIGHT,
  MIN_COLUMN_WIDTH,
  addRow,
  emptyTable,
  isHeaderRow,
  setCell,
  setColumnWidth,
} from '../lib/table';
import type { TableData } from '../types';

/** Where the cursor is inside this table. `null` while no cell is being edited. */
interface CellRef {
  row: number;
  col: number;
}

const HANDLES: { id: string; position: Position; style: React.CSSProperties }[] = [
  { id: 'top', position: Position.Top, style: { top: -5, left: '50%', transform: 'translateX(-50%)' } },
  { id: 'right', position: Position.Right, style: { right: -5, top: '50%', transform: 'translateY(-50%)' } },
  { id: 'bottom', position: Position.Bottom, style: { bottom: -5, left: '50%', transform: 'translateX(-50%)' } },
  { id: 'left', position: Position.Left, style: { left: -5, top: '50%', transform: 'translateY(-50%)' } },
];

/** How wide the invisible strip on a column's border is, in px. */
const RESIZE_GRIP = 8;

/**
 * A table: one object on the board holding a grid of editable cells.
 *
 * **The node's box is the grid**, not the other way round: width is the sum of
 * the column widths and height is a row per row (`tableSize`), which the store
 * keeps in step on every write, and no resizer is offered — dragging a column
 * border is how a table is made wider. That is what lets everything that reads
 * a node's box (connectors, alignment, the minimap, export bounds) go on
 * knowing nothing about tables.
 *
 * **The colours are the frame's idiom, not the shape's.** Body cells take the
 * theme's panel and rule; a header wears a toned-down `color-mix` of the user's
 * fill over it, and the rules a toned-down mix of their stroke — so a table
 * reads as structure in either theme, and the palette still does something.
 * (An export pins the light theme, so a dark-mode user's PNG is not dark.)
 *
 * Editing is one cell at a time: click to put the cursor in a cell,
 * double-click — or Enter, which the `edit.editText` command turns into
 * `editingNodeId` like it does for a label — to open it. Tab moves right and
 * adds a row past the last cell the way a spreadsheet does, ⇧Tab moves back,
 * Enter moves down, Escape stops. Every one of those commits through
 * `updateNodeData`, and an unchanged cell commits nothing (`setCell` returns
 * the grid it was given), so the blur that follows a Tab is free.
 */
export function TableNode({ id, data, selected }: NodeProps<ShapeNodeType>) {
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
  const updateNodeDataTransient = useDiagramStore((s) => s.updateNodeDataTransient);
  const beginInteraction = useDiagramStore((s) => s.beginInteraction);
  const editingNodeId = useDiagramStore((s) => s.editingNodeId);
  const setEditingNodeId = useDiagramStore((s) => s.setEditingNodeId);
  const setActiveTableCell = useDiagramStore((s) => s.setActiveTableCell);
  const readOnly = useDiagramStore((s) => s.readOnly);
  const searchHit = useSearchHighlight('node', id);
  const peerSelection = usePeerSelection(id);

  const [editing, setEditing] = useState<CellRef | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // What the grid was when the current write started, so a Tab that both
  // commits a cell and adds a row composes the two into one patch.
  const table: TableData = data.table ?? emptyTable(1, 1, false);
  const tableRef = useRef(table);
  tableRef.current = table;

  const canEdit = !readOnly && !data.locked;
  const fontSize = resolveFontSize(data.fontSize);

  const openCell = useCallback(
    (cell: CellRef) => {
      if (!canEdit) return;
      setActiveTableCell({ nodeId: id, ...cell });
      setDraft(tableRef.current.rows[cell.row]?.cells[cell.col] ?? '');
      setEditing(cell);
    },
    [canEdit, id, setActiveTableCell],
  );

  const stopEditing = useCallback(() => {
    setEditing(null);
    setEditingNodeId(null);
  }, [setEditingNodeId]);

  /** The current draft into the grid, and whatever else the caller wants doing to it. */
  const commit = useCallback(
    (cell: CellRef, value: string, then: (next: TableData) => TableData = (t) => t) => {
      const next = then(setCell(tableRef.current, cell.row, cell.col, value));
      updateNodeData(id, { table: next });
      return next;
    },
    [id, updateNodeData],
  );

  // Enter on a selected table runs `edit.editText`, the same command a shape's
  // label answers to, which sets `editingNodeId`. Opening from that rather than
  // from a keydown of our own is what keeps one list of shortcuts.
  useEffect(() => {
    if (editingNodeId !== id || editing) return;
    const active = useDiagramStore.getState().activeTableCell;
    const cell = active?.nodeId === id ? { row: active.row, col: active.col } : { row: 0, col: 0 };
    openCell(cell);
  }, [editingNodeId, id, editing, openCell]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  /** Tab / ⇧Tab / Enter: commit, then put the cursor where the key points. */
  const move = useCallback(
    (cell: CellRef, direction: 'next' | 'previous' | 'down') => {
      const columns = tableRef.current.columns.length;
      const rows = tableRef.current.rows.length;

      if (direction === 'down') {
        commit(cell, draft);
        if (cell.row + 1 >= rows) { stopEditing(); return; }
        openCell({ row: cell.row + 1, col: cell.col });
        return;
      }

      if (direction === 'previous') {
        commit(cell, draft);
        const flat = cell.row * columns + cell.col - 1;
        if (flat < 0) { stopEditing(); return; }
        openCell({ row: Math.floor(flat / columns), col: flat % columns });
        return;
      }

      // Past the last cell of the last row, Tab adds a row — what every
      // spreadsheet does, and the quickest way to type a table in. The new row
      // and the cell just typed are **one** patch, so ⌘Z takes back one thing.
      const flat = cell.row * columns + cell.col + 1;
      const grew = flat >= rows * columns;
      commit(cell, draft, (next) => (grew ? addRow(next) : next));
      openCell({ row: Math.floor(flat / columns), col: flat % columns });
    },
    [commit, draft, openCell, stopEditing],
  );

  /**
   * Dragging a column's right-hand border. One history entry, pushed before the
   * first frame, and then a transient write per pointermove — the same shape as
   * every other drag in the app (see the undo conventions in CLAUDE.md).
   */
  const beginResize = useCallback(
    (event: React.PointerEvent, col: number) => {
      if (!canEdit || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = tableRef.current.columns[col]?.width ?? MIN_COLUMN_WIDTH;
      // The board can be zoomed, so a pixel on screen is not a pixel on the
      // board: the drag is scaled by whatever zoom the canvas is at.
      const zoom = useDiagramStore.getState().viewport?.zoom ?? 1;
      beginInteraction();

      const onMove = (e: PointerEvent) => {
        updateNodeDataTransient(id, {
          table: setColumnWidth(tableRef.current, col, startWidth + (e.clientX - startX) / (zoom || 1)),
        });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [beginInteraction, canEdit, id, updateNodeDataTransient],
  );

  const tinted = data.fill !== 'transparent';
  const rule = data.stroke !== 'transparent'
    ? `color-mix(in srgb, ${data.stroke} 55%, var(--line))`
    : 'var(--line)';
  const headerBackground = tinted
    ? `color-mix(in srgb, ${data.fill} 45%, var(--panel))`
    : 'var(--hover-soft)';

  let offset = 0;

  return (
    <div
      data-node-type="table"
      data-search-hit={searchHit}
      data-peer-selected={peerSelection?.name}
      className="shape-wrapper relative h-full w-full overflow-hidden rounded-lg"
      style={{
        ...peerOutlineStyle(peerSelection),
        background: 'var(--panel)',
        border: `1px solid ${rule}`,
        boxShadow: selected ? '0 0 0 1.5px var(--color-accent-500)' : undefined,
        opacity: data.opacity ?? 1,
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <table
        className="h-full w-full table-fixed border-collapse text-ink-800"
        style={{ fontSize }}
      >
        <colgroup>
          {table.columns.map((column, col) => (
            <col key={col} style={{ width: column.width }} />
          ))}
        </colgroup>
        <tbody>
          {table.rows.map((row, rowIndex) => {
            const header = isHeaderRow(table, rowIndex);
            return (
              <tr key={rowIndex} style={{ height: DEFAULT_ROW_HEIGHT }}>
                {row.cells.map((cell, col) => {
                  const open = editing?.row === rowIndex && editing.col === col;
                  return (
                    <td
                      key={col}
                      style={{
                        borderRight: col < table.columns.length - 1 ? `1px solid ${rule}` : undefined,
                        borderBottom: rowIndex < table.rows.length - 1 ? `1px solid ${rule}` : undefined,
                        background: header ? headerBackground : undefined,
                        textAlign: data.textAlign ?? 'left',
                        padding: 0,
                      }}
                      onPointerDown={() => setActiveTableCell({ nodeId: id, row: rowIndex, col })}
                      onDoubleClick={() => openCell({ row: rowIndex, col })}
                    >
                      {open ? (
                        <input
                          ref={inputRef}
                          // `nodrag`/`nopan` or a text selection inside the cell
                          // would drag the table around instead.
                          className="nodrag nopan h-full w-full bg-transparent px-2 text-inherit outline-none"
                          style={{ fontSize, textAlign: data.textAlign ?? 'left' }}
                          aria-label={`Row ${rowIndex + 1} column ${col + 1}`}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => { commit({ row: rowIndex, col }, draft); setEditing(null); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Tab') {
                              e.preventDefault();
                              move({ row: rowIndex, col }, e.shiftKey ? 'previous' : 'next');
                            } else if (e.key === 'Enter') {
                              e.preventDefault();
                              move({ row: rowIndex, col }, 'down');
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              commit({ row: rowIndex, col }, draft);
                              stopEditing();
                            }
                          }}
                        />
                      ) : (
                        <div
                          className={clsx(
                            'h-full w-full truncate px-2 leading-[normal]',
                            header && 'font-semibold',
                          )}
                          style={{
                            color: data.textColor,
                            fontWeight: header ? 600 : data.bold ? 700 : undefined,
                            fontStyle: data.italic ? 'italic' : undefined,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent:
                              (data.textAlign ?? 'left') === 'center'
                                ? 'center'
                                : (data.textAlign ?? 'left') === 'right'
                                  ? 'flex-end'
                                  : 'flex-start',
                          }}
                        >
                          {cell}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* One grip per column border, sitting over the rule. Hidden from a
          viewer and from a locked table, which have nothing to drag. */}
      {canEdit &&
        table.columns.map((column, col) => {
          offset += column.width;
          return (
            <div
              key={col}
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize column ${col + 1}`}
              className="nodrag nopan absolute top-0 h-full cursor-col-resize"
              style={{ left: offset - RESIZE_GRIP / 2, width: RESIZE_GRIP }}
              onPointerDown={(e) => beginResize(e, col)}
            />
          );
        })}

      {HANDLES.map((h) => (
        <Handle key={h.id} id={h.id} type="source" position={h.position} className="shape-handle" style={h.style} />
      ))}
    </div>
  );
}
