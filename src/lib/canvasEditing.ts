/** Editors register how to discard a draft before a history restore closes them. */
const cancellations = new Set<() => void>();

export function registerCanvasEditor(cancel: () => void): () => void {
  cancellations.add(cancel);
  return () => { cancellations.delete(cancel); };
}

export function cancelCanvasEditors(): void {
  for (const cancel of cancellations) cancel();
}
