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
  const tableCells = Array.from(table.querySelectorAll('td, th'))
    .filter((cell) => cell.closest('table') === table);
  if (tableCells.some((cell) => cell.querySelector('table, img, ul, ol'))) return null;

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
  const nonemptyRows = rows.filter((row) => row.cells.some((cell) => cell !== '')).length;
  const nonemptyColumns = Array.from({ length: width }, (_, column) =>
    rows.some((row) => row.cells[column] !== ''),
  ).filter(Boolean).length;
  if (nonemptyRows < 2 || nonemptyColumns < 2) return null;

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
  if (Object.prototype.hasOwnProperty.call(CSS_NAMED_COLORS, lower)) return `#${CSS_NAMED_COLORS[lower]}`;
  if (['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer',
    'accentcolor', 'accentcolortext', 'activetext', 'buttonborder', 'buttonface', 'buttontext',
    'canvas', 'canvastext', 'field', 'fieldtext', 'graytext', 'highlight', 'highlighttext',
    'linktext', 'mark', 'marktext', 'visitedtext', 'windowtext', 'window', 'auto'].includes(lower)) return null;

  return rgbColor(value);
}

// CSS Color 4 named colors, normalized to six-digit hexadecimal values.
const CSS_NAMED_COLORS: Record<string, string> = {
  aliceblue: 'F0F8FF', antiquewhite: 'FAEBD7', aqua: '00FFFF', aquamarine: '7FFFD4', azure: 'F0FFFF',
  beige: 'F5F5DC', bisque: 'FFE4C4', black: '000000', blanchedalmond: 'FFEBCD', blue: '0000FF',
  blueviolet: '8A2BE2', brown: 'A52A2A', burlywood: 'DEB887', cadetblue: '5F9EA0', chartreuse: '7FFF00',
  chocolate: 'D2691E', coral: 'FF7F50', cornflowerblue: '6495ED', cornsilk: 'FFF8DC', crimson: 'DC143C',
  cyan: '00FFFF', darkblue: '00008B', darkcyan: '008B8B', darkgoldenrod: 'B8860B', darkgray: 'A9A9A9',
  darkgreen: '006400', darkgrey: 'A9A9A9', darkkhaki: 'BDB76B', darkmagenta: '8B008B', darkolivegreen: '556B2F',
  darkorange: 'FF8C00', darkorchid: '9932CC', darkred: '8B0000', darksalmon: 'E9967A', darkseagreen: '8FBC8F',
  darkslateblue: '483D8B', darkslategray: '2F4F4F', darkslategrey: '2F4F4F', darkturquoise: '00CED1', darkviolet: '9400D3',
  deeppink: 'FF1493', deepskyblue: '00BFFF', dimgray: '696969', dimgrey: '696969', dodgerblue: '1E90FF',
  firebrick: 'B22222', floralwhite: 'FFFAF0', forestgreen: '228B22', fuchsia: 'FF00FF', gainsboro: 'DCDCDC',
  ghostwhite: 'F8F8FF', gold: 'FFD700', goldenrod: 'DAA520', gray: '808080', green: '008000', greenyellow: 'ADFF2F',
  grey: '808080', honeydew: 'F0FFF0', hotpink: 'FF69B4', indianred: 'CD5C5C', indigo: '4B0082', ivory: 'FFFFF0',
  khaki: 'F0E68C', lavender: 'E6E6FA', lavenderblush: 'FFF0F5', lawngreen: '7CFC00', lemonchiffon: 'FFFACD',
  lightblue: 'ADD8E6', lightcoral: 'F08080', lightcyan: 'E0FFFF', lightgoldenrodyellow: 'FAFAD2', lightgray: 'D3D3D3',
  lightgreen: '90EE90', lightgrey: 'D3D3D3', lightpink: 'FFB6C1', lightsalmon: 'FFA07A', lightseagreen: '20B2AA',
  lightskyblue: '87CEFA', lightslategray: '778899', lightslategrey: '778899', lightsteelblue: 'B0C4DE', lightyellow: 'FFFFE0',
  lime: '00FF00', limegreen: '32CD32', linen: 'FAF0E6', magenta: 'FF00FF', maroon: '800000', mediumaquamarine: '66CDAA',
  mediumblue: '0000CD', mediumorchid: 'BA55D3', mediumpurple: '9370DB', mediumseagreen: '3CB371', mediumslateblue: '7B68EE',
  mediumspringgreen: '00FA9A', mediumturquoise: '48D1CC', mediumvioletred: 'C71585', midnightblue: '191970', mintcream: 'F5FFFA',
  mistyrose: 'FFE4E1', moccasin: 'FFE4B5', navajowhite: 'FFDEAD', navy: '000080', oldlace: 'FDF5E6', olive: '808000',
  olivedrab: '6B8E23', orange: 'FFA500', orangered: 'FF4500', orchid: 'DA70D6', palegoldenrod: 'EEE8AA', palegreen: '98FB98',
  paleturquoise: 'AFEEEE', palevioletred: 'DB7093', papayawhip: 'FFEFD5', peachpuff: 'FFDAB9', peru: 'CD853F', pink: 'FFC0CB',
  plum: 'DDA0DD', powderblue: 'B0E0E6', purple: '800080', rebeccapurple: '663399', red: 'FF0000', rosybrown: 'BC8F8F',
  royalblue: '4169E1', saddlebrown: '8B4513', salmon: 'FA8072', sandybrown: 'F4A460', seagreen: '2E8B57', seashell: 'FFF5EE',
  sienna: 'A0522D', silver: 'C0C0C0', skyblue: '87CEEB', slateblue: '6A5ACD', slategray: '708090', slategrey: '708090',
  snow: 'FFFAFA', springgreen: '00FF7F', steelblue: '4682B4', tan: 'D2B48C', teal: '008080', thistle: 'D8BFD8',
  tomato: 'FF6347', turquoise: '40E0D0', violet: 'EE82EE', wheat: 'F5DEB3', white: 'FFFFFF', whitesmoke: 'F5F5F5',
  yellow: 'FFFF00', yellowgreen: '9ACD32',
};

