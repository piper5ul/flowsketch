import { describe, expect, it } from 'vitest';
import { parseMermaidSequence, type MermaidSequence } from './mermaid';
import {
  ANCHOR_SIZE,
  LIFELINE_TAIL,
  MESSAGE_GAP,
  MESSAGE_TOP_GAP,
  PARTICIPANT_GAP,
  PARTICIPANT_SIZE,
  SELF_MESSAGE_DROP,
  SELF_MESSAGE_REACH,
  layoutSequence,
  type SequenceLayout,
  type SequenceLayoutNode,
} from './sequenceLayout';

const ORIGIN = { x: 100, y: 50 };

/** Ids that say what they are, so a failure reads rather than being eight of nanoid. */
function counter() {
  let n = 0;
  return () => `n${++n}`;
}

function parse(text: string): MermaidSequence {
  const diagram = parseMermaidSequence(text);
  if (!diagram) throw new Error('expected a sequence diagram');
  return diagram;
}

function lay(...lines: string[]): SequenceLayout {
  return layoutSequence(parse(['sequenceDiagram', ...lines].join('\n')), ORIGIN, counter());
}

const roleIs = (role: string) => (n: SequenceLayoutNode) => n.sequence.role === role;

/** Where a node really is, its parent's offset folded in — the board coordinate. */
function absolute(node: SequenceLayoutNode, nodes: readonly SequenceLayoutNode[]) {
  const parent = nodes.find((n) => n.id === node.parentId);
  if (!parent) return node.position;
  return { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y };
}

describe('participants', () => {
  it('are a row across the top, starting at the origin', () => {
    const { nodes } = lay('A->>B: one', 'B->>C: two');
    const participants = nodes.filter(roleIs('participant'));
    const pitch = PARTICIPANT_SIZE.width + PARTICIPANT_GAP;

    expect(participants).toHaveLength(3);
    participants.forEach((p, i) => {
      expect(p.position).toEqual({ x: ORIGIN.x + i * pitch, y: ORIGIN.y });
      expect(p.width).toBe(PARTICIPANT_SIZE.width);
      expect(p.height).toBe(PARTICIPANT_SIZE.height);
      expect(p.parentId).toBeUndefined();
      // A participant belongs to itself, so a piece of the column and the box
      // at the top of it point at the same id.
      expect(p.sequence).toEqual({ role: 'participant', participant: p.id });
    });
  });

  it('wear the label the source gave them', () => {
    const { nodes } = lay('participant A as Alice', 'participant B', 'A->>B: hi');
    expect(nodes.filter(roleIs('participant')).map((p) => p.label)).toEqual(['Alice', 'B']);
  });

  it('come first in the array, ahead of every anchor that hangs off one', () => {
    // React Flow reads the array in order, so a child before its parent is not
    // a z-order quibble but a board that does not draw.
    const { nodes } = lay('A->>B: one', 'B->>A: two');
    const firstAnchor = nodes.findIndex((n) => n.parentId !== undefined);
    const lastParticipant = nodes.map(roleIs('participant')).lastIndexOf(true);
    expect(lastParticipant).toBeLessThan(firstAnchor);
    for (const node of nodes) {
      if (node.parentId === undefined) continue;
      expect(nodes.findIndex((n) => n.id === node.parentId)).toBeLessThan(nodes.indexOf(node));
    }
  });
});

