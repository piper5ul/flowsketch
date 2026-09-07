import { describe, expect, it } from 'vitest';
import { COLLAB_FORBIDDEN, COLLAB_UNAUTHORIZED } from '../../../shared/collabAuth';
import { collabAuthFailure } from './authFailure';

describe('collabAuthFailure', () => {
  it('reads an expired session as something to sign back in from', () => {
    expect(collabAuthFailure(COLLAB_UNAUTHORIZED)).toBe('no-session');
  });

  it('reads a refused diagram as one to leave', () => {
    expect(collabAuthFailure(COLLAB_FORBIDDEN)).toBe('no-access');
  });

  it('says nothing about a reason it does not recognise', () => {
    // Hocuspocus's own fallback, an older deployment, and a provider that
    // could not even ask. None of them is grounds for signing the user out of
    // the page or for throwing away the copy cached in this browser.
    expect(collabAuthFailure('permission-denied')).toBe('unknown');
    expect(collabAuthFailure('')).toBe('unknown');
    expect(collabAuthFailure('Failed to get token during sendToken(): x')).toBe('unknown');
  });
});
