/**
 * Sequence diagrams — the structural half, pure and free of React Flow.
 *
 * **A sequence diagram is ordinary shapes and connectors.** There is no new
 * node type and no new edge renderer, and that is the whole design:
 *
 * - A **participant** is a `rectangle` in the row across the top, wearing the
 *   board's default shape style and the actor's display name.
 * - A **lifeline** is a dashed `straight` connector running from that
 *   rectangle's bottom edge to an invisible **1×1 anchor node** far below it —
 *   the same "floating arrow" hack a connector drawn on empty canvas already
 *   uses (`isAnchorNode` in `nodeKinds.ts`). Nothing new had to be drawn,
 *   exported, selected or migrated for it.
 * - A **message** is a `straight` connector between two more of those anchors,
 *   one sitting on each participant's lifeline at the message's own height,
 *   carrying the message text as its label and Mermaid's head and line style as
 *   `endArrowStyle` / `strokeStyle`.
 *
 * **Every anchor is a child of its participant** (`parentId`, with a
 * parent-relative position, per the container invariants in `nodeTree.ts`), and
 * that is what makes the column one object: dragging a participant takes its
 * lifeline and every message endpoint on it along, because React Flow moves a
 * parent's children with it, and deleting or copying one takes the column too,
 * because `subtreeIds` is what those commands act on. No code had to learn what
 * a sequence diagram is for any of that to be true.
 *
 * What each piece *is* is recorded in `ShapeData.sequence` /
 * `ConnectorData.sequence` (see `src/types.ts`), for tooling that comes later.
 * Both are optional, and absent is what every diagram written before this holds
 * — so there is no migration step, exactly as for mind maps and ink.
 *
 * **Out of scope, and parsed-then-ignored by `parseMermaidSequence`:**
 * activation boxes, notes, and the `loop` / `alt` / `opt` / `par` blocks. Each
 * is drawn furniture with no counterpart among shapes and connectors, and half
 * of one would read worse than none.
 *
 * Pure and structural like `arrange.ts`: a parsed diagram and an origin in,
 * plain boxes and lines out, with the ids handed in by the caller so the whole
 * thing is deterministic under test.
 */

import type { MermaidSequence } from './mermaid';
import type { SequenceEdgeData, SequenceNodeData } from '../types';

export interface Point {
  x: number;
  y: number;
}

/** How big a participant's box is. Whimsical's own is about this. */
export const PARTICIPANT_SIZE = { width: 160, height: 48 };

/** The gap between two participants' boxes; the column pitch is this plus the width. */
export const PARTICIPANT_GAP = 80;

/** How far the first message sits below the row of participants. */
export const MESSAGE_TOP_GAP = 40;

/** The vertical pitch from one message to the next. */
export const MESSAGE_GAP = 48;

/** How far a lifeline reaches past the last message on it. */
export const LIFELINE_TAIL = 40;

/**
 * A self-message (`A->>A`) leaves and arrives on the same lifeline, so its two
 * ends are this far apart and it is drawn as a loop out to the right — a
 * straight connector pulled through two waypoints, which is a polyline: out,
 * down, back. An elbow would have had to be routed between two points on one
 * vertical line, which is the router's least defined case.
 */
export const SELF_MESSAGE_DROP = 24;

/** How far to the right that loop reaches. */
export const SELF_MESSAGE_REACH = 48;

/** A lifeline anchor is a 1×1 invisible node, like every other anchor. */
export const ANCHOR_SIZE = 1;

/** One side of a box, as a connector's endpoint names it. */
type AnchorSide = 'top' | 'right' | 'bottom' | 'left';

/** A connector endpoint: which side, and how far along it. */
interface LayoutAnchor {
  side: AnchorSide;
  t: number;
}

/**
 * One node the layout wants drawn. `position` is **parent-relative** wherever
 * `parentId` is set, which is every anchor; a participant has no parent and its
 * position is on the board.
 */
export interface SequenceLayoutNode {
  id: string;
  /** The actor's name on a participant; empty on an anchor, which draws nothing. */
  label: string;
  position: Point;
  width: number;
  height: number;
  parentId?: string;
  /** What this piece is, verbatim as it goes into `ShapeData.sequence`. */
  sequence: SequenceNodeData;
}

/** One connector the layout wants drawn, in the terms `ConnectorData` uses. */
export interface SequenceLayoutEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  connectorType: 'straight';
  strokeStyle: 'solid' | 'dashed';
  endArrowStyle: 'none' | 'arrow' | 'open';
  sourceAnchor: LayoutAnchor;
  targetAnchor: LayoutAnchor;
  /** Board coordinates, as `ConnectorData.waypoints` are. Only a self-message has any. */
  waypoints?: Point[];
  sequence: SequenceEdgeData;
}

export interface SequenceLayout {
  nodes: SequenceLayoutNode[];
  edges: SequenceLayoutEdge[];
}

/** An anchor's parent-relative x: centred under its participant. */
function anchorOffsetX(): number {
  return PARTICIPANT_SIZE.width / 2 - ANCHOR_SIZE / 2;
}

/**
 * `parsed` as boxes and lines, with the participants' row starting at `origin`.
 *
 * `nextId` supplies every board id, so a caller can hand in `nanoid` and a test
 * can hand in a counter. The nodes come back **participants first**, which is
 * the parents-before-children order React Flow reads the array in.
 *
 * The vertical cursor is a running total rather than `index * MESSAGE_GAP`: a
 * self-message occupies two rungs of the ladder instead of one, and stepping by
 * the index would have drawn the next message through the middle of it.
 */
