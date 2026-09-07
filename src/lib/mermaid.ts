/**
 * A small Mermaid **flowchart** parser: enough of the syntax to turn a diagram
 * somebody wrote as text into shapes and connectors on the board.
 *
 * There is no library here on purpose. Mermaid's own parser is a Jison grammar
 * that arrives with the whole renderer attached — hundreds of kilobytes to read
 * a couple of dozen lines of text — and every one of those lines is a shape
 * declaration or a link between two of them. What is below is a scanner rather
 * than a grammar: statements are split at the top level (so an arrow drawn
 * *inside* a label is text, not a link), each statement alternates node
 * references and link tokens, and the shapes come from a table of bracket pairs.
 *
 * **What is supported** — `graph` / `flowchart` with `TB|TD|BT|LR|RL`; the node
 * forms `A`, `A[box]`, `A(pill)`, `A([pill])`, `A{diamond}`, `A((circle))`,
 * `A[(cylinder)]`, `A{{hexagon}}` and `A>flag]`; quoted labels and `<br>`;
 * links `-->`, `---`, `-.->`, `-.-`, `==>`, `===`, with a label written either
 * `-->|text|` or `-- text -->`; chains (`A --> B --> C`) and `&` fan-out
 * (`A & B --> C`); `%%` comments and `style` / `classDef` / `class` / `click` /
 * `linkStyle` lines, all ignored.
 *
 * **What is not** — `subgraph` is flattened: the block markers are dropped and
 * the shapes inside it are ordinary nodes (we have frames, but a section pasted
 * around a flow the layout engine is about to rearrange would be a box drawn in
 * the wrong place). Also unsupported: styling of any kind, the `A --x B` /
 * `A --o B` endpoint markers (parsed, but drawn as a plain arrow), an open link
 * carrying inline text (`A -- text --- B`), class shorthand (`A:::name`) and
 * every non-flowchart Mermaid diagram — a sequence diagram has no header this
 * recognises and comes back as `null`.
 *
 * Pure and structural like the rest of `src/lib`: a string in, a plain
 * description out, and not one word about the store or React Flow.
 */

/** Which way the chart says it flows. Mermaid's `TD` is `TB`, and is normalized to it. */
export type MermaidDirection = 'TB' | 'BT' | 'LR' | 'RL';

/** The shape kinds a Mermaid node form can name. Every one is a `ShapeKind` this app draws. */
export type MermaidShape = 'rectangle' | 'pill' | 'diamond' | 'ellipse' | 'cylinder' | 'hexagon';

export interface MermaidNode {
  id: string;
  label: string;
  kind: MermaidShape;
}

export interface MermaidEdge {
  source: string;
  target: string;
  label?: string;
  /** A dotted link (`-.->`), drawn as a dashed connector. */
  dashed?: boolean;
  /** A thick link (`==>`), drawn at the heaviest stroke width. */
  thick?: boolean;
}

export interface MermaidFlowchart {
  direction: MermaidDirection;
  nodes: MermaidNode[];
  edges: MermaidEdge[];
}

/** The header, which is also what tells a flowchart from every other Mermaid diagram. */
const HEADER = /^(?:graph|flowchart)(?:\s+(TB|TD|BT|LR|RL))?$/i;

/** Lines that say how the chart should *look*, which is not something we paste. */
const IGNORED = /^(?:style|classDef|class|click|linkStyle|direction|subgraph|end)\b/i;

/**
 * One link token, matched where a statement is not inside brackets or quotes.
 *
 * The alternatives are ordered longest-form-first, and the two "inline text"
 * forms deliberately require an arrowhead: without that, `A --- B --- C` would
 * read its own second link's dashes as the end of a label and swallow `B`.
 */
const LINK = /-\.(?:[^.\n]*\.)?-+[>ox]?|={2,}[^=>\n][^\n]*?={2,}[>ox]|={2,}[>ox]?|-{2,}[^->\n][^\n]*?-{2,}[>ox]|-{2,}[>ox]?/y;

