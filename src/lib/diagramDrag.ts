/**
 * Dragging a dashboard card onto a folder.
 *
 * Its own module rather than a pair of extra exports beside the sidebar
 * component: both ends of the drag need them — the card that starts it and the
 * folder row that accepts it — and a component file that also exports
 * constants loses fast refresh.
 */

/**
 * The drag payload a dashboard card carries: the diagram's id, under a type
 * only this app writes.
 *
 * A custom MIME type rather than `text/plain` for two reasons — a folder row
 * can tell a card being dragged from text dragged in from another window (the
 * type shows up in `dataTransfer.types` during `dragover`, where the *value*
 * is deliberately not readable), and nothing outside the dashboard
 * accidentally accepts a diagram id it cannot use.
 */
export const DIAGRAM_DRAG_TYPE = 'application/x-flowsketch-diagram';

/** True when a drag event is carrying one of our cards. */
export function isDiagramDrag(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(DIAGRAM_DRAG_TYPE);
}
