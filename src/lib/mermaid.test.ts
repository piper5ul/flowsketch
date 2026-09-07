import { describe, expect, it } from 'vitest';
import { parseMermaidFlowchart } from './mermaid';

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
