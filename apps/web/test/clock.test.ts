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
const NO_LINK = { minuteOfDay: null, date: null, speed: null, paused: false, replay: false };

afterEach(resetSharedClock);

describe('shared clock', () => {
  test('a link without clock parameters follows the wall clock', () => {
    expect(hasExplicitClock(NO_LINK)).toBe(false);
    expect(sharedClockStart(NO_LINK, NOW)).toEqual(NOW);
    const clock = acquireClock(NO_LINK, SETTINGS, NOW);
    expect(clock.mode()).toBe('live');
    expect(clock.state().live).toBe(true);
  });

  test.each([
    ['t', { minuteOfDay: 60 }],
    ['date', { date: '2026-01-02' }],
    ['speed', { speed: 2 }],
    ['paused', { paused: true }],
    ['mode=replay', { replay: true }],
  ])('%s makes the clock replay', (_name, patch) => {
    const link = { ...NO_LINK, ...patch };
    expect(hasExplicitClock(link)).toBe(true);
    expect(acquireClock(link, SETTINGS, NOW).mode()).toBe('replay');
  });

  test('mode=replay alone starts at the current instant', () => {
    const clock = acquireClock({ ...NO_LINK, replay: true }, SETTINGS, NOW);
    expect(clock.state().at).toEqual(NOW);
    expect(clock.state().live).toBe(false);
  });

  test('a date without a time starts at the default minute of that date', () => {
    const clock = acquireClock({ ...NO_LINK, date: '2026-01-02' }, SETTINGS, NOW);
    expect(clock.state().at.toISOString()).toBe('2026-01-02T10:40:00.000Z');
  });

  test('an explicit link starts at its date and time with its speed and pause', () => {
    const link = { minuteOfDay: 660, date: '2026-01-02', speed: 4, paused: true, replay: false };
    const clock = acquireClock(link, SETTINGS, NOW);
    expect(clock.state()).toEqual({
      at: new Date('2026-01-02T11:00:00Z'),
      speed: 4,
      paused: true,
      live: false,
    });
  });

  test('ignores a speed that is not configured', () => {
    expect(acquireClock({ ...NO_LINK, speed: 3 }, SETTINGS, NOW).state().speed).toBe(1);
  });

  test('reduced motion starts paused, in replay', () => {
    const state = acquireClock(NO_LINK, { ...SETTINGS, startPaused: true }, NOW).state();
    expect(state.paused).toBe(true);
    expect(state.live).toBe(false);
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
  const running: TimeState = {
    at: new Date('2026-03-04T12:34:56Z'),
    speed: 2,
    paused: false,
    live: false,
  };

  test('a running clock writes only what is pinned, plus speed', () => {
    expect(clockLink(running, { minuteOfDay: null, date: null })).toEqual({
      minuteOfDay: null,
      date: null,
      speed: 2,
      paused: false,
      replay: true,
    });
    expect(clockLink(running, { minuteOfDay: 660, date: null }).minuteOfDay).toBe(660);
  });

  test('a paused clock writes its exact time and date', () => {
    expect(clockLink({ ...running, paused: true }, { minuteOfDay: null, date: null })).toEqual({
      minuteOfDay: 754,
      date: '2026-03-04',
      speed: 2,
      paused: true,
      replay: true,
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
        clockLink({ ...running, speed: 1, live: true }, { minuteOfDay: null, date: null }),
        {},
        false,
      ),
    ).toBe('/');
  });

  test('a live clock writes no clock parameters', () => {
    const live: TimeState = { ...running, speed: 1, live: true };
    const clock = clockLink(live, { minuteOfDay: 660, date: '2026-01-02' });
    expect(pageUrl('/', clock, {}, false)).toBe('/');
    expect(pageUrl('/env/stg', clock, {}, false, { tier: 'gold' })).toBe('/env/stg?tier=gold');
  });

  test('a replay with only a scrubbed time writes t', () => {
    const clock = clockLink({ ...running, speed: 1 }, { minuteOfDay: 660, date: null });
    expect(pageUrl('/', clock, {}, false)).toBe('/?t=11%3A00');
  });

  test('a replay with nothing pinned writes the mode=replay marker', () => {
    const clock = clockLink({ ...running, speed: 1 }, { minuteOfDay: null, date: null });
    expect(pageUrl('/', clock, {}, false)).toBe('/?mode=replay');
  });

  test('compare urls carry the environment list', () => {
    const clock = clockLink(
      { ...running, speed: 1, live: true },
      { minuteOfDay: null, date: null },
    );
    expect(pageUrl('/compare', clock, { envs: 'stg,prod' }, false)).toBe(
      '/compare?envs=stg%2Cprod',
    );
  });
});
