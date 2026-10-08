// SPDX-License-Identifier: Apache-2.0
// The schedule is a rolling window [at, at + 24 h) plus windows already in progress at `at`.
import { describe, expect, it } from 'vitest';
import { at, demoEnv, started } from './helpers.js';

const DAY_MS = 24 * 3_600_000;
const NEXT_DAY = '2026-10-08';

async function scheduleAt(when: Date, id: 'dev' | 'stg' | 'prod' = 'prod') {
  return (await (await started(demoEnv(id))).snapshot(when)).schedule;
}

describe('mock rolling schedule', () => {
  it('includes the early windows of tomorrow when asked late in the day', async () => {
    const schedule = await scheduleAt(at('23:30'));
    expect(schedule.some((w) => w.start === `${NEXT_DAY}T01:00:00.000Z`)).toBe(true);
  });

  it('includes a window that is already in progress', async () => {
    const when = at('02:00');
    const ongoing = (await scheduleAt(when)).filter(
      (w) => Date.parse(w.start) < when.getTime() && when.getTime() < Date.parse(w.end),
    );
    expect(ongoing.length).toBeGreaterThan(0);
  });

  it.each(['dev', 'stg', 'prod'] as const)(
    '%s: nothing starts at or beyond at + 24 h, and nothing ended before at',
    async (id) => {
      for (const hhmm of ['00:00', '10:45', '23:30']) {
        const when = at(hhmm);
        for (const w of await scheduleAt(when, id)) {
          expect(Date.parse(w.start)).toBeLessThan(when.getTime() + DAY_MS);
          expect(Date.parse(w.end)).toBeGreaterThan(when.getTime());
        }
      }
    },
  );

  it.each(['dev', 'stg', 'prod'] as const)('%s: ids are unique and sorted by start', async (id) => {
    for (const hhmm of ['00:00', '10:45', '23:30']) {
      const schedule = await scheduleAt(at(hhmm), id);
      expect(new Set(schedule.map((w) => w.id)).size).toBe(schedule.length);
      const starts = schedule.map((w) => w.start);
      expect(starts).toEqual([...starts].sort());
    }
  });

  it('at the 00:00 boundary starts the window at midnight and excludes the next midnight', async () => {
    const when = at('00:00');
    const schedule = await scheduleAt(when);
    const starts = schedule.map((w) => Date.parse(w.start));
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(when.getTime() - 1);
    expect(starts.some((s) => s === when.getTime() + DAY_MS)).toBe(false);
    expect(schedule.length).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed and time', async () => {
    expect(await scheduleAt(at('23:30'))).toEqual(await scheduleAt(at('23:30')));
  });
});

describe('mock availability', () => {
  it.each(['dev', 'stg', 'prod'] as const)(
    '%s: supplies every snapshot part, so `unavailable` is absent',
    async (id) => {
      const snapshot = await (await started(demoEnv(id))).snapshot(at('10:15'));
      expect(snapshot).not.toHaveProperty('unavailable');
    },
  );
});
