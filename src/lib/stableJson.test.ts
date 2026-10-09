import { describe, expect, it, vi } from 'vitest';
import { stableJson } from './stableJson';

describe('stableJson', () => {
  it('serializes Dates like JSON.stringify', () => {
    const date = new Date('2026-10-08T12:34:56.000Z');

    expect(stableJson(date)).toBe(JSON.stringify(date));
  });

  it('honors nested toJSON methods and passes their property key', () => {
    const toJSON = vi.fn((key: string) => ({ z: 1, key, a: 2 }));
    const value = { nested: { toJSON } };
    const json = JSON.stringify(value);

    expect(toJSON).toHaveBeenCalledWith('nested');
    expect(stableJson(value)).toBe(stableJson(JSON.parse(json!)));
    expect(stableJson(value)).toBe('{"nested":{"a":2,"key":"nested","z":1}}');
  });
});

describe('stableJson and toJSON', () => {
  it('applies a toJSON once, as JSON.stringify does, even when it returns another toJSON', () => {
    const value = { toJSON: () => ({ x: 1, toJSON: () => 'second' }) };
    expect(stableJson(value)).toBe(JSON.stringify(value));
    expect(stableJson(value)).toBe('{"x":1}');
  });

  it('drops function values the way JSON.stringify does', () => {
    expect(stableJson({ b: 2, a: () => 1 })).toBe('{"b":2}');
  });
});
