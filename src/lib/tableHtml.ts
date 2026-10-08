/**
 * Read the cell text and the small set of visual styles we keep from rich
 * spreadsheet clipboard HTML. This module is client only: it needs
 * `DOMParser`, so it must stay out of the server's import graph.
 */
import type { TableCellStyle, TableData } from '../types';
import { DEFAULT_COLUMN_WIDTH, MIN_COLUMN_WIDTH, normalizeTable, parseTableText } from './table';

interface CssRule {
  selectors: string[];
  declarations: string;
}

interface ParsedStyle {
  bold?: boolean;
  italic?: boolean;
  fill?: string;
  color?: string;
  align?: TableCellStyle['align'] | 'general';
}

/**
 * Parse an HTML clipboard fragment into a rectangular table, or return null
 * when it does not contain a table. Excel writes much of its formatting in
 * class rules and the rest inline; inline declarations are applied last.
 */
export function parseTableHtml(html: string): TableData | null {
  if (typeof DOMParser === 'undefined' || !html.trim()) return null;

  let document: Document;
  try {
    document = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }

  const table = document.querySelector('table');
  if (!table) return null;

  const rules = readCssRules(document);
  const htmlRows = Array.from(table.querySelectorAll('tr')).filter((row) => row.closest('table') === table);
  const parsedRows: { cells: string[]; styles: (TableCellStyle | null)[] }[] = [];

  for (const htmlRow of htmlRows) {
    const cells: string[] = [];
    const styles: (TableCellStyle | null)[] = [];
    const htmlCells = Array.from(htmlRow.children).filter((child) => child.tagName === 'TD' || child.tagName === 'TH');
    for (const htmlCell of htmlCells) {
      const text = displayedText(htmlCell);
      const cellStyle = readCellStyle(htmlCell, rules, text);
      cells.push(text);
      styles.push(cellStyle);

      const colspan = positiveSpan(htmlCell.getAttribute('colspan'));
      for (let i = 1; i < colspan; i++) {
        cells.push('');
        styles.push(null);
      }
    }
    if (cells.length > 0) parsedRows.push({ cells, styles });
  }

  if (parsedRows.length === 0) return null;
  const width = Math.max(1, ...parsedRows.map((row) => row.cells.length));
  const widths = readColumnWidths(table, width);
  const hasAnyStyle = parsedRows.some((row) => row.styles.some((style) => style !== null));
  const rows = parsedRows.map((row) => ({
    cells: Array.from({ length: width }, (_, index) => row.cells[index] ?? ''),
    ...(hasAnyStyle
      ? { styles: Array.from({ length: width }, (_, index) => row.styles[index] ?? null) }
      : {}),
  }));

  const plainText = rows.map((row) => row.cells.join('\t')).join('\n');
  const textTable = parseTableText(plainText);
  const header = rows.length > 1 && hasHeaderStyleDifference(rows[0].styles, rows[1].styles)
    ? true
    : (textTable?.header ?? false);

  return normalizeTable({ header, columns: widths.map((width) => ({ width })), rows });
}

function readCssRules(document: Document): CssRule[] {
  const rules: CssRule[] = [];
  for (const style of Array.from(document.querySelectorAll('style'))) {
    const css = style.textContent?.replace(/\/\*[\s\S]*?\*\//g, '') ?? '';
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = match[1].split(',').map((selector) => selector.trim()).filter(Boolean);
      if (selectors.length > 0) rules.push({ selectors, declarations: match[2] });
    }
  }
  return rules;
}

function selectorMatchesElement(selector: string, element: Element): boolean {
  // The clipboard styles we need are class rules such as `.xl65` or
  // `td.xl65`. Ignore ancestor selectors and pseudo-classes.
  const target = selector.trim().split(/[\s>+~]+/).at(-1)?.replace(/:{1,2}[\w-]+(?:\([^)]*\))?/g, '') ?? '';
  const tag = target.match(/^[a-z][\w-]*/i)?.[0];
  if (tag && tag.toLowerCase() !== element.tagName.toLowerCase()) return false;
  const classes = Array.from(target.matchAll(/\.([\w-]+)/g), (match) => match[1]);
  return classes.length > 0 && classes.every((className) => element.classList.contains(className));
}

function readCellStyle(cell: Element, rules: CssRule[], text: string): TableCellStyle | null {
  const style: ParsedStyle = {};
  for (const element of [cell, ...Array.from(cell.querySelectorAll('*'))]) {
    const elementStyle: ParsedStyle = {};
    for (const rule of rules) {
      if (rule.selectors.some((selector) => selectorMatchesElement(selector, element))) {
        applyDeclarations(elementStyle, rule.declarations);
      }
    }

    if (element.tagName === 'FONT') {
      const color = element.getAttribute('color');
      if (color) {
        const normalized = normalizeColor(color);
        if (normalized) elementStyle.color = normalized;
      }
    }
    const inline = element.getAttribute('style');
    if (inline) applyDeclarations(elementStyle, inline);

    if (element.tagName === 'B' || element.tagName === 'STRONG') {
      if (elementStyle.bold === undefined) elementStyle.bold = true;
    }
    if (element.tagName === 'I' || element.tagName === 'EM') {
      if (elementStyle.italic === undefined) elementStyle.italic = true;
    }
    Object.assign(style, elementStyle);
  }

  if (style.align === 'general') style.align = isNumericDisplay(text) ? 'right' : undefined;
  const narrowed: TableCellStyle = {};
  if (typeof style.bold === 'boolean') narrowed.bold = style.bold;
  if (typeof style.italic === 'boolean') narrowed.italic = style.italic;
  if (style.fill) narrowed.fill = style.fill;
  if (style.color) narrowed.color = style.color;
  if (style.align === 'left' || style.align === 'center' || style.align === 'right') narrowed.align = style.align;
  return Object.keys(narrowed).length > 0 ? narrowed : null;
}

