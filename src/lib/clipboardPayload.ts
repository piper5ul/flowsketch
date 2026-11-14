import type { ClipboardPayload } from '../store/useDiagramStore';
import { CURRENT_DIAGRAM_VERSION, migrateDiagramData } from './diagramMigrations';

/** HTML survives the system clipboard between browsers; labels remain useful in other apps. */
export function encodeClipboardPayload(clip: ClipboardPayload): { html: string; text: string } {
  const json = JSON.stringify({ version: CURRENT_DIAGRAM_VERSION, nodes: clip.nodes, edges: clip.edges });
  return {
    html: `<div data-flowsketch="${encodeURIComponent(json)}"></div>`,
    text: [...clip.nodes, ...clip.edges].map((element) => element.data?.label).filter(Boolean).join('\n'),
  };
}

/** Clipboard JSON passes through the same migrations and style narrowing as a stored board. */
export function decodeClipboardPayload(html: string): ClipboardPayload | null {
  const marker = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-flowsketch]');
  const encoded = marker?.getAttribute('data-flowsketch');
  if (!encoded) return null;
  try {
    const { nodes, edges } = migrateDiagramData(JSON.parse(decodeURIComponent(encoded)));
    return { nodes: nodes as ClipboardPayload['nodes'], edges: edges as ClipboardPayload['edges'] };
  } catch {
    return null;
  }
}