describe('lifelines', () => {
  it('are a dashed headless connector from the participant down to an anchor', () => {
    const { nodes, edges } = lay('A->>B: hi');
    const lifelines = edges.filter((e) => e.sequence.kind === 'lifeline');
    const participants = nodes.filter(roleIs('participant'));

    expect(lifelines).toHaveLength(2);
    lifelines.forEach((line, i) => {
      expect(line.source).toBe(participants[i].id);
      expect(line.strokeStyle).toBe('dashed');
      expect(line.endArrowStyle).toBe('none');
      expect(line.connectorType).toBe('straight');
      expect(line.label).toBe('');
      expect(line.sourceAnchor).toEqual({ side: 'bottom', t: 0.5 });
      expect(line.targetAnchor).toEqual({ side: 'top', t: 0.5 });
      expect(line.sequence).toEqual({ kind: 'lifeline', index: i });
    });
  });

  it('end on a 1×1 anchor centred under its participant and parented to it', () => {
    const { nodes } = lay('A->>B: hi');
    const ends = nodes.filter(roleIs('lifelineEnd'));
    const participants = nodes.filter(roleIs('participant'));

    expect(ends).toHaveLength(2);
    ends.forEach((end, i) => {
      expect(end.width).toBe(ANCHOR_SIZE);
      expect(end.height).toBe(ANCHOR_SIZE);
      expect(end.parentId).toBe(participants[i].id);
      expect(end.sequence).toEqual({ role: 'lifelineEnd', participant: participants[i].id });
      // The centre of the 1×1 box sits on the participant's centre line, which
      // is where the lifeline leaves the bottom edge.
      expect(absolute(end, nodes).x + ANCHOR_SIZE / 2).toBeCloseTo(
        participants[i].position.x + PARTICIPANT_SIZE.width / 2,
      );
    });
  });

  it('reach the tail past the last message, and all end level', () => {
    const { nodes } = lay('A->>B: one', 'B->>A: two', 'A->>B: three');
    const lastMessageY =
      ORIGIN.y + PARTICIPANT_SIZE.height + MESSAGE_TOP_GAP + 2 * MESSAGE_GAP;
    const bottoms = nodes.filter(roleIs('lifelineEnd')).map((n) => absolute(n, nodes).y);
    expect(bottoms).toEqual([lastMessageY + LIFELINE_TAIL, lastMessageY + LIFELINE_TAIL]);
  });

  it('still hang below a diagram with no messages at all', () => {
    const { nodes, edges } = lay('participant A as Alice');
    expect(edges.filter((e) => e.sequence.kind === 'message')).toEqual([]);
    const [end] = nodes.filter(roleIs('lifelineEnd'));
    expect(absolute(end, nodes).y).toBe(
      ORIGIN.y + PARTICIPANT_SIZE.height + MESSAGE_TOP_GAP + LIFELINE_TAIL,
    );
  });
});

describe('messages', () => {
  it('are spaced down the page in the order they were written', () => {
    const { nodes, edges } = lay('A->>B: one', 'B->>A: two', 'A->>B: three');
    const messages = edges.filter((e) => e.sequence.kind === 'message');
    const top = ORIGIN.y + PARTICIPANT_SIZE.height + MESSAGE_TOP_GAP;

    expect(messages.map((m) => m.label)).toEqual(['one', 'two', 'three']);
    messages.forEach((message, i) => {
      expect(message.sequence).toEqual({ kind: 'message', index: i });
      const source = nodes.find((n) => n.id === message.source)!;
      const target = nodes.find((n) => n.id === message.target)!;
      expect(absolute(source, nodes).y).toBe(top + i * MESSAGE_GAP);
      expect(absolute(target, nodes).y).toBe(top + i * MESSAGE_GAP);
    });
  });

  it('hang an endpoint off each participant, on its own lifeline', () => {
    const { nodes, edges } = lay('A->>B: hi');
    const [message] = edges.filter((e) => e.sequence.kind === 'message');
    const participants = nodes.filter(roleIs('participant'));
    const source = nodes.find((n) => n.id === message.source)!;
    const target = nodes.find((n) => n.id === message.target)!;

    expect(source.parentId).toBe(participants[0].id);
    expect(target.parentId).toBe(participants[1].id);
    expect(source.sequence).toEqual({
      role: 'messagePoint',
      participant: participants[0].id,
      index: 0,
    });
    for (const end of [source, target]) {
      expect(end.width).toBe(ANCHOR_SIZE);
      expect(end.label).toBe('');
      const centre = nodes.find((n) => n.id === end.parentId)!.position.x + PARTICIPANT_SIZE.width / 2;
      expect(absolute(end, nodes).x + ANCHOR_SIZE / 2).toBeCloseTo(centre);
    }
  });

  it('leave and arrive on the sides that face the way they travel', () => {
    const { edges } = lay('A->>B: rightwards', 'B->>A: leftwards');
    const [right, left] = edges.filter((e) => e.sequence.kind === 'message');
    expect(right.sourceAnchor.side).toBe('right');
    expect(right.targetAnchor.side).toBe('left');
    expect(left.sourceAnchor.side).toBe('left');
    expect(left.targetAnchor.side).toBe('right');
  });

  it('map Mermaid’s two axes onto the head and the line separately', () => {
    const { edges } = lay(
      'A->>B: solid arrow',
      'A-->>B: dashed arrow',
      'A->B: solid open',
      'A-->B: dashed open',
      'A-xB: cross is an arrow',
      'A--)B: dashed async is open',
    );
    expect(
      edges
        .filter((e) => e.sequence.kind === 'message')
        .map((e) => [e.strokeStyle, e.endArrowStyle]),
    ).toEqual([
      ['solid', 'arrow'],
      ['dashed', 'arrow'],
      ['solid', 'open'],
      ['dashed', 'open'],
      ['solid', 'arrow'],
      ['dashed', 'open'],
    ]);
  });

  it('every message connector is straight and carries its own text', () => {
    const { edges } = lay('A->>B: click Save', 'B-->>A: 200 OK');
    for (const edge of edges.filter((e) => e.sequence.kind === 'message')) {
      expect(edge.connectorType).toBe('straight');
    }
    expect(edges.filter((e) => e.sequence.kind === 'message').map((e) => e.label)).toEqual([
      'click Save',
      '200 OK',
    ]);
  });
});

