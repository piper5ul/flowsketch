import { describe, expect, it } from 'vitest';
import { hasMarkdown, inlineSpans, parseMarkdown } from './markdown';

describe('hasMarkdown', () => {
  it('is false for plain text and true for any marker it renders', () => {
    expect(hasMarkdown('Verify email')).toBe(false);
    expect(hasMarkdown('a * b')).toBe(false);
    expect(hasMarkdown('snake_case_name')).toBe(false);
    expect(hasMarkdown('# Title')).toBe(true);
    expect(hasMarkdown('one\n- two')).toBe(true);
    expect(hasMarkdown('say **so**')).toBe(true);
    expect(hasMarkdown('run `npm test`')).toBe(true);
    expect(hasMarkdown('[x] done')).toBe(true);
  });
});

describe('inlineSpans', () => {
  it('splits bold, italic and code out of the text around them', () => {
    expect(inlineSpans('a **b** c')).toEqual([{ text: 'a ' }, { text: 'b', bold: true }, { text: ' c' }]);
    expect(inlineSpans('_x_ and *y*')).toEqual([{ text: 'x', italic: true }, { text: ' and ' }, { text: 'y', italic: true }]);
    expect(inlineSpans('`code`')).toEqual([{ text: 'code', code: true }]);
    expect(inlineSpans('')).toEqual([{ text: '' }]);
  });

  it('leaves underscores inside words and lone asterisks alone', () => {
    expect(inlineSpans('snake_case_name')).toEqual([{ text: 'snake_case_name' }]);
    expect(inlineSpans('2 * 3')).toEqual([{ text: '2 * 3' }]);
  });
});

describe('parseMarkdown', () => {
  it('reads headings, bullets, numbers and checklist items line by line', () => {
    expect(parseMarkdown('# Plan\n- one\n* two\n1. three\n[ ] todo\n[x] done\nplain')).toEqual([
      { kind: 'heading', level: 1, spans: [{ text: 'Plan' }] },
      { kind: 'bullet', spans: [{ text: 'one' }] },
      { kind: 'bullet', spans: [{ text: 'two' }] },
      { kind: 'number', n: 1, spans: [{ text: 'three' }] },
      { kind: 'check', checked: false, spans: [{ text: 'todo' }] },
      { kind: 'check', checked: true, spans: [{ text: 'done' }] },
      { kind: 'paragraph', spans: [{ text: 'plain' }] },
    ]);
  });

  it('keeps an empty line as an empty paragraph and styles inside a list item', () => {
    expect(parseMarkdown('a\n\n- **b**')).toEqual([
      { kind: 'paragraph', spans: [{ text: 'a' }] },
      { kind: 'paragraph', spans: [{ text: '' }] },
      { kind: 'bullet', spans: [{ text: 'b', bold: true }] },
    ]);
  });
});
