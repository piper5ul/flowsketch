import * as Y from 'yjs';

/** True when this document has local clocks beyond the server's snapshot. */
export function hasUncoveredLocalUpdates(localStateVector: Uint8Array, serverStateVectorBase64: string): boolean {
  const binary = atob(serverStateVectorBase64);
  const serverStateVector = Y.decodeStateVector(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
  const local = Y.decodeStateVector(localStateVector);

  return [...local].some(([clientId, clock]) => clock > (serverStateVector.get(clientId) ?? 0));
}
