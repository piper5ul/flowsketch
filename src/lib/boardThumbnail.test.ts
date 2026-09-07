import { describe, expect, it } from 'vitest';
import { isSameThumbnail, sanitizeThumbnailIds, thumbnailSubsetIds } from './boardThumbnail';

describe('sanitizeThumbnailIds', () => {
  it('keeps a list of ids as it is', () => {
    expect(sanitizeThumbnailIds(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('is null for anything that is not a list', () => {
    expect(sanitizeThumbnailIds(undefined)).toBeNull();
    expect(sanitizeThumbnailIds(null)).toBeNull();
    expect(sanitizeThumbnailIds('a')).toBeNull();
    expect(sanitizeThumbnailIds({ 0: 'a' })).toBeNull();
    expect(sanitizeThumbnailIds(7)).toBeNull();
  });

  it('is null for an empty list — the same thing as an absent field', () => {
    expect(sanitizeThumbnailIds([])).toBeNull();
  });

  // The column is free-form JSON and the document is written by other browsers.
  it('drops everything in the list that is not a non-empty string', () => {
    expect(sanitizeThumbnailIds(['a', '', null, 3, { id: 'b' }, ['c'], 'd'])).toEqual(['a', 'd']);
  });

  it('is null when nothing in the list was an id', () => {
    expect(sanitizeThumbnailIds([null, 0, ''])).toBeNull();
  });

  it('collapses duplicates, which would draw a shape twice and misreport the selection', () => {
    expect(sanitizeThumbnailIds(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });
});

describe('thumbnailSubsetIds', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }];

  it('is the ids that are still on the board, in the order they were stored', () => {
    expect(thumbnailSubsetIds(['b', 'a'], nodes)).toEqual(['b', 'a']);
  });

  it('leaves out an id whose shape has been deleted', () => {
    expect(thumbnailSubsetIds(['a', 'gone'], nodes)).toEqual(['a']);
  });

  it('is empty when nothing it names is left — the caller falls back to the whole board', () => {
    expect(thumbnailSubsetIds(['gone'], nodes)).toEqual([]);
  });

  it('is empty for a board with no custom thumbnail', () => {
    expect(thumbnailSubsetIds(null, nodes)).toEqual([]);
    expect(thumbnailSubsetIds(undefined, nodes)).toEqual([]);
    expect(thumbnailSubsetIds([], nodes)).toEqual([]);
  });
});

describe('isSameThumbnail', () => {
  it('is true for the same ids in any order — a selection is a set', () => {
    expect(isSameThumbnail(['a', 'b'], ['b', 'a'])).toBe(true);
  });

  it('is false when the selection is bigger, smaller or different', () => {
    expect(isSameThumbnail(['a'], ['a', 'b'])).toBe(false);
    expect(isSameThumbnail(['a', 'b'], ['a'])).toBe(false);
    expect(isSameThumbnail(['a'], ['b'])).toBe(false);
  });

  it('is false for a board with no custom thumbnail, whatever is selected', () => {
    expect(isSameThumbnail(null, ['a'])).toBe(false);
    expect(isSameThumbnail(null, [])).toBe(false);
    expect(isSameThumbnail([], [])).toBe(false);
  });
});