/** The inline label inside a link token, for each of the three link families. */
const LINK_TEXT = [
  /^-\.(.*)\.-+[>ox]?$/,
  /^={2,}(.*?)={2,}[>ox]$/,
  /^-{2,}(.*?)-{2,}[>ox]$/,
];

/**
 * The bracket pairs that name a shape, longest opener first — `A[(db)]` is a
 * cylinder and not a rectangle whose label happens to start with a bracket.
 */
const SHAPES: readonly [open: string, close: string, kind: MermaidShape][] = [
  ['[(', ')]', 'cylinder'],
  ['((', '))', 'ellipse'],
  ['([', '])', 'pill'],
  ['{{', '}}', 'hexagon'],
  ['[', ']', 'rectangle'],
  ['(', ')', 'pill'],
  ['{', '}', 'diamond'],
  ['>', ']', 'rectangle'],
];

/** A node id: what Mermaid allows before a shape's opening bracket. */
const NODE_ID = /^[A-Za-z0-9_\-.]+/;

/**
 * `text` cut at the first `%%` that is not inside a quoted label.
 *
 * Quotes are the only thing tracked: a `%%` inside brackets is a comment to
 * Mermaid too, and the one place it is not is a label the author quoted.
 */
function stripComment(text: string): string {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === '%' && text[i + 1] === '%') return text.slice(0, i);
  }
  return text;
}

/**
 * `text` split on `sep`, ignoring separators inside brackets or quotes.
 *
 * That is what keeps `A["a; b"] --> B` one statement and `A & B --> C` a fan-out
 * rather than a node called `A & B`.
 */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === '[' || c === '(' || c === '{') depth++;
    else if (c === ']' || c === ')' || c === '}') depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** A label as it should read on the board: unquoted, with `<br>` as a real line break. */
function cleanLabel(raw: string): string {
  let label = raw.trim();
  if (label.length >= 2 && ((label.startsWith('"') && label.endsWith('"')) || (label.startsWith("'") && label.endsWith("'")))) {
    label = label.slice(1, -1);
  }
  return label.replace(/<br\s*\/?>/gi, '\n').trim();
}

interface NodeRef {
  id: string;
  label?: string;
  kind?: MermaidShape;
}

/**
 * One side of a link: `A`, `A[Label]`, or several of either joined by `&`.
 *
 * A reference with no brackets says nothing about the shape or the label, so
 * both come back undefined and the node keeps whatever an earlier declaration
 * gave it — or its own id, which is what Mermaid draws for a node that is only
 * ever mentioned in a link.
 */
function parseNodeRefs(chunk: string): NodeRef[] {
  const refs: NodeRef[] = [];
  for (const part of splitTopLevel(chunk, '&')) {
    const text = part.trim();
    const id = NODE_ID.exec(text)?.[0];
    if (!id) continue;
    const rest = text.slice(id.length).trim();
    if (!rest) {
      refs.push({ id });
      continue;
    }
    const wrapper = SHAPES.find(
      ([open, close]) => rest.startsWith(open) && rest.endsWith(close) && rest.length >= open.length + close.length,
    );
    // Something followed the id that is not a shape we know (`A:::highlight`,
    // say). The id is still a node; the decoration is dropped.
    if (!wrapper) {
      refs.push({ id });
      continue;
    }
    const [open, close, kind] = wrapper;
    refs.push({ id, kind, label: cleanLabel(rest.slice(open.length, rest.length - close.length)) });
  }
  return refs;
}

interface LinkToken {
  label?: string;
  dashed: boolean;
  thick: boolean;
}

/** What one link token says: its inline label, and which of the three lines it is. */
function readLink(token: string): LinkToken {
  const label = LINK_TEXT.map((re) => re.exec(token)?.[1])
    .find((text) => text !== undefined && text.trim() !== '');
  return {
    label: label === undefined ? undefined : cleanLabel(label),
    dashed: token.includes('.'),
    thick: token.startsWith('='),
  };
}

