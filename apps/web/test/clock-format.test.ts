// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from 'vitest';
import {
  formatCountdown,
  formatDualClock,
  formatElapsed,
  formatIsoDual,
  formatLocalClock,
} from '../src/lib/format.js';

const AT = new Date('2026-03-04T10:45:00Z');

describe('local clock formatting', () => {
  test('shows the time and zone abbreviation for an injected zone', () => {
    expect(formatLocalClock(AT, 'America/New_York')).toBe('05:45 EST');
    expect(formatLocalClock(new Date('2026-07-04T10:45:00Z'), 'America/New_York')).toBe(
      '06:45 EDT',
    );
  });

  test('uses a 24-hour clock', () => {
    expect(formatLocalClock(new Date('2026-03-04T23:05:00Z'), 'UTC')).toBe('23:05 UTC');
  });

  test('joins UTC and local time', () => {
    expect(formatDualClock(new Date('2026-07-04T10:45:00Z'), 'America/New_York')).toBe(
      '10:45 UTC · 06:45 EDT',
    );
  });

  test('collapses to UTC only when the local zone is UTC', () => {
    expect(formatDualClock(AT, 'UTC')).toBe('10:45 UTC');
  });

  test('formats ISO strings and passes unparsable ones through', () => {
    expect(formatIsoDual('2026-03-04T10:45:00Z', 'Europe/Berlin')).toBe('10:45 UTC · 11:45 GMT+1');
    expect(formatIsoDual('soon', 'UTC')).toBe('soon');
  });
});

describe('formatElapsed', () => {
  test('uses seconds, minutes, then hours', () => {
    expect(formatElapsed(12_400)).toBe('12 s ago');
    expect(formatElapsed(-5)).toBe('0 s ago');
    expect(formatElapsed(3 * 60_000 + 1)).toBe('3 min ago');
    expect(formatElapsed(2 * 3_600_000)).toBe('2 h ago');
  });
});

describe('formatCountdown', () => {
  const NOW = AT.getTime();
  test('counts minutes and hours', () => {
    expect(formatCountdown(NOW + 23 * 60_000 + 5000, NOW)).toBe('in 23 min');
    expect(formatCountdown(NOW + (2 * 60 + 5) * 60_000, NOW)).toBe('in 2 h 5 min');
    expect(formatCountdown(NOW + 3 * 3_600_000, NOW)).toBe('in 3 h');
  });

  test('says under a minute and now', () => {
    expect(formatCountdown(NOW + 30_000, NOW)).toBe('in <1 min');
    expect(formatCountdown(NOW, NOW)).toBe('now');
    expect(formatCountdown(NOW - 1000, NOW)).toBe('now');
  });
});
