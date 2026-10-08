// SPDX-License-Identifier: Apache-2.0
import type { TimeState } from '@orrery/render';
import { afterEach, describe, expect, test } from 'vitest';
import { clockLink, pageUrl } from '../src/lib/clock-url.js';
import {
  acquireClock,
  currentClock,
  hasExplicitClock,
  publishClock,
  resetSharedClock,
  sharedClockStart,
} from '../src/lib/shared-clock.js';

const NOW = new Date('2026-03-04T05:00:00Z');
const SETTINGS = { secondsPerSimDay: 120, speeds: [1, 2, 4], startPaused: false };
const NO_LINK = { minuteOfDay: null, date: null, speed: null, paused: false };

afterEach(resetSharedClock);

describe('shared clock', () => {
  test('a link without clock parameters starts at the default time today', () => {
    expect(hasExplicitClock(NO_LINK)).toBe(false);
    expect(sharedClockStart(NO_LINK, NOW).toISOString()).toBe('2026-03-04T10:40:00.000Z');
  });

  test('an explicit link starts at its date and time with its speed and pause', () => {
    const link = { minuteOfDay: 660, date: '2026-01-02', speed: 4, paused: true };
    const clock = acquireClock(link, SETTINGS, NOW);
    expect(clock.state()).toEqual({ at: new Date('2026-01-02T11:00:00Z'), speed: 4, paused: true });
  });

  test('ignores a speed that is not configured', () => {
    expect(acquireClock({ ...NO_LINK, speed: 3 }, SETTINGS, NOW).state().speed).toBe(1);
  });

  test('reduced motion starts paused', () => {
    expect(acquireClock(NO_LINK, { ...SETTINGS, startPaused: true }, NOW).state().paused).toBe(
      true,
    );
  });

  test('pages without a pinned clock reuse the published one', () => {
    const first = acquireClock({ ...NO_LINK, minuteOfDay: 700 }, SETTINGS, NOW);
    publishClock(first);
    first.advance(500);
    expect(currentClock()).toBe(first);
    expect(acquireClock(NO_LINK, SETTINGS, NOW)).toBe(first);
    expect(sharedClockStart(NO_LINK, NOW)).toEqual(first.state().at);
  });

  test('a pinned link replaces the shared clock', () => {
    publishClock(acquireClock(NO_LINK, SETTINGS, NOW));
    const pinned = acquireClock({ ...NO_LINK, minuteOfDay: 60 }, SETTINGS, NOW);
    expect(pinned.state().at.toISOString()).toBe('2026-03-04T01:00:00.000Z');
    expect(pinned).not.toBe(currentClock());
  });
});

describe('clock url', () => {
  const running: TimeState = { at: new Date('2026-03-04T12:34:56Z'), speed: 2, paused: false };

  test('a running clock writes only what is pinned, plus speed', () => {
    expect(clockLink(running, { minuteOfDay: null, date: null })).toEqual({
      minuteOfDay: null,
      date: null,
      speed: 2,
      paused: false,
    });
    expect(clockLink(running, { minuteOfDay: 660, date: null }).minuteOfDay).toBe(660);
  });

  test('a paused clock writes its exact time and date', () => {
    expect(clockLink({ ...running, paused: true }, { minuteOfDay: null, date: null })).toEqual({
      minuteOfDay: 754,
      date: '2026-03-04',
      speed: 2,
      paused: true,
    });
  });

  test('builds page urls that keep wall, tier, and focus', () => {
    const clock = clockLink({ ...running, paused: true }, { minuteOfDay: null, date: null });
    expect(
      pageUrl('/env/stg', clock, {}, true, { tier: 'gold', focus: { kind: 'spoke', id: 'sales' } }),
    ).toBe(
      '/env/stg?date=2026-03-04&focus=spoke%3Asales&paused=1&speed=2&t=12%3A34&tier=gold&wall=1',
    );
    expect(
      pageUrl(
        '/',
        clockLink({ ...running, speed: 1 }, { minuteOfDay: null, date: null }),
        {},
        false,
      ),
    ).toBe('/');
  });

  test('compare urls carry the environment list', () => {
    const clock = clockLink({ ...running, speed: 1 }, { minuteOfDay: null, date: null });
    expect(pageUrl('/compare', clock, { envs: 'stg,prod' }, false)).toBe(
      '/compare?envs=stg%2Cprod',
    );
  });
});
