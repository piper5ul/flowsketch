import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOTS_PER_PERSON,
  MAX_DOTS_PER_PERSON,
  canVote,
  dotsLeft,
  dotsUsed,
  sanitizeVotes,
  sanitizeVotingSession,
  sortedByVotes,
  voteCount,
  voteCounts,
  voteRowPositions,
  votesBy,
  votesOf,
  type VotableNode,
} from './voting';

function node(id: string, votes?: Record<string, unknown>): VotableNode {
  return { id, data: votes === undefined ? {} : { votes } };
}

describe('sanitizeVotes', () => {
  it('keeps whole positive counts and drops everything else', () => {
    expect(
      sanitizeVotes({ ada: 2, grace: 0, alan: -1, edsger: 1.5, '': 3, ken: 'two', dennis: 1 }),
    ).toEqual({ ada: 2, edsger: 1, dennis: 1 });
  });

  it('is undefined for a shape nobody has voted for, however that is spelled', () => {
    expect(sanitizeVotes(undefined)).toBeUndefined();
    expect(sanitizeVotes(null)).toBeUndefined();
    expect(sanitizeVotes({})).toBeUndefined();
    // Every entry dropped is the same thing as no entries.
    expect(sanitizeVotes({ ada: 0 })).toBeUndefined();
    // A free-form JSON column holds anything, including the wrong shape.
    expect(sanitizeVotes(['ada'])).toBeUndefined();
    expect(sanitizeVotes('ada')).toBeUndefined();
  });

  it('rounds a fractional count down rather than accepting it whole', () => {
    // 1.5 dots is not something this app wrote; a dot and a half is not a vote.
    expect(sanitizeVotes({ ada: 2.9 })).toEqual({ ada: 2 });
  });
});

describe('counting', () => {
  const board = [node('a', { ada: 2, grace: 1 }), node('b', { ada: 1 }), node('c')];

  it('totals a shape and the board', () => {
    expect(voteCount(board[0])).toBe(3);
    expect(voteCount(board[2])).toBe(0);
    expect(voteCounts(board)).toEqual(new Map([['a', 3], ['b', 1]]));
  });

  it('leaves shapes nobody voted for out of the counts entirely', () => {
    // "Which shapes are in this round" is asked as often as "how many", and an
    // entry of 0 per shape would answer the first one wrongly.
    expect(voteCounts(board).has('c')).toBe(false);
  });

  it('reads one person’s dots, and none at all for nobody', () => {
    expect(votesBy(board[0], 'ada')).toBe(2);
    expect(votesBy(board[0], 'alan')).toBe(0);
    expect(votesBy(board[0], null)).toBe(0);
  });

  it('narrows on the way out, so a peer’s nonsense never reaches a total', () => {
    expect(votesOf(node('x', { ada: 'lots' }))).toEqual({});
    expect(voteCount(node('x', { ada: 'lots', grace: 2 }))).toBe(2);
  });

  it('spends a budget across the whole board, never per shape', () => {
    expect(dotsUsed(board, 'ada')).toBe(3);
    expect(dotsLeft(board, 'ada', 5)).toBe(2);
    expect(dotsLeft(board, 'grace', 5)).toBe(4);
  });

  it('never reports a negative budget', () => {
    // A round whose budget was lowered under somebody, or a peer's write that
    // spent more than this build allows: they simply cannot place another.
    expect(dotsLeft(board, 'ada', 1)).toBe(0);
  });
});

describe('canVote', () => {
  const session = { active: true, revealed: false, dotsPerPerson: 3, startedById: 'ada' };
  const board = [node('a', { ada: 3 })];

  it('needs an open round, a name and a dot in hand', () => {
    expect(canVote(session, [node('a')], 'ada')).toBe(true);
    // No round.
    expect(canVote(null, [node('a')], 'ada')).toBe(false);
    // Closed round: the totals are out, so the vote is over.
    expect(canVote({ ...session, active: false, revealed: true }, [node('a')], 'ada')).toBe(false);
    // Nobody to attribute it to — the public share page.
    expect(canVote(session, [node('a')], null)).toBe(false);
    // Budget spent.
    expect(canVote(session, board, 'ada')).toBe(false);
  });
});

