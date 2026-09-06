import { beforeEach, describe, expect, it } from 'vitest';
import { highlightOf, useSearchStore } from './useSearchStore';
import { useDiagramStore } from './useDiagramStore';

const search = () => useSearchStore.getState();

/** Puts three shapes and one labelled connector on the board, top to bottom. */
function seedDiagram() {
  useDiagramStore.getState().loadDiagram('d1', 'Search', false, {
    nodes: [
      { id: 'n1', type: 'shape', position: { x: 0, y: 0 }, data: { label: 'Alpha' } },
      { id: 'n2', type: 'shape', position: { x: 0, y: 200 }, data: { label: 'Beta' } },
      { id: 'n3', type: 'shape', position: { x: 0, y: 400 }, data: { label: 'Alphabet' } },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2', data: { label: 'alpha edge' } }],
  });
}

beforeEach(() => {
  seedDiagram();
  useSearchStore.setState({ open: false, query: '', hits: [], activeIndex: -1 });
});

describe('useSearchStore', () => {
  it('starts closed, with nothing typed and nothing to point at', () => {
    expect(search().open).toBe(false);
    expect(search().hits).toEqual([]);
    expect(search().activeIndex).toBe(-1);
  });

  it('runs the query against the board and lands on the first hit', () => {
    search().setQuery('alpha');
    expect(search().hits.map((hit) => hit.id)).toEqual(['n1', 'n3', 'e1']);
    expect(search().activeIndex).toBe(0);
  });

  it('has nothing to point at when the query matches nothing', () => {
    search().setQuery('nothing here');
    expect(search().hits).toEqual([]);
    expect(search().activeIndex).toBe(-1);
  });

  it('cycles forwards and wraps past the end', () => {
    search().setQuery('alpha');
    search().next();
    expect(search().activeIndex).toBe(1);
    search().next();
    expect(search().activeIndex).toBe(2);
    search().next();
    expect(search().activeIndex).toBe(0);
  });

  it('cycles backwards and wraps past the start', () => {
    search().setQuery('alpha');
    search().prev();
    expect(search().activeIndex).toBe(2);
    search().prev();
    expect(search().activeIndex).toBe(1);
  });

  it('does not move when there is nothing to move between', () => {
    search().setQuery('nothing here');
    search().next();
    expect(search().activeIndex).toBe(-1);
    search().prev();
    expect(search().activeIndex).toBe(-1);
  });

  it('re-runs the query on every keystroke, back to the first hit', () => {
    search().setQuery('alpha');
    search().next();
    search().setQuery('alphab');
    expect(search().hits.map((hit) => hit.id)).toEqual(['n3']);
    expect(search().activeIndex).toBe(0);
  });

  it('drops every hit when the query is cleared', () => {
    search().setQuery('alpha');
    search().setQuery('');
    expect(search().hits).toEqual([]);
    expect(search().activeIndex).toBe(-1);
  });

  it('closing clears the search but leaves the diagram alone', () => {
    search().openSearch();
    search().setQuery('alpha');
    useDiagramStore.setState((state) => ({
      nodes: state.nodes.map((node) => ({ ...node, selected: node.id === 'n1' })),
    }));

    search().close();

    expect(search().open).toBe(false);
    expect(search().query).toBe('');
    expect(search().hits).toEqual([]);
    expect(search().activeIndex).toBe(-1);
    // The shape the search framed stays selected — closing the bar is not a
    // deselect, so whatever was found is still there to be worked on.
    expect(useDiagramStore.getState().nodes.find((node) => node.id === 'n1')?.selected).toBe(true);
  });
});

describe('highlightOf', () => {
  beforeEach(() => {
    search().openSearch();
    search().setQuery('alpha');
  });

  it('marks the active hit apart from the rest', () => {
    expect(highlightOf(search(), 'node', 'n1')).toBe('active');
    expect(highlightOf(search(), 'node', 'n3')).toBe('hit');
    expect(highlightOf(search(), 'edge', 'e1')).toBe('hit');
  });

  it('follows the active hit as it moves', () => {
    search().next();
    expect(highlightOf(search(), 'node', 'n1')).toBe('hit');
    expect(highlightOf(search(), 'node', 'n3')).toBe('active');
  });

  it('tells a connector from a shape that shares its id', () => {
    expect(highlightOf(search(), 'edge', 'n1')).toBeUndefined();
  });

  it('says nothing about a shape that did not match', () => {
    expect(highlightOf(search(), 'node', 'n2')).toBeUndefined();
  });

  it('says nothing at all while the bar is closed', () => {
    search().close();
    expect(highlightOf(search(), 'node', 'n1')).toBeUndefined();
  });
});
