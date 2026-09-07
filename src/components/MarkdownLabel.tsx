/**
 * A label's Markdown, rendered. Shown in place of the raw text while a shape
 * is not being edited — see `src/lib/markdown.ts` for what is understood and
 * why the source is what gets stored.
 */
import type { Block, Span } from '../lib/markdown';

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        let node: React.ReactNode = s.text;
        if (s.code) node = <code className="rounded bg-black/10 px-1 font-mono text-[0.9em]">{node}</code>;
        if (s.italic) node = <em>{node}</em>;
        if (s.bold) node = <strong>{node}</strong>;
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

const HEADING_SIZE = { 1: '1.5em', 2: '1.25em', 3: '1.1em' } as const;

export function MarkdownLabel({ blocks }: { blocks: Block[] }) {
  return (
    <div className="markdown-label" data-testid="markdown-label">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading':
            return (
              <div key={i} role="heading" aria-level={b.level} style={{ fontSize: HEADING_SIZE[b.level], fontWeight: 700 }}>
                <Spans spans={b.spans} />
              </div>
            );
          case 'bullet':
            return (
              <div key={i} role="listitem" className="flex gap-1.5 pl-1">
                <span aria-hidden="true">•</span>
                <span className="min-w-0 flex-1"><Spans spans={b.spans} /></span>
              </div>
            );
          case 'number':
            return (
              <div key={i} role="listitem" className="flex gap-1.5 pl-1">
                <span className="tabular-nums" aria-hidden="true">{b.n}.</span>
                <span className="min-w-0 flex-1"><Spans spans={b.spans} /></span>
              </div>
            );
          case 'check':
            return (
              <div key={i} role="listitem" className="flex gap-1.5 pl-1" data-checked={b.checked}>
                <span aria-hidden="true">{b.checked ? '☑' : '☐'}</span>
                <span className={b.checked ? 'min-w-0 flex-1 opacity-60 line-through' : 'min-w-0 flex-1'}><Spans spans={b.spans} /></span>
              </div>
            );
          default:
            return (
              <div key={i}>
                {b.spans.length === 1 && b.spans[0].text === '' ? ' ' : <Spans spans={b.spans} />}
              </div>
            );
        }
      })}
    </div>
  );
}
