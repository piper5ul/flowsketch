import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_ROW_HEIGHT,
  MIN_COLUMN_WIDTH,
  addColumn,
  addRow,
  emptyTable,
  isHeaderRow,
  normalizeTable,
  parseTableText,
  removeColumn,
  removeRow,
  setCell,
  setColumnWidth,
  tableCells,
  tableSize,
} from './table';
import type { TableData } from '../types';

/** A grid from its rows, every column at the default width. */
function grid(rows: string[][], header = false): TableData {
  return normalizeTable({ header, columns: [], rows: rows.map((cells) => ({ cells })) });
}

const text = (table: TableData) => table.rows.map((row) => row.cells);

describe('emptyTable', () => {
  it('is a grid of blanks with a header row', () => {
    const table = emptyTable(3, 3);
    expect(table.header).toBe(true);
    expect(table.columns).toHaveLength(3);
    expect(text(table)).toEqual([['', '', ''], ['', '', ''], ['', '', '']]);
  });

  it('never makes a table with no cells at all', () => {
    expect(text(emptyTable(0, 0))).toEqual([['']]);
  });
});

describe('addRow', () => {
  it('adds a blank row at the end by default', () => {
    expect(text(addRow(grid([['a', 'b']])))).toEqual([['a', 'b'], ['', '']]);
  });

  it('inserts at an index, pushing what was there down', () => {
    expect(text(addRow(grid([['a'], ['b']]), 1))).toEqual([['a'], [''], ['b']]);
  });

  it('clamps an index past either end rather than leaving a hole', () => {
    expect(text(addRow(grid([['a']]), 99))).toEqual([['a'], ['']]);
    expect(text(addRow(grid([['a']]), -4))).toEqual([[''], ['a']]);
  });
});

describe('removeRow', () => {
  it('removes the last row by default', () => {
    expect(text(removeRow(grid([['a'], ['b']])))).toEqual([['a']]);
  });

  it('removes the row at an index', () => {
    expect(text(removeRow(grid([['a'], ['b'], ['c']]), 1))).toEqual([['a'], ['c']]);
  });

  it('refuses to take the last row, and says so by reference', () => {
    // The identity is what makes this cost no history entry: `updateNodeData`
    // skips a patch whose value is already there.
    const table = grid([['a']]);
    expect(removeRow(table)).toBe(table);
  });
});

describe('addColumn / removeColumn', () => {
  it('widens every row at once', () => {
    const table = addColumn(grid([['a', 'b'], ['c', 'd']]), 1);
    expect(text(table)).toEqual([['a', '', 'b'], ['c', '', 'd']]);
    expect(table.columns).toHaveLength(3);
    expect(table.columns[1].width).toBe(DEFAULT_COLUMN_WIDTH);
  });

  it('narrows every row at once', () => {
    const table = removeColumn(grid([['a', 'b', 'c'], ['d', 'e', 'f']]), 0);
    expect(text(table)).toEqual([['b', 'c'], ['e', 'f']]);
    expect(table.columns).toHaveLength(2);
  });

  it('refuses to take the last column', () => {
    const table = grid([['a'], ['b']]);
    expect(removeColumn(table)).toBe(table);
  });
});

describe('setCell', () => {
  it('writes one cell and leaves the rest alone', () => {
    expect(text(setCell(grid([['a', 'b'], ['c', 'd']]), 1, 0, 'X'))).toEqual([['a', 'b'], ['X', 'd']]);
  });

  it('returns the same table when the text is already there', () => {
    const table = grid([['a']]);
    expect(setCell(table, 0, 0, 'a')).toBe(table);
  });

  it('returns the same table for coordinates off the grid', () => {
    const table = grid([['a']]);
    expect(setCell(table, 4, 0, 'x')).toBe(table);
    expect(setCell(table, 0, 4, 'x')).toBe(table);
  });
});

describe('setColumnWidth', () => {
  it('sets one column and rounds to a whole pixel', () => {
    expect(setColumnWidth(grid([['a', 'b']]), 1, 220.4).columns[1].width).toBe(220);
  });

  it('never goes below the minimum', () => {
    expect(setColumnWidth(grid([['a']]), 0, 4).columns[0].width).toBe(MIN_COLUMN_WIDTH);
  });

  it('returns the same table when nothing moves', () => {
    const table = grid([['a']]);
    expect(setColumnWidth(table, 0, DEFAULT_COLUMN_WIDTH)).toBe(table);
    expect(setColumnWidth(table, 9, 200)).toBe(table);
  });
});

describe('tableSize', () => {
  it('is the columns across and a row per row', () => {
    const table = grid([['a', 'b'], ['c', 'd'], ['e', 'f']]);
    expect(tableSize(table)).toEqual({
      width: DEFAULT_COLUMN_WIDTH * 2,
      height: DEFAULT_ROW_HEIGHT * 3,
    });
  });

  it('follows a resized column', () => {
    expect(tableSize(setColumnWidth(grid([['a', 'b']]), 0, 200)).width).toBe(200 + DEFAULT_COLUMN_WIDTH);
  });
});