/**
 * A statement, split into the node references it names and the links between
 * them: `A --> B --> C` is three chunks and two links, in order.
 *
 * The scan only recognises a link where nothing is open, which is what lets a
 * label say `A["step 1 --> step 2"]` without becoming two nodes. A `|text|`
 * immediately after a link is that link's label.
 */
function splitStatement(statement: string): { chunks: string[]; links: LinkToken[] } {
  const chunks: string[] = [];
  const links: LinkToken[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  let i = 0;

  while (i < statement.length) {
    const c = statement[i];
    if (quoted) {
      if (c === '"') quoted = false;
      i++;
      continue;
    }
    if (c === '"') {
      quoted = true;
      i++;
      continue;
    }
    if (c === '[' || c === '(' || c === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === ']' || c === ')' || c === '}') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (depth > 0 || (c !== '-' && c !== '=')) {
      i++;
      continue;
    }

    LINK.lastIndex = i;
    const match = LINK.exec(statement);
    if (!match) {
      i++;
      continue;
    }

    const link = readLink(match[0]);
    let end = i + match[0].length;
    // `-->|yes|` — the pipe form, which wins over an inline one (they are never
    // both written, and this is the reading Mermaid gives).
    if (statement[end] === '|') {
      const close = statement.indexOf('|', end + 1);
      if (close !== -1) {
        link.label = cleanLabel(statement.slice(end + 1, close));
        end = close + 1;
      }
    }
    chunks.push(statement.slice(start, i));
    links.push(link);
    start = end;
    i = end;
  }
  chunks.push(statement.slice(start));
  return { chunks, links };
}

/**
 * `text` as a flowchart, or `null` when it is not one.
 *
 * `null` is the answer for anything without a `graph` / `flowchart` header —
 * ordinary prose, a sequence diagram, a snippet of code — and for a header with
 * no nodes under it, so a caller can say "that isn't a Mermaid flowchart" and
 * mean it. A ```` ```mermaid ```` fence around the text is tolerated: that is
 * how the source is usually copied.
 */
export function parseMermaidFlowchart(text: string): MermaidFlowchart | null {
  const statements: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const bare = stripComment(line).trim();
    if (!bare || bare.startsWith('```')) continue;
    for (const statement of splitTopLevel(bare, ';')) {
      const trimmed = statement.trim();
      if (trimmed) statements.push(trimmed);
    }
  }

  const header = statements.length > 0 ? HEADER.exec(statements[0]) : null;
  if (!header) return null;
  const declared = header[1]?.toUpperCase();
  const direction: MermaidDirection = declared === 'TD' || declared === undefined ? 'TB' : (declared as MermaidDirection);

  // Insertion-ordered, so the shapes are built in the order they were written —
  // which is the order auto-layout is handed them in, and the order a reader of
  // the source expects.
  const nodes = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];

  function note(ref: NodeRef): string {
    const existing = nodes.get(ref.id);
    if (!existing) {
      nodes.set(ref.id, { id: ref.id, label: ref.label ?? ref.id, kind: ref.kind ?? 'rectangle' });
      return ref.id;
    }
    // A later mention that carries brackets is a declaration and wins: Mermaid
    // lets `A --> B` come before `B[The label]`.
    if (ref.label !== undefined) existing.label = ref.label;
    if (ref.kind !== undefined) existing.kind = ref.kind;
    return ref.id;
  }

  for (const statement of statements.slice(1)) {
    if (IGNORED.test(statement)) continue;
    const { chunks, links } = splitStatement(statement);
    const sides = chunks.map(parseNodeRefs);
    for (const refs of sides) for (const ref of refs) note(ref);

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      for (const from of sides[i] ?? []) {
        for (const to of sides[i + 1] ?? []) {
          edges.push({
            source: from.id,
            target: to.id,
            ...(link.label ? { label: link.label } : {}),
            ...(link.dashed ? { dashed: true } : {}),
            ...(link.thick ? { thick: true } : {}),
          });
        }
      }
    }
  }

  if (nodes.size === 0) return null;
  return { direction, nodes: [...nodes.values()], edges };
}
