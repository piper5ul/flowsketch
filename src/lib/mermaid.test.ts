import { describe, expect, it } from 'vitest';
import { parseMermaidFlowchart, parseMermaidSequence } from './mermaid';

/** The chart, or a thrown error — every test here expects text that parses. */
function parse(text: string) {
  const chart = parseMermaidFlowchart(text);
  if (!chart) throw new Error('expected a flowchart');
  return chart;
}

describe('the header', () => {
  it('accepts both spellings and every direction', () => {
    expect(parse('graph TD\nA').direction).toBe('TB');
    expect(parse('flowchart TB\nA').direction).toBe('TB');
    expect(parse('flowchart LR\nA').direction).toBe('LR');
    expect(parse('flowchart RL\nA').direction).toBe('RL');
    expect(parse('flowchart BT\nA').direction).toBe('BT');
    // TD and TB are the same direction spelled two ways; one comes out.
    expect(parse('graph TD\nA').direction).toBe(parse('graph TB\nA').direction);
  });

  it('defaults to top-to-bottom when the header does not say', () => {
    expect(parse('graph\nA --> B').direction).toBe('TB');
  });

  it('is case-insensitive, and tolerates a trailing semicolon', () => {
    expect(parse('FlowChart lr;\nA --> B').direction).toBe('LR');
  });

  it('survives a markdown fence around the source', () => {
    const chart = parse('```mermaid\nflowchart LR\n  A --> B\n```');
    expect(chart.direction).toBe('LR');
    expect(chart.nodes).toHaveLength(2);
  });
});

describe('what is not a flowchart', () => {
  it('is null for prose, code and an empty string', () => {
    expect(parseMermaidFlowchart('')).toBeNull();
    expect(parseMermaidFlowchart('Just some notes I copied.')).toBeNull();
    expect(parseMermaidFlowchart('- one\n- two\n- three')).toBeNull();
    expect(parseMermaidFlowchart('const a = b --> c;')).toBeNull();
  });

  it('is null for another kind of Mermaid diagram', () => {
    expect(parseMermaidFlowchart('sequenceDiagram\n  Alice->>Bob: Hi')).toBeNull();
    expect(parseMermaidFlowchart('pie title Pets\n  "Dogs" : 386')).toBeNull();
  });

  it('is null for a header with nothing under it', () => {
    // Nothing to build, so the caller may as well say it was not a flowchart.
    expect(parseMermaidFlowchart('flowchart TD')).toBeNull();
    expect(parseMermaidFlowchart('flowchart TD\n%% still nothing')).toBeNull();
  });
});

describe('node forms', () => {
  const kinds = (source: string) => parse(`flowchart TD\n${source}`).nodes;

  it('reads every bracket pair as its own shape', () => {
    expect(kinds('A[box]')[0]).toEqual({ id: 'A', label: 'box', kind: 'rectangle' });
    expect(kinds('A(round)')[0]).toEqual({ id: 'A', label: 'round', kind: 'pill' });
    expect(kinds('A([stadium])')[0]).toEqual({ id: 'A', label: 'stadium', kind: 'pill' });
    expect(kinds('A{choice}')[0]).toEqual({ id: 'A', label: 'choice', kind: 'diamond' });
    expect(kinds('A((circle))')[0]).toEqual({ id: 'A', label: 'circle', kind: 'ellipse' });
    expect(kinds('A[(store)]')[0]).toEqual({ id: 'A', label: 'store', kind: 'cylinder' });
    expect(kinds('A{{hex}}')[0]).toEqual({ id: 'A', label: 'hex', kind: 'hexagon' });
    expect(kinds('A>flag]')[0]).toEqual({ id: 'A', label: 'flag', kind: 'rectangle' });
  });

  it('gives a bare id its own id as a label, drawn as a rectangle', () => {
    expect(kinds('A --> B')).toEqual([
      { id: 'A', label: 'A', kind: 'rectangle' },
      { id: 'B', label: 'B', kind: 'rectangle' },
    ]);
  });

  it('unwraps a quoted label and reads <br> as a line break', () => {
    expect(kinds('A["a, b and c"]')[0].label).toBe('a, b and c');
    expect(kinds('A[first<br/>second]')[0].label).toBe('first\nsecond');
    expect(kinds('A[first<br>second]')[0].label).toBe('first\nsecond');
  });

  it('lets a later declaration name a node first mentioned in a link', () => {
    const nodes = kinds('A --> B\nB{Really?}');
    expect(nodes.map((n) => n.id)).toEqual(['A', 'B']);
    expect(nodes[1]).toEqual({ id: 'B', label: 'Really?', kind: 'diamond' });
  });

  it('keeps an arrow drawn inside a label out of the graph', () => {
    const chart = parse('flowchart TD\n  A["step 1 --> step 2"] --> B');
    expect(chart.nodes.map((n) => n.id)).toEqual(['A', 'B']);
    expect(chart.nodes[0].label).toBe('step 1 --> step 2');
    expect(chart.edges).toEqual([{ source: 'A', target: 'B' }]);
  });

  it('keeps a node whose id is followed by something it does not understand', () => {
    expect(kinds('A:::highlight --> B').map((n) => n.id)).toEqual(['A', 'B']);
  });
});

