// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from './table';
import { parseTableHtml as parseClipboardTableHtml } from './tableHtml';
import type { TableData } from '../types';

// The existing parser cases focus on the HTML-to-grid behavior, so model the
// matching text/plain grid that a spreadsheet puts beside those fixtures.
function parseTableHtml(html: string, plainText?: string): TableData | null {
  return parseClipboardTableHtml(html, plainText ?? tableHtmlAsPlainText(html));
}

function tableHtmlAsPlainText(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const table = document.querySelector('table');
  if (!table) return '';
  return Array.from(table.querySelectorAll('tr'))
    .filter((row) => row.closest('table') === table)
    .map((row) => Array.from(row.children)
      .filter((cell) => cell.tagName === 'TD' || cell.tagName === 'TH')
      .map((cell) => cell.textContent?.trim() ?? '')
      .join('\t'))
    .join('\n');
}

/** Excel for Mac 16 clipboard HTML: namespaced document, CSS classes, inline styles and col widths. */
const excelClipboard = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
  <meta name="ProgId" content="Excel.Sheet">
  <style>
    .xl65 { background: #203764; color: #FFFFFF; font-weight: 700; text-align: center; mso-pattern: black none; }
    .xl66 { font-weight: bold; }
    .xl67 { background: #FFF2CC; color: #0070C0; text-align: center; }
    .xl68 { background: rgb(255, 255, 0); font-weight: 700; mso-pattern: solid #FFFF00; }
    .xl69 { mso-horizontal-align: general; }
  </style>
</head>
<body>
  <table border="0" cellpadding="0" cellspacing="0">
    <col width="108"><col width="72"><col width="500"><col width="20">
    <tr><td class="xl65">Item</td><td class="xl65">Value</td><td class="xl65">Rate</td><td class="xl65">Amount</td></tr>
    <tr><td class="xl66" colspan="4"><b>Transaction Value</b></td></tr>
    <tr><td>Card present</td><td class="xl67">$0.12</td><td class="xl67">3.1%</td><td class="xl69">$0.12</td></tr>
    <tr><td class="xl66" colspan="4">Payzli Split</td></tr>
    <tr><td>Platform fee</td><td class="xl67">$-</td><td class="xl67">0.5%</td><td class="xl69">$-</td></tr>
    <tr><td class="xl66" colspan="4">Charges per transaction</td></tr>
    <tr><td>Authorization</td><td class="xl67">$0.12</td><td>General</td><td class="xl69">$0.12</td></tr>
    <tr><td>Other</td><td class="xl67">$-</td><td></td><td class="xl69">$-</td></tr>
    <tr><td class="xl68">Total</td><td class="xl68">$0.12</td><td class="xl68"></td><td class="xl68">$0.12</td></tr>
  </table>
</body>
</html>`;

const expected: TableData = {
  header: true,
  columns: [{ width: 108 }, { width: 72 }, { width: 400 }, { width: MIN_COLUMN_WIDTH }],
  rows: [
    {
      cells: ['Item', 'Value', 'Rate', 'Amount'],
      styles: [
        { bold: true, fill: '#203764', color: '#FFFFFF', align: 'center' },
        { bold: true, fill: '#203764', color: '#FFFFFF', align: 'center' },
        { bold: true, fill: '#203764', color: '#FFFFFF', align: 'center' },
        { bold: true, fill: '#203764', color: '#FFFFFF', align: 'center' },
      ],
    },
    { cells: ['Transaction Value', '', '', ''], styles: [{ bold: true }, null, null, null] },
    {
      cells: ['Card present', '$0.12', '3.1%', '$0.12'],
      styles: [null, { fill: '#FFF2CC', color: '#0070C0', align: 'center' }, { fill: '#FFF2CC', color: '#0070C0', align: 'center' }, { align: 'right' }],
    },
    { cells: ['Payzli Split', '', '', ''], styles: [{ bold: true }, null, null, null] },
    {
      cells: ['Platform fee', '$-', '0.5%', '$-'],
      styles: [null, { fill: '#FFF2CC', color: '#0070C0', align: 'center' }, { fill: '#FFF2CC', color: '#0070C0', align: 'center' }, { align: 'right' }],
    },
    { cells: ['Charges per transaction', '', '', ''], styles: [{ bold: true }, null, null, null] },
    {
      cells: ['Authorization', '$0.12', 'General', '$0.12'],
      styles: [null, { fill: '#FFF2CC', color: '#0070C0', align: 'center' }, null, { align: 'right' }],
    },
    {
      cells: ['Other', '$-', '', '$-'],
      styles: [null, { fill: '#FFF2CC', color: '#0070C0', align: 'center' }, null, { align: 'right' }],
    },
    {
      cells: ['Total', '$0.12', '', '$0.12'],
      styles: [
        { bold: true, fill: '#FFFF00' },
        { bold: true, fill: '#FFFF00' },
        { bold: true, fill: '#FFFF00' },
        { bold: true, fill: '#FFFF00' },
      ],
    },
  ],
};

describe('parseTableHtml', () => {
  it('reads Excel clipboard text, styles and widths into a rectangular table', () => {
    expect(parseTableHtml(excelClipboard)).toEqual(expected);
  });

  it('lets inline formatting override classes and reads nested font styles and named colors', () => {
    const parsed = parseTableHtml(`
      <html><head><style>.cell { color: blue; font-weight: 700; text-align: right; }</style></head>
      <body><table><tr><td class="cell" style="color: rgb(0, 112, 192); text-align: left"><i>Value</i></td><td><font color="red"><strong>Amount</strong></font></td></tr>
      <tr><td style="font-weight: 400; background: yellow">Input</td><td>($1,234.50)</td></tr></table></body></html>`);
    expect(parsed?.rows.map((row) => row.styles)).toEqual([
      [
        { bold: true, italic: true, color: '#0070C0', align: 'left' },
        { bold: true, color: '#FF0000' },
      ],
      [{ bold: false, fill: '#FFFF00' }, null],
    ]);
    expect(parsed?.rows[1].styles?.[1]).toBeNull();
  });

  it('matches bare table, row, cell, and header tag selectors', () => {
    const parsed = parseTableHtml(`
      <style>
        table { color: red; }
        tr { font-style: italic; }
        td { color: blue; text-align: right; }
        th { font-weight: bold; }
      </style>
      <table><tr><th>H1</th><th>H2</th></tr><tr><td>A</td><td>B</td></tr></table>`);

    expect(parsed?.rows.map((row) => row.styles)).toEqual([
      [{ bold: true, italic: true, color: '#FF0000' }, { bold: true, italic: true, color: '#FF0000' }],
      [{ italic: true, color: '#0000FF', align: 'right' }, { italic: true, color: '#0000FF', align: 'right' }],
    ]);
  });

  it('inherits table and row formatting in order, while keeping fills cell-local except for row backgrounds', () => {
    const parsed = parseTableHtml(`
      <style>
        table { color: red; font-weight: bold; font-style: italic; text-align: center; background: blue; }
        tr { color: green; background-color: yellow; }
        .own { color: blue; text-align: left; }
      </style>
      <table style="font-style: normal">
        <tr><td style="color: orange">A</td><td>B</td></tr>
        <tr style="color: purple; text-align: right; background: pink">
          <td class="own" style="color: orange">C</td><td><b style="color: black; font-weight: normal">D</b></td>
        </tr>
      </table>`);

    expect(parsed?.rows.map((row) => row.styles)).toEqual([
      [
        { bold: true, italic: false, fill: '#FFFF00', color: '#FFA500', align: 'center' },
        { bold: true, italic: false, fill: '#FFFF00', color: '#008000', align: 'center' },
      ],
      [
        { bold: true, italic: false, fill: '#FFC0CB', color: '#FFA500', align: 'left' },
        { bold: false, italic: false, fill: '#FFC0CB', color: '#000000', align: 'right' },
      ],
    ]);
  });

  it("keeps a cell's background over its row fill and ignores descendant backgrounds", () => {
    const parsed = parseTableHtml(`
      <style>tr { background: yellow; }</style>
      <table>
        <tr><td style="background: red">A</td><td><span style="background: blue">B</span></td></tr>
        <tr><td>C</td><td>D</td></tr>
      </table>`);

    expect(parsed?.rows.map((row) => row.styles)).toEqual([
      [{ fill: '#FF0000' }, { fill: '#FFFF00' }],
      [{ fill: '#FFFF00' }, { fill: '#FFFF00' }],
    ]);
  });

  it('resolves named colors deterministically without asking the DOM', () => {
    const getComputedStyle = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ color: '' } as CSSStyleDeclaration);
    const createElement = vi.spyOn(document, 'createElement');
    try {
      const parsed = parseTableHtml(`
        <table>
          <tr><td style="background: yellow; color: white">Yellow</td><td style="color: Navy">Navy</td></tr>
          <tr><td style="color: red">Red</td><td style="color: windowtext">Default</td></tr>
          <tr><td style="color: window">Default window</td><td style="color: auto">Automatic</td></tr>
        </table>`);

      expect(parsed?.rows.map((row) => row.styles)).toEqual([
        [{ fill: '#FFFF00', color: '#FFFFFF' }, { color: '#000080' }],
        [{ color: '#FF0000' }, null],
        [null, null],
      ]);
      expect(getComputedStyle).not.toHaveBeenCalled();
      expect(createElement).not.toHaveBeenCalled();
    } finally {
      getComputedStyle.mockRestore();
      createElement.mockRestore();
    }
  });

  it('resolves opaque rgb() and rgba() values to the same stored hex format', () => {
    const parsed = parseTableHtml(`
      <table>
        <tr><td style="color: rgb(0, 112, 192)">RGB</td><td style="color: rgba(0, 112, 192, 1)">RGBA</td></tr>
        <tr><td style="color: rgb(100% 0% 0%)">Percent RGB</td><td style="color: rgba(0 0 255 / 100%)">Percent RGBA</td></tr>
      </table>`);

    expect(parsed?.rows.map((row) => row.styles)).toEqual([
      [{ color: '#0070C0' }, { color: '#0070C0' }],
      [{ color: '#FF0000' }, { color: '#0000FF' }],
    ]);
  });

  it('keeps the yellow Total row from an Excel-style named-color fixture', () => {
    const parsed = parseTableHtml(`
      <html><head><style>.xlTotal { background: yellow; font-weight: 700; }</style></head>
      <body><table>
        <tr><td>Item</td><td>Amount</td></tr>
        <tr><td class="xlTotal">Total</td><td class="xlTotal">$0.12</td></tr>
      </table></body></html>`);

    expect(parsed?.rows[1].cells).toEqual(['Total', '$0.12']);
    expect(parsed?.rows[1].styles).toEqual([
      { bold: true, fill: '#FFFF00' },
      { bold: true, fill: '#FFFF00' },
    ]);
  });

  it('expands colspans, uses default widths, and falls back to text parsing for header choice', () => {
    const parsed = parseTableHtml('<table><col width="10"><tr><td>Value</td><td colspan="2">Note</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>', 'Value\t\tNote\n1\t2\t3');
    expect(parsed?.columns.map((column) => column.width)).toEqual([MIN_COLUMN_WIDTH, DEFAULT_COLUMN_WIDTH, DEFAULT_COLUMN_WIDTH]);
    expect(parsed?.rows.map((row) => row.cells)).toEqual([['Value', 'Note', ''], ['1', '2', '3']]);
    expect(parsed?.header).toBe(true);
  });

  it('places cells after rowspans into the next available grid slot', () => {
    const parsed = parseTableHtml(`
      <table>
        <tr><td rowspan="2">A</td><td>B</td></tr>
        <tr><td>C</td></tr>
      </table>`, 'A\tB\n\tC');

    expect(parsed?.rows.map((row) => row.cells)).toEqual([['A', 'B'], ['', 'C']]);
  });

  it('uses right alignment for numeric general-aligned cells, but not text', () => {
    const parsed = parseTableHtml('<table><tr><td style="mso-horizontal-align:general">$0.12</td><td style="mso-horizontal-align:general">Label</td><td style="mso-horizontal-align:general">$-</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>');
    expect(parsed?.rows[0].styles).toEqual([{ align: 'right' }, null, { align: 'right' }]);
  });

  it('returns null when the clipboard HTML has no table', () => {
    expect(parseTableHtml('<p>Not a table</p>')).toBeNull();
  });

  it('returns null for a single copied spreadsheet cell', () => {
    expect(parseTableHtml('<table><tr><td>Only cell</td></tr></table>')).toBeNull();
  });

  it('mirrors the text parser refusal for a single-row table', () => {
    expect(parseTableHtml('<table><tr><td>Name</td><td>Role</td></tr></table>')).toBeNull();
  });

  it('mirrors the text parser refusal for a one-column table', () => {
    expect(parseTableHtml('<table><tr><td>First</td></tr><tr><td>Second</td></tr></table>')).toBeNull();
  });

  it('requires at least two rows and two columns that contain text', () => {
    expect(parseTableHtml('<table><tr><td>A</td><td></td></tr><tr><td>B</td><td></td></tr></table>')).toBeNull();
    expect(parseTableHtml('<table><tr><td>A</td><td>B</td></tr><tr><td></td><td></td></tr></table>')).toBeNull();
  });

  it('refuses an unmarked navigation table when plain text is not a table', () => {
    const navigation = `
      <table>
        <tr><td><a href="/">Home</a></td><td><a href="/products">Products</a></td></tr>
        <tr><td><a href="/about">About</a></td><td><a href="/contact">Contact</a></td></tr>
      </table>`;

    expect(parseTableHtml(navigation, 'Home Products About Contact')).toBeNull();
  });

  it.each([
    ['Excel namespace', '<html xmlns:x="urn:schemas-microsoft-com:office:excel">'],
    ['Excel ProgId', '<html><head><meta name="ProgId" content="Excel.Sheet"></head>'],
    ['Google Sheets', '<html><head><meta name="google-sheets-html-origin" content="1.0"></head>'],
  ])('accepts a %s table when plain text has no tabs', (_origin, prefix) => {
    const html = `${prefix}<body><table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table></body></html>`;

    expect(parseTableHtml(html, 'A B C D')?.rows.map((row) => row.cells)).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ]);
  });

  it.each([
    ['nested table', '<table><tr><td><table><tr><td>Nested</td><td>Grid</td></tr></table></td><td>Sidebar</td></tr><tr><td>Footer</td><td>Link</td></tr></table>'],
    ['image', '<table><tr><td>Logo <img src="logo.png" alt="Logo"></td><td>Navigation</td></tr><tr><td>Article</td><td>Footer</td></tr></table>'],
    ['unordered list', '<table><tr><td><ul><li>First</li><li>Second</li></ul></td><td>Navigation</td></tr><tr><td>Article</td><td>Footer</td></tr></table>'],
    ['ordered list', '<table><tr><td><ol><li>First</li><li>Second</li></ol></td><td>Navigation</td></tr><tr><td>Article</td><td>Footer</td></tr></table>'],
  ])('returns null when table cells contain a %s', (_kind, html) => {
    expect(parseTableHtml(html)).toBeNull();
  });

  it('handles an 80 KB style block without braces quickly', () => {
    const html = `<style>${'x'.repeat(80_000)}</style><table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>`;
    const started = performance.now();
    const parsed = parseClipboardTableHtml(html, 'A\tB\nC\tD');
    const elapsed = performance.now() - started;

    expect(parsed?.rows.map((row) => row.cells)).toEqual([['A', 'B'], ['C', 'D']]);
    expect(elapsed).toBeLessThan(3_000);
  }, 15_000);

  it('ignores comments and at-rule blocks while scanning CSS', () => {
    const parsed = parseTableHtml(`
      <style>
        /* .cell { background: red; } */
        @media screen { .cell { color: red; } }
        @font-face { font-family: ignored; src: url(ignored.woff); }
        .cell { color: blue; }
      </style>
      <table><tr><td class="cell">A</td><td class="cell">B</td></tr><tr><td>C</td><td>D</td></tr></table>`);
    expect(parsed?.rows[0].styles).toEqual([{ color: '#0000FF' }, { color: '#0000FF' }]);
  });

  it('indexes 2,000 CSS rules instead of checking every rule against 2,000 cells', () => {
    const css = Array.from({ length: 2_000 }, (_, index) => `.unused${index}{color:red}`).join('');
    const row = '<tr><td class="target">A</td><td class="target">B</td></tr>';
    const html = `<style>${css}</style><table>${row.repeat(1_000)}</table>`;
    const plain = Array.from({ length: 1_000 }, () => 'A\tB').join('\n');
    const contains = vi.spyOn(DOMTokenList.prototype, 'contains');
    let parsed: TableData | null;
    try {
      parsed = parseClipboardTableHtml(html, plain);
    } finally {
      contains.mockRestore();
    }

    expect(parsed?.rows).toHaveLength(1_000);
    // Structural, not timed: no cell is matched against the unused rules.
    expect(contains).toHaveBeenCalledTimes(0);
  }, 15_000);

  it('falls back when 2,000 unindexed selectors would scan every cell', () => {
    const css = Array.from({ length: 2_000 }, (_, index) => `custom${index}{color:red}`).join('');
    const row = '<tr><td>A</td><td>B</td></tr>';
    const html = `<style>${css}</style><table>${row.repeat(1_000)}</table>`;
    const plain = Array.from({ length: 1_000 }, () => 'A\tB').join('\n');
    const started = performance.now();
    const parsed = parseClipboardTableHtml(html, plain);
    const elapsed = performance.now() - started;

    expect(parsed === null).toBe(true);
    expect(elapsed).toBeLessThan(3_000);
  }, 15_000);

  it('falls back for HTML larger than 2 MB before parsing it', () => {
    const parseFromString = vi.spyOn(DOMParser.prototype, 'parseFromString');
    try {
      expect(parseClipboardTableHtml(`<table>${'x'.repeat(2 * 1024 * 1024)}</table>`, '') === null).toBe(true);
      expect(parseFromString.mock.calls.length).toBe(0);
    } finally {
      parseFromString.mockRestore();
    }
  });

  it('falls back when a clipboard style block contains more than 5,000 rules', () => {
    const css = Array.from({ length: 5_001 }, (_, index) => `.unused${index}{color:red}`).join('');
    expect(parseTableHtml(`<style>${css}</style><table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>`)).toBeNull();
  });

  it('falls back when the table grid would exceed 10,000 cells', () => {
    const row = '<tr><td>A</td><td>B</td></tr>';
    expect(parseTableHtml(`<table>${row.repeat(5_001)}</table>`) === null).toBe(true);
  });
});