function rgbColor(value: string): string | null {
  const match = value.match(/^\s*(rgba?)\(([^()]*)\)\s*$/i);
  if (!match) return null;
  const [, functionName, contents] = match;
  const commaParts = contents.split(',').map((part) => part.trim());
  let channelParts: string[];
  let alphaPart: string | undefined;

  if (commaParts.length > 1) {
    if (contents.includes('/') || commaParts.length < 3 || commaParts.length > 4) return null;
    if (commaParts.length === 4 && functionName.toLowerCase() !== 'rgba') return null;
    channelParts = commaParts.slice(0, 3);
    alphaPart = commaParts[3];
  } else {
    const slashParts = contents.split('/').map((part) => part.trim());
    if (slashParts.length > 2) return null;
    channelParts = slashParts[0].split(/\s+/).filter(Boolean);
    alphaPart = slashParts[1];
  }
  if (channelParts.length !== 3 || (functionName.toLowerCase() === 'rgba' && alphaPart === undefined)) return null;

  const channels: number[] = [];
  for (const part of channelParts) {
    const channel = parseCssNumber(part, 255);
    if (channel === null) return null;
    channels.push(Math.round(channel));
  }
  if (alphaPart !== undefined) {
    const alpha = parseCssNumber(alphaPart, 1);
    if (alpha === null || alpha < 1) return null;
  }
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function parseCssNumber(value: string, maximum: number): number | null {
  const match = value.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(%?)$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  const number = match[2] ? (parsed / 100) * maximum : parsed;
  if (!Number.isFinite(number) || number < 0 || number > maximum) return null;
  return number;
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