describe('sortedByVotes', () => {
  it('puts the most-voted first and drops the shapes nobody chose', () => {
    const ordered = sortedByVotes([
      node('a', { ada: 1 }),
      node('b'),
      node('c', { ada: 2, grace: 1 }),
      node('d', { grace: 2 }),
    ]);
    expect(ordered.map((n) => n.id)).toEqual(['c', 'd', 'a']);
  });

  it('breaks ties by id, so every window sorts the same board the same way', () => {
    const ordered = sortedByVotes([node('z', { ada: 1 }), node('a', { grace: 1 })]);
    expect(ordered.map((n) => n.id)).toEqual(['a', 'z']);
  });
});

describe('voteRowPositions', () => {
  const rects = [
    { id: 'a', x: 200, y: 400, w: 100, h: 100 },
    { id: 'b', x: 0, y: 100, w: 160, h: 160 },
    { id: 'c', x: 50, y: 900, w: 100, h: 60 },
  ];

  it('lays the row out from the group’s own corner, so the drawing does not jump', () => {
    const positions = voteRowPositions(rects, 40);
    // Left edge of the leftmost, top edge of the topmost — the bounding box's
    // own corner, the rule `applyLayout` keeps.
    expect(positions.a.x).toBe(0);
    expect(positions.b.x).toBe(0 + 100 + 40);
    expect(positions.c.x).toBe(140 + 160 + 40);
  });

  it('centres each shape on the tallest, so short and tall read as one line', () => {
    const positions = voteRowPositions(rects, 40);
    expect(positions.b.y).toBe(100);
    expect(positions.a.y).toBe(100 + (160 - 100) / 2);
    expect(positions.c.y).toBe(100 + (160 - 60) / 2);
  });

  it('is empty for nothing', () => {
    expect(voteRowPositions([], 40)).toEqual({});
  });
});

describe('sanitizeVotingSession', () => {
  const round = { active: true, revealed: false, dotsPerPerson: 3, startedById: 'ada' };

  it('accepts a round with every field it acts on', () => {
    expect(sanitizeVotingSession(round)).toEqual(round);
  });

  it('is null for a value missing any of them', () => {
    // Each field decides something a reader acts on, so a value without one is
    // no round at all — which is the same thing as an absent field.
    expect(sanitizeVotingSession({ ...round, active: undefined })).toBeNull();
    expect(sanitizeVotingSession({ ...round, revealed: 'yes' })).toBeNull();
    expect(sanitizeVotingSession({ ...round, startedById: '' })).toBeNull();
    expect(sanitizeVotingSession({ ...round, dotsPerPerson: 'three' })).toBeNull();
    expect(sanitizeVotingSession(null)).toBeNull();
    expect(sanitizeVotingSession([round])).toBeNull();
  });

  it('clamps a budget rather than throwing the round away for it', () => {
    // A peer running another build could reasonably pick a number this one
    // would not; a round everybody can see beats one that silently vanished.
    expect(sanitizeVotingSession({ ...round, dotsPerPerson: 900 })?.dotsPerPerson).toBe(
      MAX_DOTS_PER_PERSON,
    );
    expect(sanitizeVotingSession({ ...round, dotsPerPerson: 0 })?.dotsPerPerson).toBe(1);
    expect(sanitizeVotingSession({ ...round, dotsPerPerson: 3.7 })?.dotsPerPerson).toBe(3);
  });

  it('has a default worth defaulting to', () => {
    expect(DEFAULT_DOTS_PER_PERSON).toBeGreaterThan(0);
    expect(DEFAULT_DOTS_PER_PERSON).toBeLessThanOrEqual(MAX_DOTS_PER_PERSON);
  });
});