export function layoutSequence(
  parsed: MermaidSequence,
  origin: Point,
  nextId: () => string,
): SequenceLayout {
  const { width: W, height: H } = PARTICIPANT_SIZE;
  const pitch = W + PARTICIPANT_GAP;
  const offsetX = anchorOffsetX();

  const participantNodes: SequenceLayoutNode[] = [];
  const boardId = new Map<string, string>();
  const columnIndex = new Map<string, number>();

  parsed.participants.forEach((participant, i) => {
    const id = nextId();
    boardId.set(participant.id, id);
    columnIndex.set(participant.id, i);
    participantNodes.push({
      id,
      label: participant.label,
      position: { x: origin.x + i * pitch, y: origin.y },
      width: W,
      height: H,
      sequence: { role: 'participant', participant: id },
    });
  });

  /** The board x of a column's centre line, which its lifeline runs down. */
  const centreX = (i: number) => origin.x + i * pitch + W / 2;

  const messagePoints: SequenceLayoutNode[] = [];
  const messageEdges: SequenceLayoutEdge[] = [];

  /** One 1×1 anchor on `participant`'s lifeline at board height `y`. */
  function messagePoint(participantId: string, y: number, index: number): string {
    const parentId = boardId.get(participantId)!;
    const id = nextId();
    messagePoints.push({
      id,
      label: '',
      position: { x: offsetX, y: y - origin.y },
      width: ANCHOR_SIZE,
      height: ANCHOR_SIZE,
      parentId,
      sequence: { role: 'messagePoint', participant: parentId, index },
    });
    return id;
  }

  const top = origin.y + H + MESSAGE_TOP_GAP;
  let cursor = top;
  // The lowest message endpoint placed, which is what the lifelines reach past.
  let lowest = top;

  parsed.messages.forEach((message, index) => {
    const fromColumn = columnIndex.get(message.from);
    const toColumn = columnIndex.get(message.to);
    // The parser only ever names participants it also declared, so this is
    // defensive rather than reachable — but the layout must not invent a node.
    if (fromColumn === undefined || toColumn === undefined) return;

    const common = {
      id: nextId(),
      label: message.text,
      connectorType: 'straight' as const,
      // Mermaid's two axes, kept apart: the head is `->>` versus `->`, and the
      // line being dotted is the doubled dash, whichever head it carries.
      strokeStyle: message.dashed ? ('dashed' as const) : ('solid' as const),
      endArrowStyle: message.arrow === 'solid' ? ('arrow' as const) : ('open' as const),
      sequence: { kind: 'message' as const, index },
    };

    if (fromColumn === toColumn) {
      // A loop back onto the same lifeline: two anchors a little apart, and a
      // polyline out to the right and back. Both ends leave rightwards, which
      // is what makes the two horizontal runs parallel.
      const bottom = cursor + SELF_MESSAGE_DROP;
      const source = messagePoint(message.from, cursor, index);
      const target = messagePoint(message.to, bottom, index);
      const reach = centreX(fromColumn) + SELF_MESSAGE_REACH;
      messageEdges.push({
        ...common,
        source,
        target,
        sourceAnchor: { side: 'right', t: 0.5 },
        targetAnchor: { side: 'right', t: 0.5 },
        waypoints: [
          { x: reach, y: cursor },
          { x: reach, y: bottom },
        ],
      });
      lowest = bottom;
      cursor = bottom + MESSAGE_GAP;
      return;
    }

    const rightwards = toColumn > fromColumn;
    const source = messagePoint(message.from, cursor, index);
    const target = messagePoint(message.to, cursor, index);
    messageEdges.push({
      ...common,
      source,
      target,
      sourceAnchor: { side: rightwards ? 'right' : 'left', t: 0.5 },
      targetAnchor: { side: rightwards ? 'left' : 'right', t: 0.5 },
    });
    lowest = cursor;
    cursor += MESSAGE_GAP;
  });

  const bottomY = lowest + LIFELINE_TAIL;
  const lifelineEnds: SequenceLayoutNode[] = [];
  const lifelineEdges: SequenceLayoutEdge[] = [];

  participantNodes.forEach((participant, index) => {
    const id = nextId();
    lifelineEnds.push({
      id,
      label: '',
      position: { x: offsetX, y: bottomY - origin.y },
      width: ANCHOR_SIZE,
      height: ANCHOR_SIZE,
      parentId: participant.id,
      sequence: { role: 'lifelineEnd', participant: participant.id },
    });
    lifelineEdges.push({
      id: nextId(),
      source: participant.id,
      target: id,
      label: '',
      connectorType: 'straight',
      strokeStyle: 'dashed',
      endArrowStyle: 'none',
      sourceAnchor: { side: 'bottom', t: 0.5 },
      targetAnchor: { side: 'top', t: 0.5 },
      sequence: { kind: 'lifeline', index },
    });
  });

  return {
    // Parents first — React Flow reads the array in order, and every anchor
    // hangs off a participant.
    nodes: [...participantNodes, ...lifelineEnds, ...messagePoints],
    // Lifelines first, so a message is drawn over the dashed line it crosses.
    edges: [...lifelineEdges, ...messageEdges],
  };
}