describe('edge forms', () => {
  const edges = (source: string) => parse(`flowchart TD\n${source}`).edges;

  it('reads the plain links', () => {
    expect(edges('A --> B')).toEqual([{ source: 'A', target: 'B' }]);
    expect(edges('A --- B')).toEqual([{ source: 'A', target: 'B' }]);
    expect(edges('A ----> B')).toEqual([{ source: 'A', target: 'B' }]);
    expect(edges('A-->B')).toEqual([{ source: 'A', target: 'B' }]);
  });

  it('marks a dotted link dashed and a thick one thick', () => {
    expect(edges('A -.-> B')).toEqual([{ source: 'A', target: 'B', dashed: true }]);
    expect(edges('A -.- B')).toEqual([{ source: 'A', target: 'B', dashed: true }]);
    expect(edges('A ==> B')).toEqual([{ source: 'A', target: 'B', thick: true }]);
    expect(edges('A === B')).toEqual([{ source: 'A', target: 'B', thick: true }]);
  });

  it('reads a label written either way', () => {
    expect(edges('A -->|yes| B')).toEqual([{ source: 'A', target: 'B', label: 'yes' }]);
    expect(edges('A -- yes --> B')).toEqual([{ source: 'A', target: 'B', label: 'yes' }]);
    expect(edges('A -. maybe .-> B')).toEqual([{ source: 'A', target: 'B', label: 'maybe', dashed: true }]);
    expect(edges('A == surely ==> B')).toEqual([{ source: 'A', target: 'B', label: 'surely', thick: true }]);
    expect(edges('A ---|both ends| B')).toEqual([{ source: 'A', target: 'B', label: 'both ends' }]);
  });

  it('unquotes a link label', () => {
    expect(edges('A -->|"no, really"| B')[0].label).toBe('no, really');
  });

  it('reads a chain as a link per step', () => {
    expect(edges('A --> B --> C')).toEqual([
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ]);
  });

  it('does not swallow the middle of a chain of open links', () => {
    // `--- B ---` must not read as one link labelled "B": the inline-text form
    // needs an arrowhead, which is exactly what stops that.
    const chart = parse('flowchart TD\n  A --- B --- C');
    expect(chart.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C']);
    expect(chart.edges).toEqual([
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ]);
  });

  it('fans out over &', () => {
    expect(edges('A & B --> C')).toEqual([
      { source: 'A', target: 'C' },
      { source: 'B', target: 'C' },
    ]);
    expect(edges('A --> B & C')).toEqual([
      { source: 'A', target: 'B' },
      { source: 'A', target: 'C' },
    ]);
  });

  it('reads the x and o endpoints as ordinary links', () => {
    expect(edges('A --x B')).toEqual([{ source: 'A', target: 'B' }]);
    expect(edges('A --o B')).toEqual([{ source: 'A', target: 'B' }]);
  });

  it('links shapes declared inline', () => {
    const chart = parse('flowchart LR\n  A[Start] -->|go| B{Choose}');
    expect(chart.nodes).toEqual([
      { id: 'A', label: 'Start', kind: 'rectangle' },
      { id: 'B', label: 'Choose', kind: 'diamond' },
    ]);
    expect(chart.edges).toEqual([{ source: 'A', target: 'B', label: 'go' }]);
  });
});

describe('the lines that are not the graph', () => {
  it('ignores comments, wherever they sit', () => {
    const chart = parse('flowchart TD\n%% a note\n  A --> B %% and another\n');
    expect(chart.nodes.map((n) => n.id)).toEqual(['A', 'B']);
    expect(chart.edges).toHaveLength(1);
  });

  it('keeps a %% that is inside a quoted label', () => {
    expect(parse('flowchart TD\n  A["100%% sure"]').nodes[0].label).toBe('100%% sure');
  });

  it('ignores style, classDef, class, click and linkStyle', () => {
    const chart = parse(
      [
        'flowchart TD',
        '  A --> B',
        '  style A fill:#f9f',
        '  classDef big font-size:20px',
        '  class A big',
        '  click A "https://example.com"',
        '  linkStyle 0 stroke:#f00',
      ].join('\n'),
    );
    expect(chart.nodes.map((n) => n.id)).toEqual(['A', 'B']);
    expect(chart.edges).toHaveLength(1);
  });

  it('flattens a subgraph to the nodes inside it', () => {
    const chart = parse(
      ['flowchart TD', '  subgraph one [Group]', '    direction LR', '    A --> B', '  end', '  B --> C'].join('\n'),
    );
    expect(chart.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C']);
    expect(chart.edges).toEqual([
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ]);
  });

  it('reads statements separated by semicolons on one line', () => {
    const chart = parse('graph TD; A[Start] --> B; B --> C;');
    expect(chart.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C']);
    expect(chart.edges).toHaveLength(2);
  });
});

describe('a whole chart', () => {
  it('reads a decision flow end to end', () => {
    const chart = parse(
      [
        'flowchart TD',
        '    A([Start]) --> B{Is it broken?}',
        '    B -->|yes| C[Fix it]',
        '    B -.->|no| D[(Log it)]',
        '    C --> E((Done))',
        '    D --> E',
      ].join('\n'),
    );

    expect(chart.direction).toBe('TB');
    expect(chart.nodes).toEqual([
      { id: 'A', label: 'Start', kind: 'pill' },
      { id: 'B', label: 'Is it broken?', kind: 'diamond' },
      { id: 'C', label: 'Fix it', kind: 'rectangle' },
      { id: 'D', label: 'Log it', kind: 'cylinder' },
      { id: 'E', label: 'Done', kind: 'ellipse' },
    ]);
    expect(chart.edges).toEqual([
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C', label: 'yes' },
      { source: 'B', target: 'D', label: 'no', dashed: true },
      { source: 'C', target: 'E' },
      { source: 'D', target: 'E' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Sequence diagrams
// ---------------------------------------------------------------------------

/** `sequenceDiagram` with `lines` under it. */
function seq(...lines: string[]): string {
  return ['sequenceDiagram', ...lines].join('\n');
}

/**
 * `lines` under a header, parsed — or a thrown error, since every test that
 * calls this expects text that parses.
 */
function parseSequence(...lines: string[]) {
  const diagram = parseMermaidSequence(seq(...lines));
  if (!diagram) throw new Error('expected a sequence diagram');
  return diagram;
}

describe('parseMermaidSequence', () => {
  it('is null for anything without a sequenceDiagram header', () => {
    expect(parseMermaidSequence('just some notes')).toBeNull();
    expect(parseMermaidSequence('')).toBeNull();
    // A flowchart is the other parser's, and vice versa: neither accepts the
    // other's source, which is what lets a caller try both in turn.
    expect(parseMermaidSequence('flowchart TD\n  A --> B')).toBeNull();
    expect(parseMermaidFlowchart(seq('A->>B: hi'))).toBeNull();
  });

  it('is null for a header with nobody under it', () => {
    expect(parseMermaidSequence('sequenceDiagram')).toBeNull();
    expect(parseMermaidSequence(seq('loop every minute', 'end'))).toBeNull();
  });

  it('reads a fenced block and ignores %% comments', () => {
    const diagram = parseMermaidSequence(
      ['```mermaid', 'sequenceDiagram', '  %% a note to self', '  A->>B: hi', '```'].join('\n'),
    );
    expect(diagram?.participants.map((p) => p.id)).toEqual(['A', 'B']);
    expect(diagram?.messages).toHaveLength(1);
  });

  it('declares participants with participant and actor, with or without a label', () => {
    const diagram = parseSequence(
      'participant A as Alice',
      'actor B',
      'participant  C  as  Carol Chen ',
    );
    expect(diagram.participants).toEqual([
      { id: 'A', label: 'Alice' },
      { id: 'B', label: 'B' },
      { id: 'C', label: 'Carol Chen' },
    ]);
    expect(diagram.messages).toEqual([]);
  });

  it('takes participants nobody declared, in the order they are first named', () => {
    const diagram = parseSequence('B->>A: first', 'A->>C: second', 'C->>B: third');
    expect(diagram.participants).toEqual([
      { id: 'B', label: 'B' },
      { id: 'A', label: 'A' },
      { id: 'C', label: 'C' },
    ]);
  });

  it('lets a declaration name a participant a message mentioned first', () => {
    // Declared after the fact, which Mermaid allows: the place in the row is
    // where the id was first seen, and the label is the declaration's.
    const diagram = parseSequence('A->>B: hi', 'participant B as Bob');
    expect(diagram.participants).toEqual([
      { id: 'A', label: 'A' },
      { id: 'B', label: 'Bob' },
    ]);
  });

  it('reads every arrow form', () => {
    const diagram = parseSequence(
      'A->>B: solid head',
      'A-->>B: dotted, solid head',
      'A->B: open',
      'A-->B: dotted, open',
      'A-xB: cross reads as solid',
      'A--xB: dotted cross',
      'A-)B: async reads as open',
      'A--)B: dotted async',
    );
    expect(diagram.messages).toEqual([
      { from: 'A', to: 'B', text: 'solid head', arrow: 'solid', dashed: false },
      { from: 'A', to: 'B', text: 'dotted, solid head', arrow: 'solid', dashed: true },
      { from: 'A', to: 'B', text: 'open', arrow: 'open', dashed: false },
      { from: 'A', to: 'B', text: 'dotted, open', arrow: 'open', dashed: true },
      { from: 'A', to: 'B', text: 'cross reads as solid', arrow: 'solid', dashed: false },
      { from: 'A', to: 'B', text: 'dotted cross', arrow: 'solid', dashed: true },
      { from: 'A', to: 'B', text: 'async reads as open', arrow: 'open', dashed: false },
      { from: 'A', to: 'B', text: 'dotted async', arrow: 'open', dashed: true },
    ]);
  });

  it('tolerates spaces around the arrow and an empty message', () => {
    const diagram = parseSequence('Alice  ->>  Bob : hello there', 'Bob->>Alice:');
    expect(diagram.messages).toEqual([
      { from: 'Alice', to: 'Bob', text: 'hello there', arrow: 'solid', dashed: false },
      { from: 'Bob', to: 'Alice', text: '', arrow: 'solid', dashed: false },
    ]);
  });

  it('keeps a self-message as one from and to the same participant', () => {
    const diagram = parseSequence('A->>A: think');
    expect(diagram.participants).toEqual([{ id: 'A', label: 'A' }]);
    expect(diagram.messages).toEqual([
      { from: 'A', to: 'A', text: 'think', arrow: 'solid', dashed: false },
    ]);
  });

  it('drops the activation markers on a message rather than the message', () => {
    const diagram = parseSequence('A->>+B: call', 'B-->>-A: return');
    expect(diagram.participants.map((p) => p.id)).toEqual(['A', 'B']);
    expect(diagram.messages).toEqual([
      { from: 'A', to: 'B', text: 'call', arrow: 'solid', dashed: false },
      { from: 'B', to: 'A', text: 'return', arrow: 'solid', dashed: true },
    ]);
  });

  it('skips the blocks and furniture it does not draw, keeping what is inside them', () => {
    const diagram = parseSequence(
      'autonumber',
      'title A conversation',
      'participant A as Alice',
      'Note over A: thinking',
      'Note right of A: still thinking',
      'activate A',
      'loop every minute',
      '  A->>B: poll',
      '  alt it worked',
      '    B-->>A: yes',
      '  else it did not',
      '    B-->>A: no',
      '  end',
      'end',
      'deactivate A',
      'rect rgb(200, 200, 255)',
      '  A->>B: last',
      'end',
    );
    expect(diagram.participants).toEqual([
      { id: 'A', label: 'Alice' },
      { id: 'B', label: 'B' },
    ]);
    expect(diagram.messages.map((m) => m.text)).toEqual(['poll', 'yes', 'no', 'last']);
  });

  it('reads a created participant and ignores its destruction', () => {
    const diagram = parseSequence('A->>B: hi', 'create participant C as Carol', 'destroy C');
    expect(diagram.participants).toEqual([
      { id: 'A', label: 'A' },
      { id: 'B', label: 'B' },
      { id: 'C', label: 'Carol' },
    ]);
  });

  it('reads a whole small conversation', () => {
    const diagram = parseSequence(
      'participant U as User',
      'participant W as Web app',
      'participant S as API',
      'U->>W: click Save',
      'W->>S: PUT /diagram',
      'S-->>W: 200 OK',
      'W->>U: Saved',
    );
    expect(diagram.participants.map((p) => p.label)).toEqual(['User', 'Web app', 'API']);
    expect(diagram.messages).toHaveLength(4);
    expect(diagram.messages[2]).toEqual({
      from: 'S',
      to: 'W',
      text: '200 OK',
      arrow: 'solid',
      dashed: true,
    });
  });
});
