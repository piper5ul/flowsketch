import { describe, expect, it } from 'vitest';
import { sanitizeConnectorData } from './colorSafety';

describe('sanitizeConnectorData', () => {
  it('keeps a boolean label background and drops anything else', () => {
    expect(sanitizeConnectorData({ label: 'a', labelBackground: true }).labelBackground).toBe(true);
    expect(sanitizeConnectorData({ label: 'a', labelBackground: false }).labelBackground).toBe(false);
    for (const bad of ['true', 1, null, {}]) {
      expect(sanitizeConnectorData({ label: 'a', labelBackground: bad })).not.toHaveProperty('labelBackground');
    }
  });

  it('leaves an absent label background absent', () => {
    expect(sanitizeConnectorData({ label: 'a' })).toEqual({ label: 'a' });
  });
});
