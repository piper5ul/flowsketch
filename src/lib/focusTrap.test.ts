import { describe, expect, it } from 'vitest';
import { wrapFocusTarget } from './focusTrap';

describe('wrapFocusTarget', () => {
  const items = ['close', 'link', 'invite'];

  it('wraps Tab from the last control to the first', () => {
    expect(wrapFocusTarget(items, 'invite', false)).toBe('close');
  });

  it('wraps ⇧Tab from the first control to the last', () => {
    expect(wrapFocusTarget(items, 'close', true)).toBe('invite');
  });

  it('leaves a move between two inner controls to the browser', () => {
    expect(wrapFocusTarget(items, 'link', false)).toBeNull();
    expect(wrapFocusTarget(items, 'link', true)).toBeNull();
  });

  it('pulls focus that has left the dialog back in at the near end', () => {
    expect(wrapFocusTarget(items, 'page-behind', false)).toBe('close');
    expect(wrapFocusTarget(items, 'page-behind', true)).toBe('invite');
  });

  it('has nowhere to go in a dialog with no controls', () => {
    expect(wrapFocusTarget([], 'anything', false)).toBeNull();
  });
});
