import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { consumeSuppressBlur } from '../store/useDiagramStore';

/**
 * A label that is typed into in place: shapes, frames, wireframe parts and
 * connector labels all use it.
 *
 * **While it is being edited, React owns nothing inside it.** A
 * `contentEditable` whose text is also React's children is two owners of one
 * DOM: the browser rewrites the text nodes as the user types, React keeps
 * reconciling the ones it made, and any render in between — the box growing to
 * fit, a collaborator's edit arriving through the document, a selection change
 * — can put the old label back beside the new one. That is the duplicated text.
 * So the editing element renders no children at all: the stored label is
 * written into it once, when editing starts, and read back out on blur.
 *
 * **The editing and the displaying element are different elements** (keyed
 * apart), so when editing ends React mounts a fresh one for the rendered label
 * (Markdown included) instead of reconciling against whatever text nodes the
 * browser left behind.
 *
 * **The text is read before anything else happens**: `onCommit` is handed what
 * was typed, and only then does the caller close the editor. Should the editor
 * be taken away without a blur (another node opened in its place), what was
 * typed is committed on the way out rather than lost.
 */
export interface EditableLabelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onBlur' | 'contentEditable'> {
  editing: boolean;
  /** The stored text, written into the editor when editing starts. */
  value: string;
  /** Called once per edit with what was typed. */
  onCommit: (text: string) => void;
  /** Where the caret lands on opening: after the text, or with all of it selected. */
  caret?: 'end' | 'all';
  /** What is shown when not editing — the label, rendered. */
  children?: ReactNode;
  ref?: Ref<HTMLDivElement | null>;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as { current: T }).current = value;
}

export function EditableLabel({ editing, value, onCommit, caret = 'end', children, ref, ...rest }: EditableLabelProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const committed = useRef(false);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!editing || !el) return;
    committed.current = false;
    el.textContent = value;
    const place = () => {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      if (caret === 'end') range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    place();
    // A node React Flow has only just added stays hidden until it has been
    // measured, and a hidden element cannot take the focus; a label mounted
    // into a portal, or opened by the click React Flow is still turning into a
    // selection, can lose it. So the focus is retried for a few frames, until
    // it holds.
    let frame = 0;
    let tries = 10;
    const retry = () => {
      if (document.activeElement === el || !el.isConnected || --tries < 0) return;
      place();
      frame = requestAnimationFrame(retry);
    };
    frame = requestAnimationFrame(retry);
    return () => {
      cancelAnimationFrame(frame);
      // Taken away without a blur (another node opened in its place): what was
      // typed is committed rather than lost. Checked a moment later, and only
      // if the element really left the page — an effect is also cleaned up and
      // re-run in place (React's Strict Mode does exactly that), and closing
      // the editor then would close it the moment it opened.
      queueMicrotask(() => {
        if (committed.current || el.isConnected) return;
        committed.current = true;
        onCommitRef.current(el.innerText);
      });
    };
    // `value` is read once, as editing starts; a change to it while the user
    // is typing must not overwrite what they have typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (editing) {
    return (
      <div
        key="editing"
        {...rest}
        ref={(el) => {
          editorRef.current = el;
          assignRef(ref, el);
        }}
        contentEditable
        suppressContentEditableWarning
        onBlur={(e) => {
          // A formatting button took the focus for a moment: still editing.
          if (consumeSuppressBlur()) return;
          if (committed.current) return;
          committed.current = true;
          onCommitRef.current(e.currentTarget.innerText);
        }}
      />
    );
  }
  return (
    <div key="display" {...rest} ref={(el) => assignRef(ref, el)} contentEditable={false}>
      {children}
    </div>
  );
}
