/**
 * Tables: the grid inside a `table` node, and the text that becomes one.
 *
 * Pure and structural the way `arrange.ts` and `search.ts` are — this is handed
 * a `TableData` and returns another, so every rule below can be stated over
 * plain objects and tested without a board behind them. The store is what turns
 * one of these into an edit (and what keeps the node's box in step; see
 * `tableSize`), and `TableNode.tsx` is what draws it.
 *
 * **Every function here returns the table it was given, by reference, when the
 * change would be a no-op.** That is not a micro-optimisation: `updateNodeData`
 * skips a patch whose values are already there (`isNoOpPatch`, `Object.is`), so
 * an unchanged cell commits nothing and costs the user no ⌘Z — which is what
 * lets a cell editor commit on blur *and* on Tab without recording twice.
 *
 * **Rows and columns are always rectangular**: every row holds exactly one
 * entry per column. Nothing outside this module writes a `TableData`, so that
 * is an invariant rather than a hope — with one door for the untrusted case,
 * `normalizeTable`, which is what a pasted or hand-edited grid comes through.
 */
import type { TableCellStyle, TableData } from '../types.js';

/** How wide a column starts out, and how far it can be dragged in. */
export const DEFAULT_COLUMN_WIDTH = 140;
export const MIN_COLUMN_WIDTH = 48;

/** How tall every row is drawn. Rows do not (yet) size themselves to content. */
export const DEFAULT_ROW_HEIGHT = 36;

/** The grid a fresh table is placed with: three by three, with a header. */
export const DEFAULT_TABLE_ROWS = 3;
export const DEFAULT_TABLE_COLUMNS = 3;

function blankRow(columns: number, withStyles = false): TableData['rows'][number] {
  return {
    cells: Array.from({ length: columns }, () => ''),
    ...(withStyles ? { styles: Array.from({ length: columns }, () => null) } : {}),
  };
}

/** `rows` × `cols` of empty cells, with the first row drawn as a header. */
export function emptyTable(
  rows = DEFAULT_TABLE_ROWS,
  cols = DEFAULT_TABLE_COLUMNS,
  header = true,
): TableData {
  return {
    columns: Array.from({ length: Math.max(1, cols) }, () => ({ width: DEFAULT_COLUMN_WIDTH })),
    rows: Array.from({ length: Math.max(1, rows) }, () => blankRow(Math.max(1, cols))),
    header,
  };
}

/** Where an index lands once it is clamped into `[0, length]`. */
function clampIndex(at: number | undefined, length: number): number {
  if (at === undefined || !Number.isFinite(at)) return length;
  return Math.min(Math.max(Math.trunc(at), 0), length);
}

/**
 * A blank row inserted at `at` — by default after the last one, which is what
 * the toolbar's "Add row" means with no cell focused.
 */
export function addRow(table: TableData, at?: number): TableData {
  const index = clampIndex(at, table.rows.length);
  const rows = [...table.rows];
  rows.splice(index, 0, blankRow(table.columns.length, table.rows.some((row) => row.styles !== undefined)));
  return { ...table, rows };
}

/**
 * The row at `at` removed — the last one by default.
 *
 * A table with no rows is not a table, so the last row is never taken: the
 * table comes back unchanged, and the caller records nothing.
 */
export function removeRow(table: TableData, at?: number): TableData {
  if (table.rows.length <= 1) return table;
  const index = Math.min(clampIndex(at, table.rows.length - 1), table.rows.length - 1);
  return { ...table, rows: table.rows.filter((_, i) => i !== index) };
}

/** A blank column inserted at `at` — by default after the last one. */
export function addColumn(table: TableData, at?: number): TableData {
  const index = clampIndex(at, table.columns.length);
  const columns = [...table.columns];
  columns.splice(index, 0, { width: DEFAULT_COLUMN_WIDTH });
  return {
    ...table,
    columns,
    rows: table.rows.map((row) => {
      const cells = [...row.cells];
      cells.splice(index, 0, '');
      if (row.styles === undefined) return { cells };
      const styles = [...row.styles];
      styles.splice(index, 0, null);
      return { cells, styles };
    }),
  };
}

/** The column at `at` removed — the last one by default, never the only one. */
export function removeColumn(table: TableData, at?: number): TableData {
  if (table.columns.length <= 1) return table;
  const index = Math.min(clampIndex(at, table.columns.length - 1), table.columns.length - 1);
  return {
    ...table,
    columns: table.columns.filter((_, i) => i !== index),
    rows: table.rows.map((row) => ({
      cells: row.cells.filter((_, i) => i !== index),
      ...(row.styles === undefined ? {} : { styles: row.styles.filter((_, i) => i !== index) }),
    })),
  };
}

