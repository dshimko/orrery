// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from 'vitest';
import {
  formatTimeOfDay,
  parseDeepLink,
  parseFocus,
  parseTimeOfDay,
  serializeFocus,
  startOfDayAt,
  toQuery,
} from '../src/lib/params.js';

describe('parseDeepLink', () => {
  test('returns defaults for an empty query', () => {
    expect(parseDeepLink({})).toEqual({
      minuteOfDay: null,
      speed: null,
      tier: 'all',
      workload: 'all',
      focus: null,
      date: null,
      paused: false,
    });
  });

  test('parses every supported parameter', () => {
    const link = parseDeepLink({
      t: '14:05',
      speed: '2',
      tier: 'gold',
      workload: 'ml',
      focus: 'spoke:sales',
    });
    expect(link).toEqual({
      minuteOfDay: 845,
      speed: 2,
      tier: 'gold',
      workload: 'ml',
      focus: { kind: 'spoke', id: 'sales' },
      date: null,
      paused: false,
    });
  });

  test('ignores invalid values', () => {
    const link = parseDeepLink({ t: '25:00', speed: '-1', tier: 'platinum', workload: 'a b' });
    expect(link.minuteOfDay).toBeNull();
    expect(link.speed).toBeNull();
    expect(link.tier).toBe('all');
    expect(link.workload).toBe('all');
  });
});

describe('time of day', () => {
  test('parses and formats HH:MM', () => {
    expect(parseTimeOfDay('00:00')).toBe(0);
    expect(parseTimeOfDay('23:59')).toBe(1439);
    expect(parseTimeOfDay('7:00')).toBeNull();
    expect(parseTimeOfDay(undefined)).toBeNull();
    expect(formatTimeOfDay(640)).toBe('10:40');
    expect(formatTimeOfDay(5000)).toBe('23:59');
  });

  test('places the minute on the given UTC day', () => {
    const at = startOfDayAt(new Date('2026-03-04T22:10:00Z'), 640);
    expect(at.toISOString()).toBe('2026-03-04T10:40:00.000Z');
  });
});

describe('focus', () => {
  test('round-trips ids and singletons', () => {
    expect(parseFocus('hub')).toEqual({ kind: 'hub' });
    expect(parseFocus('shipyard')).toEqual({ kind: 'shipyard' });
    expect(serializeFocus({ kind: 'useCase', id: 'bi' })).toBe('useCase:bi');
    expect(serializeFocus(parseFocus('foreign:erp'))).toBe('foreign:erp');
    expect(serializeFocus(null)).toBe('');
  });

  test('rejects unknown kinds and bad ids', () => {
    expect(parseFocus('planet:x')).toBeNull();
    expect(parseFocus('spoke:')).toBeNull();
    expect(parseFocus('spoke')).toBeNull();
    expect(parseFocus('spoke:a/b')).toBeNull();
  });
});

describe('toQuery', () => {
  test('omits defaults', () => {
    expect(toQuery({ speed: 1, tier: 'all', workload: 'all', focus: null })).toEqual({});
  });

  test('includes non-default values', () => {
    expect(
      toQuery({ minuteOfDay: 640, speed: 4, tier: 'use', workload: 'ml', focus: { kind: 'hub' } }),
    ).toEqual({ t: '10:40', speed: '4', tier: 'use', workload: 'ml', focus: 'hub' });
  });

  test('parses date and paused for reproducible links', () => {
    expect(parseDeepLink({ date: '2026-10-07', paused: '1' })).toMatchObject({
      date: '2026-10-07',
      paused: true,
    });
    expect(parseDeepLink({ date: '2026-02-30' }).date).toBeNull();
    expect(parseDeepLink({ date: 'yesterday', paused: 'yes' })).toMatchObject({
      date: null,
      paused: false,
    });
  });
});
