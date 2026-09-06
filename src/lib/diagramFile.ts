/**
 * The `.json` file behind Export as JSON / Import.
 *
 * The file is the diagram's own persisted shape plus the name it was saved
 * under: `{ version, title, data }`. `data` is handed back exactly as written
 * rather than validated here — `migrateDiagramData` is the single door into the
 * store and knows how to upgrade an old file or refuse a newer one.
 */
import type { DiagramData } from '../../shared/types';
import { CURRENT_DIAGRAM_VERSION } from './diagramMigrations';

/** Used when a file carries no usable title of its own. */
export const IMPORTED_DIAGRAM_TITLE = 'Imported diagram';

/**
 * A file name for a downloaded diagram. Titles are free text, so the
 * characters a filesystem (or a Content-Disposition header) would choke on are
 * folded to a dash rather than handed to the browser as they were typed.
 */
export function diagramFileName(title: string, extension: string): string {
  const base = title
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 100)
    // A name starting with a dot is a hidden file, which is not what someone
    // who titled their diagram ".plan" asked for, and a title that was all
    // reserved characters must not come out as a bare dash.
    .replace(/^[-.\s]+/, '')
    .replace(/[-\s]+$/, '');
  return `${base || 'diagram'}.${extension}`;
}

export interface DiagramExport {
  version: number;
  title: string;
  data: DiagramData;
}

/** The exact JSON written to an exported file. */
export function buildDiagramExport(title: string, data: DiagramData): DiagramExport {
  return { version: CURRENT_DIAGRAM_VERSION, title: title.trim() || 'Untitled', data };
}

/**
 * Reads an exported file back.
 *
 * @throws when the text is not JSON, or is JSON without a diagram in it.
 */
export function parseDiagramExport(text: string): { title: string; data: unknown } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('That file does not contain a diagram.');
  }

  const { title, data } = parsed as { title?: unknown; data?: unknown };
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('That file does not contain a diagram.');
  }

  return {
    title: typeof title === 'string' && title.trim() !== '' ? title.trim() : IMPORTED_DIAGRAM_TITLE,
    data,
  };
}