describe('a self-message', () => {
  it('is a loop out to the right between two points on one lifeline', () => {
    const { nodes, edges } = lay('A->>A: think');
    const [message] = edges.filter((e) => e.sequence.kind === 'message');
    const source = nodes.find((n) => n.id === message.source)!;
    const target = nodes.find((n) => n.id === message.target)!;
    const top = ORIGIN.y + PARTICIPANT_SIZE.height + MESSAGE_TOP_GAP;
    const centre = ORIGIN.x + PARTICIPANT_SIZE.width / 2;

    expect(source.parentId).toBe(target.parentId);
    expect(absolute(source, nodes).y).toBe(top);
    expect(absolute(target, nodes).y).toBe(top + SELF_MESSAGE_DROP);
    // Both ends leave rightwards, and the two waypoints — board coordinates,
    // as `ConnectorData.waypoints` are — make the polyline out, down and back.
    expect(message.sourceAnchor.side).toBe('right');
    expect(message.targetAnchor.side).toBe('right');
    expect(message.waypoints).toEqual([
      { x: centre + SELF_MESSAGE_REACH, y: top },
      { x: centre + SELF_MESSAGE_REACH, y: top + SELF_MESSAGE_DROP },
    ]);
  });

  it('takes two rungs of the ladder, so the next message clears it', () => {
    const { nodes, edges } = lay('A->>A: think', 'A->>B: act');
    const [, second] = edges.filter((e) => e.sequence.kind === 'message');
    const top = ORIGIN.y + PARTICIPANT_SIZE.height + MESSAGE_TOP_GAP;
    const source = nodes.find((n) => n.id === second.source)!;
    expect(absolute(source, nodes).y).toBe(top + SELF_MESSAGE_DROP + MESSAGE_GAP);
  });

  it('gives an ordinary message no waypoints at all', () => {
    const { edges } = lay('A->>B: hi');
    expect(edges.filter((e) => e.sequence.kind === 'message')[0].waypoints).toBeUndefined();
  });
});

describe('the whole thing', () => {
  it('draws one participant, one lifeline and two anchors per column', () => {
    const { nodes, edges } = lay('A->>B: one', 'B-->>A: two', 'A->>A: three');

    // 3 participants' worth of boxes: 2 participants, 2 lifeline ends, and two
    // message points per message (the self-message's two on one lifeline).
    expect(nodes.filter(roleIs('participant'))).toHaveLength(2);
    expect(nodes.filter(roleIs('lifelineEnd'))).toHaveLength(2);
    expect(nodes.filter(roleIs('messagePoint'))).toHaveLength(6);
    expect(edges.filter((e) => e.sequence.kind === 'lifeline')).toHaveLength(2);
    expect(edges.filter((e) => e.sequence.kind === 'message')).toHaveLength(3);

    // Lifelines are drawn first so a message crosses over the dashed line.
    expect(edges.slice(0, 2).every((e) => e.sequence.kind === 'lifeline')).toBe(true);

    // Every id is its own, and every endpoint names a node that is really here.
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids.size).toBe(nodes.length);
    for (const edge of edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
  });
});
