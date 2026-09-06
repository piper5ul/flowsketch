import { describe, expect, it } from 'vitest';
import {
  IMPORTED_DIAGRAM_TITLE,
  buildDiagramExport,
  diagramFileName,
  parseDiagramExport,
} from './diagramFile';
import { CURRENT_DIAGRAM_VERSION } from './diagramMigrations';
import type { DiagramData } from '../../shared/types';

const data: DiagramData = {
  version: CURRENT_DIAGRAM_VERSION,
  nodes: [{ id: 'n1', type: 'shape', position: { x: 0, y: 0 }, data: { label: 'Hi' } }],
  edges: [],
};

describe('buildDiagramExport', () => {
  it('stamps the format version alongside the title and data', () => {
    expect(buildDiagramExport('Roadmap', data)).toEqual({
      version: CURRENT_DIAGRAM_VERSION,
      title: 'Roadmap',
      data,
    });
  });

  it('names an untitled diagram rather than writing a blank title', () => {
    expect(buildDiagramExport('   ', data).title).toBe('Untitled');
  });
});

describe('parseDiagramExport', () => {
  it('reads back what buildDiagramExport wrote', () => {
    const text = JSON.stringify(buildDiagramExport('Roadmap', data));
    expect(parseDiagramExport(text)).toEqual({ title: 'Roadmap', data });
  });

  it('hands the data back untouched, for migrateDiagramData to judge', () => {
    const legacy = { nodes: [{ id: 'n1' }], edges: [], somethingNewer: true };
    expect(parseDiagramExport(JSON.stringify({ title: 'Old', data: legacy })).data).toEqual(legacy);
  });

  it('names a file that has no usable title', () => {
    for (const title of [undefined, '', '   ', 42]) {
      expect(parseDiagramExport(JSON.stringify({ title, data })).title).toBe(IMPORTED_DIAGRAM_TITLE);
    }
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseDiagramExport('')).toThrow(/not valid JSON/);
    expect(() => parseDiagramExport('<svg/>')).toThrow(/not valid JSON/);
  });

  it('rejects JSON with no diagram in it', () => {
    expect(() => parseDiagramExport(JSON.stringify({ title: 'No data' }))).toThrow(/does not contain a diagram/);
    expect(() => parseDiagramExport(JSON.stringify({ title: 'x', data: null }))).toThrow(/does not contain a diagram/);
    expect(() => parseDiagramExport(JSON.stringify({ data: 'nodes' }))).toThrow(/does not contain a diagram/);
    expect(() => parseDiagramExport(JSON.stringify([data]))).toThrow(/does not contain a diagram/);
    expect(() => parseDiagramExport('"just a string"')).toThrow(/does not contain a diagram/);
  });
});

describe('diagramFileName', () => {
  it('keeps a plain title as it was typed', () => {
    expect(diagramFileName('Q3 Roadmap', 'json')).toBe('Q3 Roadmap.json');
  });

  it('folds path separators and other reserved characters to a dash', () => {
    expect(diagramFileName('roadmap/2026', 'png')).toBe('roadmap-2026.png');
    expect(diagramFileName('a:b*c?d"e<f>g|h', 'svg')).toBe('a-b-c-d-e-f-g-h.svg');
  });

  it('never produces a hidden file or an empty name', () => {
    expect(diagramFileName('.plan', 'json')).toBe('plan.json');
    expect(diagramFileName('   ', 'json')).toBe('diagram.json');
    expect(diagramFileName('///', 'json')).toBe('diagram.json');
  });

  it('caps a very long title', () => {
    expect(diagramFileName('x'.repeat(300), 'json')).toBe(`${'x'.repeat(100)}.json`);
  });
});
