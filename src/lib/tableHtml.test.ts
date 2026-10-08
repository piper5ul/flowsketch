// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from './table';
import { parseTableHtml } from './tableHtml';
import type { TableData } from '../types';

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
    const parsed = parseTableHtml('<table><col width="10"><tr><td>Value</td><td colspan="2">Note</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>');
    expect(parsed?.columns.map((column) => column.width)).toEqual([MIN_COLUMN_WIDTH, DEFAULT_COLUMN_WIDTH, DEFAULT_COLUMN_WIDTH]);
    expect(parsed?.rows.map((row) => row.cells)).toEqual([['Value', 'Note', ''], ['1', '2', '3']]);
    expect(parsed?.header).toBe(true);
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

  it.each([
    ['nested table', '<table><tr><td><table><tr><td>Nested</td><td>Grid</td></tr></table></td><td>Sidebar</td></tr><tr><td>Footer</td><td>Link</td></tr></table>'],
    ['image', '<table><tr><td>Logo <img src="logo.png" alt="Logo"></td><td>Navigation</td></tr><tr><td>Article</td><td>Footer</td></tr></table>'],
    ['unordered list', '<table><tr><td><ul><li>First</li><li>Second</li></ul></td><td>Navigation</td></tr><tr><td>Article</td><td>Footer</td></tr></table>'],
    ['ordered list', '<table><tr><td><ol><li>First</li><li>Second</li></ol></td><td>Navigation</td></tr><tr><td>Article</td><td>Footer</td></tr></table>'],
  ])('returns null when table cells contain a %s', (_kind, html) => {
    expect(parseTableHtml(html)).toBeNull();
  });
});
