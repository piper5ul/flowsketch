import {
  Copy,
  EyeOff,
  PanelTop,
  Rows,
  Rows3,
  Columns,
  Columns3,
  MessageSquarePlus,
  Type,
} from 'lucide-react';
import { Fragment } from 'react';
import { swatchFromHex } from '../../lib/palette';
import type { FillLook } from '../../lib/shapeStyle';
import { addColumn, addRow, removeColumn, removeRow } from '../../lib/table';
import { canRoundCorners } from '../../lib/nodeKinds';
import { shapeBarSlots, type ShapeBarSummary, type Slot } from '../../lib/toolbarModel';
import { useDiagramStore, type ShapeNode } from '../../store/useDiagramStore';
import type { CommandContext } from '../../commands/types';
import { formatShortcut, registry } from '../../commands/commands';
import type { ShapeData, ShapeKind, SwatchColor, TableData } from '../../types';
import { ColorPicker } from './ColorPicker';
import { FilterSelectionMenu } from '../FilterSelectionMenu';
import { OverflowMenu } from './OverflowMenu';
import { ShapePicker } from './ShapePicker';
import { StylePopover } from './StylePopover';
import { Separator, Segmented, ToolButton } from './chrome';

function TableOperations({ node }: { node: ShapeNode & { data: ShapeData & { table: TableData } } }) {
  const updateNodeData = useDiagramStore((state) => state.updateNodeData);
  const activeTableCell = useDiagramStore((state) => state.activeTableCell);
  const cell = activeTableCell?.nodeId === node.id ? activeTableCell : null;
  const apply = (table: TableData) => updateNodeData(node.id, { table });
  return (
    <>
      <Segmented label="Table">
        <ToolButton label="Add row" onClick={() => apply(addRow(node.data.table, cell ? cell.row + 1 : undefined))}><Rows3 size={16} /></ToolButton>
        <ToolButton label="Remove row" onClick={() => apply(removeRow(node.data.table, cell?.row))}><Rows size={16} /></ToolButton>
        <ToolButton label="Add column" onClick={() => apply(addColumn(node.data.table, cell ? cell.col + 1 : undefined))}><Columns3 size={16} /></ToolButton>
        <ToolButton label="Remove column" onClick={() => apply(removeColumn(node.data.table, cell?.col))}><Columns size={16} /></ToolButton>
      </Segmented>
      <ToolButton label="Header row" active={node.data.table.header} onClick={() => apply({ ...node.data.table, header: !node.data.table.header })}>
        <PanelTop size={16} />
      </ToolButton>
    </>
  );
}

export function ShapeBar({
  nodes,
  textableNodes,
  swappableNodes,
  colourableNodes,
  styleableNodes,
  tableNode,
  currentShapeKind,
  activeColorId,
  triggerColour,
  fillLook,
  allTransparent,
  canAddComment,
  textShortcut,
  ctx,
  onPickColor,
  onEnterText,
  onRunCommand,
}: {
  nodes: ShapeNode[];
  textableNodes: ShapeNode[];
  swappableNodes: ShapeNode[];
  colourableNodes: ShapeNode[];
  styleableNodes: ShapeNode[];
  tableNode: ShapeNode | null;
  currentShapeKind: ShapeKind | null;
  activeColorId: string | null;
  triggerColour: string | null;
  fillLook: FillLook | null;
  allTransparent: boolean;
  canAddComment: boolean;
  textShortcut: string;
  ctx: CommandContext;
  onPickColor: (swatch: SwatchColor) => void;
  onEnterText: () => void;
  onRunCommand: (id: string) => void;
}) {
  const updateSelectedNodesData = useDiagramStore((state) => state.updateSelectedNodesData);
  const toggleSelectedNodesTransparent = useDiagramStore((state) => state.toggleSelectedNodesTransparent);
  const updateSelectedNodesDataTransient = useDiagramStore((state) => state.updateSelectedNodesDataTransient);
  const beginInteraction = useDiagramStore((state) => state.beginInteraction);
  const setSelectedShapeKind = useDiagramStore((state) => state.setSelectedShapeKind);
  const slots = shapeBarSlots({
    selectedNodes: nodes.length,
    textableNodes: textableNodes.length,
    swappableNodes: swappableNodes.length,
    colourableNodes: colourableNodes.length,
    styleableNodes: styleableNodes.length,
    tableNode: !!tableNode,
    canAddComment,
  } satisfies ShapeBarSummary);
  const firstStyleable = styleableNodes[0];
  const control = (slot: Slot, key: number) => {
    if (slot === 'separator') return <Separator key={`sep-${key}`} />;
    if (slot === 'text') return <ToolButton key={slot} label="Text" shortcut={textShortcut} onClick={onEnterText}><Type size={16} /></ToolButton>;
    if (slot === 'changeShape') return <ShapePicker key={slot} current={currentShapeKind} onPick={setSelectedShapeKind} />;
    if (slot === 'color') return (
      <ColorPicker key={slot} target="shape" activeId={activeColorId} triggerColour={triggerColour} onPick={onPickColor} onCustom={(hex) => onPickColor(swatchFromHex(hex))} />
    );
    if (slot === 'table' && tableNode?.data.table) return <TableOperations key={slot} node={tableNode as ShapeNode & { data: ShapeData & { table: TableData } }} />;
    if (slot === 'headerRow') return null;
    if (slot === 'fillStyle') return (
      <Fragment key={`fill-${key}`}>
        <Segmented key="fill-style" label="Fill style">
          {([['fill', 'Fill', 'filled'], ['outline', 'Outline', 'tinted'], ['dash', 'Dash', 'dashed']] as const).map(([look, label, fillStyle]) => (
            <ToolButton key={look} label={label} active={fillLook === look} onClick={() => updateSelectedNodesData(look === 'fill' ? { fillStyle, transparent: false } : { fillStyle })}>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <rect x="3.5" y="3.5" width="13" height="13" rx="3" fill={look === 'fill' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeDasharray={look === 'dash' ? '2 2' : undefined} />
              </svg>
            </ToolButton>
          ))}
        </Segmented>
        <ToolButton key="transparent" label="Transparent" active={allTransparent} onClick={toggleSelectedNodesTransparent}><EyeOff size={16} /></ToolButton>
      </Fragment>
    );
    if (slot === 'style' && firstStyleable) return (
      <StylePopover
        key={slot}
        cornerRadius={firstStyleable.data.cornerRadius ?? 0}
        opacity={firstStyleable.data.opacity ?? 1}
        shadow={firstStyleable.data.shadow ?? false}
        showCornerRadius={styleableNodes.every((node) => canRoundCorners(node.data.shape))}
        onDragStart={beginInteraction}
        onPreview={updateSelectedNodesDataTransient}
        onCommit={updateSelectedNodesData}
      />
    );
    if (slot === 'filterSelection') return <FilterSelectionMenu key={slot} />;
    if (slot === 'duplicate') return <ToolButton key={slot} label="Duplicate" shortcut={formatShortcut(registry.find('edit.duplicate')?.shortcut)} onClick={() => onRunCommand('edit.duplicate')}><Copy size={16} /></ToolButton>;
    if (slot === 'addComment') return <ToolButton key={slot} label="Add comment" onClick={() => onRunCommand('comment.addToSelection')}><MessageSquarePlus size={16} /></ToolButton>;
    if (slot === 'moreActions') return <OverflowMenu key={slot} ctx={ctx} target="node" onRun={onRunCommand} />;
    return null;
  };

  return <>{slots.map((slot, index) => control(slot, index))}</>;
}