/** `text` in one cell. Out-of-range coordinates, and text already there, change nothing. */
export function setCell(table: TableData, row: number, col: number, text: string): TableData {
  const target = table.rows[row];
  if (!target || col < 0 || col >= table.columns.length) return table;
  if (target.cells[col] === text) return table;
  return {
    ...table,
    rows: table.rows.map((r, i) =>
      i === row ? { ...r, cells: r.cells.map((cell, j) => (j === col ? text : cell)) } : r,
    ),
  };
}

/** One column's width, never below `MIN_COLUMN_WIDTH`. */
export function setColumnWidth(table: TableData, col: number, width: number): TableData {
  const column = table.columns[col];
  if (!column) return table;
  const next = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
  if (column.width === next) return table;
  return {
    ...table,
    columns: table.columns.map((c, i) => (i === col ? { ...c, width: next } : c)),
  };
}

/** Whether `row` is the header row — the first one, when the table has one. */
export function isHeaderRow(table: TableData, row: number): boolean {
  return table.header && row === 0;
}

/**
 * The box the node has to be, given its grid: the columns across and the rows
 * down. A table has no free size of its own — the resizer is not offered for
 * one — so the store keeps `width`/`height` in step on every table change,
 * which is what lets connectors, alignment, export bounds and the minimap all
 * go on reading a node's box and knowing nothing about tables.
 */
export function tableSize(table: TableData, rowHeight = DEFAULT_ROW_HEIGHT): { width: number; height: number } {
  return {
    width: table.columns.reduce((sum, column) => sum + column.width, 0),
    height: table.rows.length * rowHeight,
  };
}

/** Every cell, row by row — what search reads, and what an export of the text would. */
export function tableCells(table: TableData): string[] {
  return table.rows.flatMap((row) => row.cells);
}

/**
 * Whatever came out of a JSON column or a paste, made rectangular.
 *
 * `Diagram.data` is free-form and a document is written by other browsers, so a
 * grid arriving from outside this module may be ragged, empty or missing its
 * widths. Rows are padded and clipped to the widest one, and a table with
 * nothing in it becomes a 1×1 — a node drawn as an empty box is far worse to
 * meet than one blank cell.
 */
