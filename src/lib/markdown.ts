/**
 * The Markdown a label understands, as Whimsical's "Markdown as you type":
 * `# ` / `## ` / `### ` headings, `- ` / `* ` bullets, `1. ` numbers, `[ ] ` /
 * `[x] ` checklist items, and inline `**bold**`, `_italic_` / `*italic*` and
 * `` `code` ``. A label is stored as the text the user typed — markers and
 * all — so search, export and old builds see plain text; only the *rendering*
 * changes, and only while the label is not being edited (editing shows the
 * source, which is where the markers can be reached to change them).
 *
 * Pure: a parser to a small block/span tree that `ShapeNode` renders. It is
 * not a Markdown implementation; a line that matches nothing is a paragraph.
 */

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type Block =
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'heading'; level: 1 | 2 | 3; spans: Span[] }
  | { kind: 'bullet'; spans: Span[] }
  | { kind: 'number'; n: number; spans: Span[] }
  | { kind: 'check'; checked: boolean; spans: Span[] };

const LINE = /^(#{1,3}) (.*)$|^([-*]) (.*)$|^(\d+)[.)] (.*)$|^\[( |x|X)\] (.*)$/;
const INLINE = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|((?:^|[^*\w])\*([^*\s][^*]*?)\*)|((?:^|[^_\w])_([^_\s][^_]*?)_)/g;

/** True when rendering `text` would differ from showing it as typed. */
export function hasMarkdown(text: string): boolean {
  return text.split('\n').some((line) => LINE.test(line)) || /\*\*[^*]+\*\*|`[^`]+`|(^|[^*\w])\*[^*\s][^*]*?\*|(^|[^_\w])_[^_\s][^_]*?_/.test(text);
}

/** `text` with its inline markers turned into styled spans. */
export function inlineSpans(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    // The italic forms match a leading boundary character; keep it as text.
    const lead = m[5] !== undefined || m[7] !== undefined ? (m[0].startsWith('*') || m[0].startsWith('_') ? 0 : 1) : 0;
    if (start + lead > last) spans.push({ text: text.slice(last, start + lead) });
    if (m[2] !== undefined) spans.push({ text: m[2], bold: true });
    else if (m[4] !== undefined) spans.push({ text: m[4], code: true });
    else if (m[6] !== undefined) spans.push({ text: m[6], italic: true });
    else if (m[8] !== undefined) spans.push({ text: m[8], italic: true });
    last = start + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.length > 0 ? spans : [{ text: '' }];
}

/** The label's lines as blocks. Empty lines are kept as empty paragraphs so spacing survives. */
export function parseMarkdown(text: string): Block[] {
  return text.split('\n').map((line): Block => {
    const m = LINE.exec(line);
    if (!m) return { kind: 'paragraph', spans: inlineSpans(line) };
    if (m[1] !== undefined) return { kind: 'heading', level: m[1].length as 1 | 2 | 3, spans: inlineSpans(m[2]) };
    if (m[3] !== undefined) return { kind: 'bullet', spans: inlineSpans(m[4]) };
    if (m[5] !== undefined) return { kind: 'number', n: Number(m[5]), spans: inlineSpans(m[6]) };
    return { kind: 'check', checked: m[7] !== ' ', spans: inlineSpans(m[8]) };
  });
}
