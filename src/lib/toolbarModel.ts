/** The named controls the pure slot mapping can place in each toolbar. */
export type Slot =
  | 'text'
  | 'changeShape'
  | 'color'
  | 'table'
  | 'headerRow'
  | 'fillStyle'
  | 'style'
  | 'filterSelection'
  | 'duplicate'
  | 'addComment'
  | 'moreActions'
  | 'connectorKind'
  | 'line'
  | 'startArrow'
  | 'endArrow'
  | 'resetRoute'
  | 'finishEditing'
  | 'textSize'
  | 'textStyle'
  | 'link'
  | 'horizontalAlign'
  | 'verticalAlign'
  | 'separator';

/** Only the selection facts that decide which shape-bar controls can appear. */
export interface ShapeBarSummary {
  selectedNodes: number;
  textableNodes: number;
  swappableNodes: number;
  colourableNodes: number;
  styleableNodes: number;
  /** True only for exactly one selected table with table data. */
  tableNode: boolean;
  /** The `comment.addToSelection` command's `when` result. */
  canAddComment: boolean;
}

function joinGroups(groups: Slot[][]): Slot[] {
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) => index === 0 ? group : ['separator', ...group]);
}

/** Shape-selection controls in §3.3 order, with separators only between live groups. */
export function shapeBarSlots(summary: ShapeBarSummary): Slot[] {
  if (summary.selectedNodes === 0) return [];

  const content: Slot[] = [];
  if (summary.textableNodes > 0) content.push('text');
  if (summary.swappableNodes > 0) content.push('changeShape');

  const colour: Slot[] = summary.colourableNodes > 0 ? ['color'] : [];
  const table: Slot[] = summary.tableNode ? ['table', 'headerRow'] : [];
  const style: Slot[] = summary.styleableNodes > 0 ? ['fillStyle', 'style'] : [];
  const filter: Slot[] = summary.selectedNodes > 1 ? ['filterSelection'] : [];
  const actions: Slot[] = [];
  if (summary.selectedNodes > 0) actions.push('duplicate');
  if (summary.selectedNodes === 1 && summary.canAddComment) actions.push('addComment');
  actions.push('moreActions');

  return joinGroups([content, colour, table, style, filter, actions]);
}

/** Connector controls in §4 order; Reset route is present only for a bent route. */
export function connectorBarSlots(hasWaypoints: boolean): Slot[] {
  return joinGroups([
    ['text'],
    ['color'],
    ['connectorKind'],
    ['line'],
    ['startArrow', 'endArrow'],
    [...(hasWaypoints ? ['resetRoute' as const] : []), 'moreActions'],
  ]);
}

/** Text-mode controls; `multi` also covers the locked-node local text-mode path. */
export function textBarSlots(
  target: 'shape' | 'connectorLabel',
  multi: boolean,
): Slot[] {
  const groups: Slot[][] = [
    ['finishEditing'],
    ['textSize'],
    ['textStyle'],
  ];

  if (target === 'shape' && !multi) groups.push(['link']);
  if (target === 'shape') groups.push(['horizontalAlign', 'verticalAlign']);
  return joinGroups(groups);
}
