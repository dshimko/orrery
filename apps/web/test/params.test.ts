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
      view: null,
      date: null,
      paused: false,
      replay: false,
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
      view: null,
      date: null,
      paused: false,
      replay: false,
    });
  });

  test('parses view and drops unknown camera views', () => {
    expect(parseDeepLink({ view: 'belt' }).view).toBe('belt');
    expect(parseDeepLink({ view: 'moon' }).view).toBeNull();
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

describe('deep link round trip', () => {
  test('parse then serialize returns the same query', () => {
    const query = {
      date: '2026-10-07',
      focus: 'spoke:sales',
      paused: '1',
      speed: '2',
      t: '11:00',
      tier: 'gold',
      view: 'planets',
      workload: 'ml',
    };
    expect(toQuery(parseDeepLink(query))).toEqual(query);
  });

  test('serialize then parse returns the same link', () => {
    const link = parseDeepLink({ t: '09:05', focus: 'useCase:finance', view: 'yard', speed: '4' });
    expect(parseDeepLink(toQuery(link))).toEqual(link);
  });

  test('focus kinds without ids round-trip', () => {
    expect(toQuery(parseDeepLink({ focus: 'hub' }))).toEqual({ focus: 'hub' });
    expect(toQuery(parseDeepLink({ focus: 'shipyard' }))).toEqual({ focus: 'shipyard' });
  });

  test('a restored link starts at the requested time and focus', () => {
    const link = parseDeepLink({ t: '11:00', focus: 'spoke:sales' });
    const start = startOfDayAt(new Date('2026-03-04T05:00:00Z'), link.minuteOfDay ?? 0);
    expect(start.toISOString()).toBe('2026-03-04T11:00:00.000Z');
    expect(link.focus).toEqual({ kind: 'spoke', id: 'sales' });
  });

  test('mode=replay parses and round-trips only when no time param pins replay', () => {
    const marker = parseDeepLink({ mode: 'replay' });
    expect(marker.replay).toBe(true);
    expect(toQuery(marker)).toEqual({ mode: 'replay' });
    expect(parseDeepLink({}).replay).toBe(false);
    expect(parseDeepLink({ mode: 'other' }).replay).toBe(false);
    expect(toQuery(parseDeepLink({ mode: 'replay', t: '09:05' }))).toEqual({ t: '09:05' });
    expect(toQuery(parseDeepLink({ mode: 'replay', paused: '1' }))).toEqual({ paused: '1' });
  });
});