function applyDeclarations(style: ParsedStyle, declarations: string): void {
  for (const declaration of declarations.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).replace(/\s*!important\s*$/i, '').trim();
    if (!value) continue;

    if (property === 'font-weight') {
      const weight = value.toLowerCase();
      if (weight === 'bold' || weight === 'bolder') style.bold = true;
      else if (weight === 'normal' || weight === 'lighter') style.bold = false;
      else if (/^\d+(?:\.\d+)?$/.test(weight)) style.bold = Number(weight) >= 600;
    } else if (property === 'font-style') {
      const fontStyle = value.toLowerCase();
      if (fontStyle === 'italic' || fontStyle === 'oblique') style.italic = true;
      else if (fontStyle === 'normal') style.italic = false;
    } else if (property === 'background' || property === 'background-color') {
      const color = backgroundColor(value);
      if (color) style.fill = color;
    } else if (property === 'color') {
      const color = normalizeColor(value);
      if (color) style.color = color;
    } else if (property === 'text-align') {
      const align = normalizedAlign(value);
      if (align) style.align = align;
    } else if (property === 'mso-horizontal-align') {
      const align = normalizedAlign(value);
      if (align) style.align = align;
      else if (value.toLowerCase() === 'general') style.align = 'general';
    }
    // Excel's other mso-* declarations are Office metadata, not cell styles.
  }
}

function normalizedAlign(value: string): TableCellStyle['align'] | undefined {
  const align = value.trim().toLowerCase();
  if (align === 'left' || align === 'center' || align === 'right') return align;
  return undefined;
}

function backgroundColor(value: string): string | undefined {
  const direct = normalizeColor(value);
  if (direct) return direct;
  // Shorthand declarations can include a color followed by an image/repeat.
  for (const token of value.split(/\s+/)) {
    const color = normalizeColor(token);
    if (color) return color;
  }
  return undefined;
}

function normalizeColor(input: string): string | null {
  const value = input.trim();
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? [...hex].map((part) => part + part).join('') : hex;
    return `#${expanded.toUpperCase()}`;
  }

  const lower = value.toLowerCase();
  if (['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer',
    'accentcolor', 'accentcolortext', 'activetext', 'buttonborder', 'buttonface', 'buttontext',
    'canvas', 'canvastext', 'field', 'fieldtext', 'graytext', 'highlight', 'highlighttext',
    'linktext', 'mark', 'marktext', 'visitedtext'].includes(lower)) return null;

  // Let the browser validate and resolve CSS named colors, then reduce the
  // computed rgb() value to the storage format. The detached probe has no
  // lasting effect on the document.
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  const probe = document.createElement('span');
  probe.style.color = value;
  if (!probe.style.color) return null;
  return rgbColor(window.getComputedStyle(probe).color);
}

function rgbColor(value: string): string | null {
  const match = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(/\s*,\s*|\s+\/\s+|\s+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const channels = parts.slice(0, 3).map((part) => {
    if (part.endsWith('%')) return Math.round((Number.parseFloat(part) / 100) * 255);
    return Math.round(Number.parseFloat(part));
  });
  if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) return null;
  if (parts.length === 4) {
    const alpha = parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]);
    if (!Number.isFinite(alpha) || alpha < 1) return null;
  }
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function displayedText(cell: Element): string {
  const innerText = (cell as HTMLElement).innerText;
  const text = typeof innerText === 'string' ? innerText : cell.textContent ?? '';
  return text.replace(/\u00a0/g, ' ').replace(/[\t\r\n ]+/g, ' ').trim();
}

function positiveSpan(value: string | null): number {
  const span = Number.parseInt(value ?? '', 10);
  return Number.isFinite(span) && span > 1 ? Math.min(span, 1000) : 1;
}

function readColumnWidths(table: Element, count: number): number[] {
  const widths: number[] = [];
  for (const column of Array.from(table.querySelectorAll('col')).filter((item) => item.closest('table') === table)) {
    const value = column.getAttribute('width') ?? column.getAttribute('style')?.match(/(?:^|;)\s*width\s*:\s*([^;]+)/i)?.[1];
    const parsed = value ? Number.parseFloat(value) : Number.NaN;
    const width = Number.isFinite(parsed) ? Math.min(400, Math.max(MIN_COLUMN_WIDTH, Math.round(parsed))) : DEFAULT_COLUMN_WIDTH;
    const span = positiveSpan(column.getAttribute('span'));
    for (let index = 0; index < span && widths.length < count; index++) widths.push(width);
  }
  while (widths.length < count) widths.push(DEFAULT_COLUMN_WIDTH);
  return widths.slice(0, count);
}

function hasHeaderStyleDifference(first: (TableCellStyle | null)[] | undefined, second: (TableCellStyle | null)[] | undefined): boolean {
  if (!first || !second) return false;
  const width = Math.max(first.length, second.length);
  for (let index = 0; index < width; index++) {
    const firstStyle = first[index];
    const secondStyle = second[index];
    if (firstStyle?.fill !== secondStyle?.fill || Boolean(firstStyle?.bold) !== Boolean(secondStyle?.bold)) return true;
  }
  return false;
}

function isNumericDisplay(text: string): boolean {
  const compact = text.replace(/[\s\u00a0]/g, '');
  if (compact === '$-' || compact === '-$' || compact === '($)' || compact === '(-$)') return true;
  const unwrapped = compact.replace(/^\((.*)\)$/, '-$1');
  return /^[-+]?[$€£¥₹]?(?:\d+(?:,\d{3})*(?:\.\d*)?|\.\d+)%?$/.test(unwrapped);
}