describe('isHeaderRow / tableCells', () => {
  it('calls only the first row a header, and only when there is one', () => {
    expect(isHeaderRow(grid([['a'], ['b']], true), 0)).toBe(true);
    expect(isHeaderRow(grid([['a'], ['b']], true), 1)).toBe(false);
    expect(isHeaderRow(grid([['a'], ['b']], false), 0)).toBe(false);
  });

  it('reads every cell row by row', () => {
    expect(tableCells(grid([['a', 'b'], ['c', 'd']]))).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('normalizeTable', () => {
  it('squares up a ragged grid, padding short rows', () => {
    const table = normalizeTable({ header: false, columns: [], rows: [{ cells: ['a'] }, { cells: ['b', 'c', 'd'] }] });
    expect(text(table)).toEqual([['a', '', ''], ['b', 'c', 'd']]);
    expect(table.columns).toHaveLength(3);
  });

  it('gives an empty grid one cell rather than nothing', () => {
    expect(text(normalizeTable({ header: false, columns: [], rows: [] }))).toEqual([['']]);
  });

  it('keeps stored widths and clamps a nonsensical one', () => {
    const table = normalizeTable({
      header: false,
      columns: [{ width: 200 }, { width: 2 }],
      rows: [{ cells: ['a', 'b'] }],
    });
    expect(table.columns.map((c) => c.width)).toEqual([200, MIN_COLUMN_WIDTH]);
  });
});

describe('parseTableText — Markdown', () => {
  it('reads a pipe table with a rule row as a table with a header', () => {
    const table = parseTableText('| Name | Role |\n| --- | --- |\n| Ada | Maths |\n| Alan | Machines |')!;
    expect(table.header).toBe(true);
    expect(text(table)).toEqual([['Name', 'Role'], ['Ada', 'Maths'], ['Alan', 'Machines']]);
  });

  it('accepts the alignment spellings of the rule row', () => {
    expect(parseTableText('| a | b |\n|:--|--:|\n| 1 | 2 |')!.header).toBe(true);
    expect(parseTableText('| a | b |\n|:-:|:-:|\n| 1 | 2 |')!.header).toBe(true);
  });

  it('reads pipes with no outer bars, and trims each cell', () => {
    const table = parseTableText('a |  b\n---|---\n 1 | 2 ')!;
    expect(text(table)).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('reads a pipe block with no rule row as a table with no header', () => {
    const table = parseTableText('| a | b |\n| c | d |')!;
    expect(table.header).toBe(false);
    expect(text(table)).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('squares up a table whose rows are not all the same width', () => {
    expect(text(parseTableText('| a | b | c |\n| --- | --- | --- |\n| 1 |')!)).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
    ]);
  });
});

describe('parseTableText — TSV and CSV', () => {
  it('reads what a spreadsheet puts on the clipboard', () => {
    const table = parseTableText('Name\tRole\nAda\tMaths\nAlan\tMachines')!;
    expect(table.header).toBe(true);
    expect(text(table)).toEqual([['Name', 'Role'], ['Ada', 'Maths'], ['Alan', 'Machines']]);
  });

  it('reads a CSV', () => {
    expect(text(parseTableText('a,b\n1,2')!)).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps a comma inside a quoted field', () => {
    expect(text(parseTableText('name,note\n"Ada, Countess",first\n"x","y"')!)).toEqual([
      ['name', 'note'],
      ['Ada, Countess', 'first'],
      ['x', 'y'],
    ]);
  });

  it('reads "" inside a quoted field as one quote', () => {
    expect(text(parseTableText('a,b\n"she said ""hi""",2')!)).toEqual([['a', 'b'], ['she said "hi"', '2']]);
  });

  it('keeps a newline inside a quoted field in the same cell', () => {
    expect(text(parseTableText('a,b\n"one\ntwo",2')!)).toEqual([['a', 'b'], ['one\ntwo', '2']]);
  });

  it('ignores a trailing newline rather than making an empty row', () => {
    expect(text(parseTableText('a,b\n1,2\n')!)).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('prefers tabs to commas, so a comma inside a TSV cell stays text', () => {
    expect(text(parseTableText('a\tb\nAda, Countess\t2')!)).toEqual([['a', 'b'], ['Ada, Countess', '2']]);
  });
});

describe('parseTableText — what is not a table', () => {
  it('refuses a single line, whatever it is separated by', () => {
    expect(parseTableText('a,b,c')).toBeNull();
    expect(parseTableText('a\tb\tc')).toBeNull();
    expect(parseTableText('| a | b |')).toBeNull();
  });

  it('refuses plain prose', () => {
    expect(parseTableText('Hello there.\nHow are you?')).toBeNull();
    expect(parseTableText('')).toBeNull();
  });

  it('refuses a ragged block of delimited text — a real CSV is rectangular', () => {
    expect(parseTableText('a,b\n1,2,3')).toBeNull();
  });

  it('refuses a single column of lines', () => {
    expect(parseTableText('milk\neggs\nbread')).toBeNull();
  });

  it('refuses a bulleted list, which is what "paste as sticky notes" is for', () => {
    expect(parseTableText('- milk\n- eggs\n- bread')).toBeNull();
  });
});
