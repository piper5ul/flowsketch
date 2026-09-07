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
import type { TableData } from '../types';

/** How wide a column starts out, and how far it can be dragged in. */
export const DEFAULT_COLUMN_WIDTH = 140;
export const MIN_COLUMN_WIDTH = 48;

/** How tall every row is drawn. Rows do not (yet) size themselves to content. */
export const DEFAULT_ROW_HEIGHT = 36;

/** The grid a fresh table is placed with: three by three, with a header. */
export const DEFAULT_TABLE_ROWS = 3;
export const DEFAULT_TABLE_COLUMNS = 3;

function blankRow(columns: number): { cells: string[] } {
  return { cells: Array.from({ length: columns }, () => '') };
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
  rows.splice(index, 0, blankRow(table.columns.length));
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
      return { cells };
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
    rows: table.rows.map((row) => ({ cells: row.cells.filter((_, i) => i !== index) })),
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
      i === row ? { cells: r.cells.map((cell, j) => (j === col ? text : cell)) } : r,
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
export function normalizeTable(table: TableData): TableData {
  const rows = table.rows.length > 0 ? table.rows : [{ cells: [] }];
  const width = Math.max(1, ...rows.map((row) => row.cells.length), table.columns.length);
  return {
    header: table.header,
    columns: Array.from({ length: width }, (_, i) => ({
      width: Math.max(MIN_COLUMN_WIDTH, Math.round(table.columns[i]?.width ?? DEFAULT_COLUMN_WIDTH)),
    })),
    rows: rows.map((row) => ({
      cells: Array.from({ length: width }, (_, i) => row.cells[i] ?? ''),
    })),
  };
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
