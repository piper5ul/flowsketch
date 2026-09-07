import { describe, expect, it } from 'vitest';
import { RECENT_KEPT, rankCommands, rememberRecent, sanitizeRecents } from './commandMenu';

const cmds = [
  { id: 'fit', title: 'Fit to view' },
  { id: 'zoomIn', title: 'Zoom in' },
  { id: 'fitSel', title: 'Zoom to selection' },
  { id: 'group', title: 'Group' },
  { id: 'find', title: 'Find' },
];

describe('rankCommands', () => {
  it('leads with recents and keeps registry order behind them when nothing is typed', () => {
    expect(rankCommands('', cmds, ['find', 'gone', 'fit']).map((c) => c.id)).toEqual(['find', 'fit', 'zoomIn', 'fitSel', 'group']);
  });

  it('prefers a title that starts with the query, then a word that does, then a substring, then a subsequence', () => {
    expect(rankCommands('zo', cmds, []).map((c) => c.id)).toEqual(['zoomIn', 'fitSel']);
    expect(rankCommands('sel', cmds, []).map((c) => c.id)).toEqual(['fitSel']);
    expect(rankCommands('fi', cmds, []).map((c) => c.id)).toEqual(['fit', 'find']);
    // "gp" is not in any title, but g…p is in order in "Group".
    expect(rankCommands('gp', cmds, []).map((c) => c.id)).toEqual(['group']);
    expect(rankCommands('xyz', cmds, [])).toEqual([]);
  });

  it('ignores case and surrounding space', () => {
    expect(rankCommands('  FIT ', cmds, []).map((c) => c.id)).toEqual(['fit']);
  });
});

describe('rememberRecent', () => {
  it('moves the id to the front without duplicates and keeps only so many', () => {
    expect(rememberRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    const many = Array.from({ length: RECENT_KEPT }, (_, i) => `c${i}`);
    expect(rememberRecent(many, 'new')).toHaveLength(RECENT_KEPT);
    expect(rememberRecent(many, 'new')[0]).toBe('new');
  });
});

describe('sanitizeRecents', () => {
  it('keeps only strings from whatever was stored', () => {
    expect(sanitizeRecents(['a', 3, null, 'b'])).toEqual(['a', 'b']);
    expect(sanitizeRecents('nope')).toEqual([]);
    expect(sanitizeRecents(null)).toEqual([]);
  });
});
