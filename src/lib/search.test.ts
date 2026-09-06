import { describe, expect, it } from 'vitest';
import { searchDiagram, type SearchableEdge, type SearchableNode } from './search';

/** A shape at `(x, y)` saying `label`. */
function node(id: string, label: string, x = 0, y = 0): SearchableNode {
  return { id, position: { x, y }, data: { label } };
}

function edge(id: string, label: string): SearchableEdge {
  return { id, data: { label } };
}

const ids = (hits: { id: string }[]) => hits.map((hit) => hit.id);

describe('searchDiagram', () => {
  it('matches a substring of a label, whatever the case on either side', () => {
    const nodes = [node('a', 'Alphabet'), node('b', 'BETA'), node('c', 'gamma')];
    expect(ids(searchDiagram(nodes, [], 'alpha'))).toEqual(['a']);
    expect(ids(searchDiagram(nodes, [], 'ALPHA'))).toEqual(['a']);
    expect(ids(searchDiagram(nodes, [], 'bet'))).toEqual(['a', 'b']);
  });

  it('reports where in the label the match sits', () => {
    const [hit] = searchDiagram([node('a', 'Alphabet')], [], 'pha');
    expect(hit).toEqual({ kind: 'node', id: 'a', text: 'Alphabet', start: 2, end: 5 });
  });

  it('reports the first occurrence only, so the count is of shapes', () => {
    const hits = searchDiagram([node('a', 'beta beta beta')], [], 'beta');
    expect(hits).toHaveLength(1);
    expect(hits[0].start).toBe(0);
  });

  it('finds nothing for an empty query', () => {
    expect(searchDiagram([node('a', 'Alpha')], [edge('e', 'Beta')], '')).toEqual([]);
  });

  it('orders shapes down the board and then across it', () => {
    const nodes = [
      node('bottom-left', 'hit', 0, 500),
      node('top-right', 'hit', 500, 0),
      node('top-left', 'hit', 0, 0),
    ];
    expect(ids(searchDiagram(nodes, [], 'hit'))).toEqual(['top-left', 'top-right', 'bottom-left']);
  });

  it('breaks a tie by id, so the order never depends on the array', () => {
    const stacked = [node('z', 'hit'), node('a', 'hit')];
    expect(ids(searchDiagram(stacked, [], 'hit'))).toEqual(['a', 'z']);
    expect(ids(searchDiagram([...stacked].reverse(), [], 'hit'))).toEqual(['a', 'z']);
  });

  it('searches connector labels too, after every shape', () => {
    const hits = searchDiagram([node('n', 'yes please')], [edge('e', 'yes')], 'yes');
    expect(hits.map((hit) => [hit.kind, hit.id])).toEqual([
      ['node', 'n'],
      ['edge', 'e'],
    ]);
  });

  it('skips shapes and connectors with nothing written on them', () => {
    const nodes: SearchableNode[] = [{ id: 'bare', position: { x: 0, y: 0 }, data: {} }];
    const edges: SearchableEdge[] = [{ id: 'plain' }];
    expect(searchDiagram(nodes, edges, 'a')).toEqual([]);
  });

  it('leaves the caller\'s array alone while ordering its own answer', () => {
    const nodes = [node('later', 'hit', 0, 100), node('first', 'hit', 0, 0)];
    searchDiagram(nodes, [], 'hit');
    expect(ids(nodes)).toEqual(['later', 'first']);
  });
});
