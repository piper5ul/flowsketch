import { ArrowRight, CornerDownRight, RotateCcw, Spline, Type } from 'lucide-react';
import { swatchFromHex } from '../../lib/palette';
import { connectorBarSlots, type Slot } from '../../lib/toolbarModel';
import { DEFAULT_END_ARROW, DEFAULT_START_ARROW, DEFAULT_STROKE_WIDTH } from '../../lib/defaults';
import { useDiagramStore, type ConnectorEdge } from '../../store/useDiagramStore';
import type { CommandContext } from '../../commands/types';
import type { ArrowStyle, ConnectorKind, StrokeStyle, StrokeWidth, SwatchColor } from '../../types';
import { ColorPicker } from './ColorPicker';
import { OverflowMenu } from './OverflowMenu';
import { ArrowStylePicker } from './ArrowStylePicker';
import { LinePopover } from './LinePopover';
import { Separator, Segmented, ToolButton } from './chrome';

const KINDS: [ConnectorKind, typeof ArrowRight, string][] = [
  ['straight', ArrowRight, 'Straight line'],
  ['elbow', CornerDownRight, 'Elbow line'],
  ['curved', Spline, 'Curved line'],
];

export function ConnectorBar({
  edges,
  activeColorId,
  triggerColour,
  hasWaypoints,
  textShortcut,
  ctx,
  onPickColor,
  onEnterText,
  onRunCommand,
}: {
  edges: ConnectorEdge[];
  activeColorId: string | null;
  triggerColour: string | null;
  hasWaypoints: boolean;
  textShortcut: string;
  ctx: CommandContext;
  onPickColor: (swatch: SwatchColor) => void;
  onEnterText: () => void;
  onRunCommand: (id: string) => void;
}) {
  const updateSelectedEdgesStyle = useDiagramStore((state) => state.updateSelectedEdgesStyle);
  const slots = connectorBarSlots(hasWaypoints);
  const first = edges[0];
  const connectorType = first?.data?.connectorType ?? 'elbow';
  const strokeStyle: StrokeStyle = first?.data?.strokeStyle ?? 'solid';
  const strokeWidth: StrokeWidth = first?.data?.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  const startArrowStyle: ArrowStyle = first?.data?.startArrowStyle ?? DEFAULT_START_ARROW;
  const endArrowStyle: ArrowStyle = first?.data?.endArrowStyle ?? DEFAULT_END_ARROW;

  const control = (slot: Slot, key: number) => {
    if (slot === 'separator') return <Separator key={`sep-${key}`} />;
    if (slot === 'text') return <ToolButton key={slot} label="Text" shortcut={textShortcut} onClick={onEnterText}><Type size={16} /></ToolButton>;
    if (slot === 'color') return (
      <ColorPicker key={slot} target="edge" activeId={activeColorId} triggerColour={triggerColour} onPick={onPickColor} onCustom={(hex) => onPickColor(swatchFromHex(hex))} />
    );
    if (slot === 'connectorKind') return (
      <Segmented key={slot} label="Line kind">
        {KINDS.map(([kind, Icon, label]) => (
          <ToolButton key={kind} label={label} active={connectorType === kind} onClick={() => updateSelectedEdgesStyle({ connectorType: kind })}>
            <Icon size={16} />
          </ToolButton>
        ))}
      </Segmented>
    );
    if (slot === 'line') return <LinePopover key={slot} strokeStyle={strokeStyle} strokeWidth={strokeWidth} onChange={updateSelectedEdgesStyle} />;
    if (slot === 'startArrow') return <ArrowStylePicker key={slot} side="start" value={startArrowStyle} onChange={(startArrowStyle) => updateSelectedEdgesStyle({ startArrowStyle })} />;
    if (slot === 'endArrow') return <ArrowStylePicker key={slot} side="end" value={endArrowStyle} onChange={(endArrowStyle) => updateSelectedEdgesStyle({ endArrowStyle })} />;
    if (slot === 'resetRoute') return <ToolButton key={slot} label="Reset route" onClick={() => updateSelectedEdgesStyle({ waypoints: [] })}><RotateCcw size={16} /></ToolButton>;
    if (slot === 'moreActions') return <OverflowMenu key={slot} ctx={ctx} target="edge" onRun={onRunCommand} />;
    return null;
  };

  return <>{slots.map((slot, index) => control(slot, index))}</>;
}
