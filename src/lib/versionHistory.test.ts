import { describe, expect, it } from 'vitest';
import { describeVersion, formatVersionTime } from './versionHistory';
import type { DiagramVersionMeta } from '../../shared/types';

/**
 * A local timestamp, spelled as an instant. The formatter reads the reader's
 * own timezone — that is the day they think in — so the fixtures are built
 * from local components rather than from a UTC string that would land on a
 * different day depending on where the test runs.
 */
function at(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

const NOW = new Date(2026, 8, 6, 15, 30); // 6 Sep 2026, 15:30 local

function version(overrides: Partial<DiagramVersionMeta> = {}): DiagramVersionMeta {
  return {
    id: 'v1',
    createdAt: at(2026, 9, 6, 14, 3),
    title: 'Flow chart',
    label: null,
    ...overrides,
  };
}

describe('formatVersionTime', () => {
  it('names today by the clock alone', () => {
    expect(formatVersionTime(at(2026, 9, 6, 14, 3), NOW)).toBe('Today 14:03');
  });

  it('names yesterday, even across a month boundary', () => {
    expect(formatVersionTime(at(2026, 9, 5, 9, 12), NOW)).toBe('Yesterday 09:12');
    const firstOfMonth = new Date(2026, 9, 1, 8, 0); // 1 Oct
    expect(formatVersionTime(at(2026, 9, 30, 23, 59), firstOfMonth)).toBe('Yesterday 23:59');
  });

  it('falls back to the date within this year', () => {
    expect(formatVersionTime(at(2026, 9, 4, 8, 5), NOW)).toBe('4 Sep 08:05');
    expect(formatVersionTime(at(2026, 1, 31, 23, 0), NOW)).toBe('31 Jan 23:00');
  });

  it('adds the year once it is not this one', () => {
    expect(formatVersionTime(at(2025, 12, 24, 17, 45), NOW)).toBe('24 Dec 2025 17:45');
  });

  it('is empty for a timestamp it cannot read', () => {
    // One malformed row must not be the loudest entry in the list.
    expect(formatVersionTime('not a date', NOW)).toBe('');
  });
});

describe('describeVersion', () => {
  it('reads as when, who and what', () => {
    expect(
      describeVersion(version({ createdBy: { name: 'Pushkar' }, label: 'Before restore' }), NOW),
    ).toBe('Today 14:03 · Pushkar · Before restore');
  });

  it('leaves out the label an automatic snapshot never had', () => {
    expect(describeVersion(version({ createdBy: { name: 'Pushkar' } }), NOW)).toBe(
      'Today 14:03 · Pushkar',
    );
  });

  it('leaves out an author whose account has gone', () => {
    expect(describeVersion(version({ label: 'Checkpoint' }), NOW)).toBe('Today 14:03 · Checkpoint');
  });

  it('carries no dangling separator when only the time is known', () => {
    expect(describeVersion(version(), NOW)).toBe('Today 14:03');
  });
});