export function normalizeTable(value: unknown): TableData {
  const input = isRecord(value) ? value : {};
  const inputColumns: unknown[] = Array.isArray(input.columns) ? input.columns : [];
  const inputRows: unknown[] = Array.isArray(input.rows) ? input.rows : [];
  // A table without rows is empty even if stale column metadata remains. Give
  // it the same one-cell shape as any other empty input.
  const rows: Array<{ cells: unknown[]; styles?: unknown[] }> = inputRows.length === 0
    ? [{ cells: [] }]
    : inputRows.map((value) => {
      if (!isRecord(value)) return { cells: [] };
      return {
        cells: Array.isArray(value.cells) ? value.cells : [],
        ...(Array.isArray(value.styles) ? { styles: value.styles } : {}),
      };
    });
  const width = inputRows.length === 0
    ? 1
    : Math.max(1, inputColumns.length, ...rows.map((row) => row.cells.length));
  const header = Boolean(input.header);

  const alreadyNormalized = isRecord(value)
    && input.header === header
    && Array.isArray(input.columns)
    && input.columns.length === width
    && input.columns.every((column) => isRecord(column)
      && typeof column.width === 'number'
      && Number.isFinite(column.width)
      && Number.isInteger(column.width)
      && column.width >= MIN_COLUMN_WIDTH)
    && Array.isArray(input.rows)
    && input.rows.length > 0
    && input.rows.every((row) => isRecord(row)
      && Array.isArray(row.cells)
      && row.cells.length === width
      && row.cells.every((cell) => typeof cell === 'string')
      && (row.styles === undefined
        ? !Object.prototype.hasOwnProperty.call(row, 'styles')
        : Array.isArray(row.styles)
          && row.styles.length === width
          && row.styles.every(isNarrowCellStyle)));
  if (alreadyNormalized) return value as unknown as TableData;

  return {
    header,
    columns: Array.from({ length: width }, (_, i) => {
      const column = inputColumns[i];
      const storedWidth = isRecord(column) ? column.width : undefined;
      return {
        width: typeof storedWidth === 'number' && Number.isFinite(storedWidth)
          ? Math.max(MIN_COLUMN_WIDTH, Math.round(storedWidth))
          : DEFAULT_COLUMN_WIDTH,
      };
    }),
    rows: rows.map((row) => ({
      cells: Array.from({ length: width }, (_, i) => {
        const cell = row.cells[i];
        return typeof cell === 'string' ? cell : typeof cell === 'number' ? String(cell) : '';
      }),
      ...(row.styles === undefined
        ? {}
        : { styles: Array.from({ length: width }, (_, i) => narrowCellStyle(row.styles?.[i])) }),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A free-form JSON cell style, reduced to the five values the renderer uses. */
function narrowCellStyle(value: unknown): TableCellStyle | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const style: TableCellStyle = {};
  if (typeof input.bold === 'boolean') style.bold = input.bold;
  if (typeof input.italic === 'boolean') style.italic = input.italic;
  if (typeof input.fill === 'string' && /^#[\da-f]{6}$/i.test(input.fill)) style.fill = input.fill;
  if (typeof input.color === 'string' && /^#[\da-f]{6}$/i.test(input.color)) style.color = input.color;
  if (input.align === 'left' || input.align === 'center' || input.align === 'right') style.align = input.align;
  return Object.keys(style).length > 0 ? style : null;
}

function isNarrowCellStyle(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const original = value as Record<string, unknown>;
  const narrowed = narrowCellStyle(value);
  return narrowed !== null
    && Object.keys(original).length === Object.keys(narrowed).length
    && Object.entries(narrowed).every(([key, item]) => original[key] === item);
}

// ---- parsing ---------------------------------------------------------------

/**
 * A table in `text`, or `null` when there is not one.
 *
 * Three spellings, tried in that order, because they are what actually reaches
 * a clipboard: a **Markdown pipe table**, the **TSV** that Google Docs, Word,
 * Notion and every spreadsheet put on `text/plain` when a table is copied, and
 * **CSV**. The first that answers wins; Markdown goes first because a pipe
 * table has a shape nothing else does, and TSV before CSV because a tab is a
 * far stronger signal of a grid than a comma is.
 *
 * A single line is never a table, whatever it is separated by: one row of
 * anything is a sentence far more often than it is a spreadsheet. Delimited
 * text needs at least two columns as well, and needs to be **rectangular** —
 * every line with the same number of fields — which is what a real CSV is and
 * what two lines of prose that happen to hold commas are usually not.
 */
export function parseTableText(text: string): TableData | null {
  return parseMarkdownTable(text) ?? parseDelimited(text, '\t') ?? parseDelimited(text, ',');
}

/** The `|---|` rule under a Markdown table's header: `---`, `:--`, `--:`, `:-:`. */
function isRuleCell(cell: string): boolean {
  return /^:?-+:?$/.test(cell);
}

/**
 * One `| a | b |` line, as its cells.
 *
 * The outer pipes are optional (both GitHub and most editors write them, and
 * some tools do not). An escaped `\|` inside a cell is **not** handled: a pipe
 * in a cell of a pasted table is rare enough that the honest failure — one cell
 * split in two — is better than a parser nobody can predict.
 */
function pipeCells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body.split('|').map((cell) => cell.trim());
}

function parseMarkdownTable(text: string): TableData | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  if (lines.length < 2 || !lines.every((line) => line.includes('|'))) return null;

  const grid = lines.map(pipeCells);
  const ruled = grid[1].length > 0 && grid[1].every(isRuleCell);
  // Without a rule row the block is only a table if it reads like one: at least
  // two columns, which is what tells `| a |` — a line of prose in a quote — from
  // a grid somebody meant.
  if (!ruled && grid.some((row) => row.length < 2)) return null;

  const rows = ruled ? [grid[0], ...grid.slice(2)] : grid;
  if (rows.length === 0) return null;
  return normalizeTable({
    header: ruled,
    columns: [],
    rows: rows.map((cells) => ({ cells })),
  });
}

/**
 * `text` split on `delimiter`, honouring RFC 4180 quoting: a field may be
 * wrapped in `"`, inside which `""` is a literal quote and a newline is part of
 * the field rather than the end of the row.
 */
function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') { field += ch; continue; }
      if (text[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    // A quote only opens a field at its start; one in the middle of `a"b` is
    // just a character, which is what a spreadsheet's own export assumes too.
    if (ch === '"' && field === '') { quoted = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  row.push(field);
  rows.push(row);

  // A trailing newline is punctuation, not an empty row.
  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell.trim() === '')) rows.pop();
  return rows;
}

function parseDelimited(text: string, delimiter: string): TableData | null {
  if (!text.includes(delimiter)) return null;
  const rows = splitDelimited(text, delimiter).map((cells) => cells.map((cell) => cell.trim()));
  if (rows.length < 2 || rows[0].length < 2) return null;
  // Rectangular or nothing — see `parseTableText`.
  if (rows.some((cells) => cells.length !== rows[0].length)) return null;

  // **The first row is taken as a header**, deliberately and always: a grid
  // copied out of a spreadsheet or a document has one far more often than not,
  // there is nothing in the text that says so either way, and guessing from the
  // contents (numbers below, words above) would be a rule nobody could predict.
  // The toolbar's header toggle is one click when it is wrong.
  return normalizeTable({ header: true, columns: [], rows: rows.map((cells) => ({ cells })) });
}
