import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { hasUncoveredLocalUpdates } from './stateVector';

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe('hasUncoveredLocalUpdates', () => {
  it('detects a local client clock that advanced after the server snapshot', () => {
    const local = new Y.Doc();
    local.getText('board').insert(0, 'a');
    const serverSnapshot = base64(Y.encodeStateVector(local));
    local.getText('board').insert(1, 'b');

    expect(hasUncoveredLocalUpdates(Y.encodeStateVector(local), serverSnapshot)).toBe(true);
  });

  it('accepts a local state covered by the server snapshot', () => {
    const local = new Y.Doc();
    local.getText('board').insert(0, 'covered');

    expect(
      hasUncoveredLocalUpdates(Y.encodeStateVector(local), base64(Y.encodeStateVector(local))),
    ).toBe(false);
  });

  it('accepts server updates from a peer client id missing locally', () => {
    const seed = new Y.Doc();
    seed.getText('board').insert(0, 'shared');
    const seedUpdate = Y.encodeStateAsUpdate(seed);
    const local = new Y.Doc();
    const server = new Y.Doc();
    Y.applyUpdate(local, seedUpdate);
    Y.applyUpdate(server, seedUpdate);

    const peer = new Y.Doc();
    peer.getText('board').insert(0, 'peer');
    Y.applyUpdate(server, Y.encodeStateAsUpdate(peer));

    expect(
      hasUncoveredLocalUpdates(Y.encodeStateVector(local), base64(Y.encodeStateVector(server))),
    ).toBe(false);
  });
});
