import { useCallback, useEffect, useRef } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import clsx from 'clsx';
import type { ShapeNode as ShapeNodeType } from '../store/useDiagramStore';
import { consumeSuppressBlur, useDiagramStore } from '../store/useDiagramStore';
import { useSearchHighlight } from '../store/useSearchStore';

/**
 * A frame: a titled section of the board that owns whatever is dropped inside
 * it.
 *
 * Unlike a group — which is a way of handling shapes and draws nothing — a
 * frame *is* part of the drawing, so it appears in exports and takes its
 * ground and its rule from the theme tokens rather than from a user-picked
 * fill. Membership is positional and settled on drop, by the store's
 * `reparentByPosition`; nothing here decides it.
 *
 * The title is edited the way a shape's label is: double-click to open it,
 * blur to commit, Escape to stop. Contents are not clipped — a shape half out
 * of its frame is drawn whole, and simply stops belonging to it when it is
 * dropped there.
 */
export function FrameNode({ id, data, selected }: NodeProps<ShapeNodeType>) {
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
  const editingNodeId = useDiagramStore((s) => s.editingNodeId);
  const setEditingNodeId = useDiagramStore((s) => s.setEditingNodeId);
  const editing = editingNodeId === id;
  const searchHit = useSearchHighlight('node', id);
  const titleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing || !titleRef.current) return;
    titleRef.current.focus();
    const range = document.createRange();
    range.selectNodeContents(titleRef.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editing]);

  const commit = useCallback(() => {
    if (consumeSuppressBlur()) return;
    setEditingNodeId(null);
    updateNodeData(id, { label: titleRef.current?.innerText.trim() ?? '' });
  }, [id, setEditingNodeId, updateNodeData]);

  return (
    <div
      data-node-type="frame"
      data-search-hit={searchHit}
      className="shape-wrapper relative h-full w-full rounded-xl"
      onDoubleClick={() => { if (!editing && !data.locked) setEditingNodeId(id); }}
      style={{
        background: 'var(--panel)',
        border: '1.5px solid var(--line)',
        boxShadow: selected ? '0 0 0 1.5px var(--color-accent-500)' : undefined,
      }}
    >
      <div
        ref={titleRef}
        contentEditable={editing}
        suppressContentEditableWarning
        data-placeholder="Frame"
        onBlur={commit}
        onKeyDown={(e) => {
          // Enter commits rather than opening a second line: a section's name
          // is one line by construction.
          if (e.key === 'Escape' || e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        className={clsx(
          'absolute left-3 top-2 max-w-[calc(100%-1.5rem)] truncate text-[13px] font-semibold text-ink-700 outline-none',
          editing && 'nodrag cursor-text',
        )}
      >
        {data.label || null}
      </div>

      <NodeResizer
        isVisible={selected && !data.locked}
        minWidth={120}
        minHeight={100}
        lineStyle={{ borderColor: 'transparent', borderWidth: 6 }}
        handleStyle={{
          width: 0,
          height: 0,
          opacity: 0,
          border: 'none',
          background: 'transparent',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
