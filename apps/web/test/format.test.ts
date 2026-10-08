// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from 'vitest';
import {
  formatAge,
  formatClock,
  formatCount,
  formatDate,
  formatIsoClock,
  formatPercent,
} from '../src/lib/format.js';

describe('formatting helpers', () => {
  test('formats clock and date in UTC', () => {
    const at = new Date('2026-03-04T07:05:09Z');
    expect(formatClock(at)).toBe('07:05');
    expect(formatDate(at)).toBe('2026-03-04');
    expect(formatIsoClock('2026-03-04T07:05:09Z')).toBe('07:05');
    expect(formatIsoClock('nope')).toBe('nope');
  });

  test('formats data age', () => {
    expect(formatAge(45)).toBe('45 min');
    expect(formatAge(125)).toBe('2 h 05 min');
    expect(formatAge(180)).toBe('3 h');
    expect(formatAge(-1)).toBe('unknown');
    expect(formatAge(Number.NaN)).toBe('unknown');
  });

  test('formats percent and counts defensively', () => {
    expect(formatPercent(0.734)).toBe('73%');
    expect(formatPercent(3)).toBe('100%');
    expect(formatPercent(-1)).toBe('0%');
    expect(formatPercent(Number.NaN)).toBe('0%');
    expect(formatCount(12345)).toBe('12,345');
    expect(formatCount(Number.NaN)).toBe('0');
  });
});
