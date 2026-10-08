import { ChevronLeft } from 'lucide-react';
import { consumeSuppressBlur, suppressNextBlurCommit } from '../../store/useDiagramStore';
import type { TextFormatValue } from '../../lib/text';
import { textBarSlots } from '../../lib/toolbarModel';
import { Separator, ToolButton } from './chrome';
import { TextFormatControls } from '../TextFormatControls';

export function TextBar({
  value,
  target,
  link,
  multi,
  onChange,
  onFinish,
}: {
  value: TextFormatValue;
  target: 'shape' | 'connectorLabel';
  link: { active: boolean; onOpen: () => void } | null;
  multi: boolean;
  onChange: (patch: Partial<TextFormatValue>) => void;
  onFinish: () => void;
}) {
  const slots = textBarSlots(target, multi);
  return (
    <div
      role="group"
      aria-label="Text toolbar"
      className="pointer-events-auto flex items-center gap-0"
      onMouseDown={(event) => {
        event.preventDefault();
        suppressNextBlurCommit();
      }}
    >
      <ToolButton
        label="Finish editing"
        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onClick={() => {
          consumeSuppressBlur();
          onFinish();
        }}
      >
        <ChevronLeft size={16} />
      </ToolButton>
      <Separator />
      <TextFormatControls
        value={value}
        target={target}
        keepEditorFocus
        link={slots.includes('link') ? link : null}
        onChange={onChange}
      />
    </div>
  );
}
