// SPDX-License-Identifier: Apache-2.0
import type { Alert } from '@orrery/core';
import { describe, expect, test } from 'vitest';
import {
  currentStop,
  isWallPaused,
  needsAttention,
  sameStop,
  startWall,
  syncWall,
  tickWall,
  WALL_DWELL_SECONDS,
  WALL_INPUT_PAUSE_SECONDS,
  WALL_MAX_HOLD_STOPS,
  wallInput,
  wallStops,
  wallUrl,
} from '../src/lib/wall.js';

const DWELL_MS = WALL_DWELL_SECONDS * 1000;
const stops = wallStops(['dev', 'stg', 'prod']);
const never = (): boolean => false;

function alert(severity: Alert['severity']): Alert {
  return {
    id: 'a',
    severity,
    kind: 'k',
    title: 't',
    text: '',
    openedAt: '2026-01-01T00:00:00Z',
    targets: [],
  };
}

describe('wallStops', () => {
  test('starts at home and follows promotion order', () => {
    expect(stops).toEqual([
      { kind: 'home' },
      { kind: 'env', id: 'dev' },
      { kind: 'env', id: 'stg' },
      { kind: 'env', id: 'prod' },
    ]);
  });

  test('builds urls that keep wall=1', () => {
    expect(wallUrl({ kind: 'home' })).toBe('/?wall=1');
    expect(wallUrl({ kind: 'env', id: 'stg' })).toBe('/env/stg?wall=1');
  });
});

describe('tickWall', () => {
  test('stays on a stop until the dwell has passed', () => {
    const state = startWall(0);
    expect(tickWall(state, DWELL_MS - 1, stops, never)).toBe(state);
  });

  test('moves to the next stop after the dwell', () => {
    const next = tickWall(startWall(0), DWELL_MS, stops, never);
    expect(currentStop(next, stops)).toEqual({ kind: 'env', id: 'dev' });
    expect(next.dwellStartMs).toBe(DWELL_MS);
  });

  test('cycles through every environment and returns home', () => {
    let state = startWall(0);
    const seen: string[] = [];
    for (let step = 1; step <= stops.length; step += 1) {
      state = tickWall(state, step * DWELL_MS, stops, never);
      const stop = currentStop(state, stops);
      seen.push(stop?.kind === 'env' ? stop.id : 'home');
    }
    expect(seen).toEqual(['dev', 'stg', 'prod', 'home']);
  });

  test('holds on an environment with an open warning or incident', () => {
    const atStg = startWall(0, 2);
    const held = tickWall(atStg, DWELL_MS, stops, (id) => id === 'stg');
    expect(held.index).toBe(2);
    expect(held.dwells).toBe(2);
    expect(held.dwellStartMs).toBe(DWELL_MS);
  });

  test('moves on after WALL_MAX_HOLD_STOPS dwells', () => {
    let state = startWall(0, 2);
    let now = 0;
    for (let dwell = 1; dwell < WALL_MAX_HOLD_STOPS; dwell += 1) {
      now += DWELL_MS;
      state = tickWall(state, now, stops, () => true);
      expect(state.index).toBe(2);
    }
    now += DWELL_MS;
    state = tickWall(state, now, stops, () => true);
    expect(state.index).toBe(3);
    expect(state.dwells).toBe(1);
  });

  test('never holds on home', () => {
    const next = tickWall(startWall(0), DWELL_MS, stops, () => true);
    expect(next.index).toBe(1);
  });

  test('does nothing without stops', () => {
    const state = startWall(0);
    expect(tickWall(state, DWELL_MS * 5, [], never)).toBe(state);
  });
});

describe('input pause', () => {
  test('input pauses the cycle for 60 seconds', () => {
    const paused = wallInput(startWall(0), 5000);
    expect(isWallPaused(paused, 5000 + 1000)).toBe(true);
    expect(tickWall(paused, DWELL_MS * 2, stops, never).index).toBe(0);
    expect(paused.pausedUntilMs).toBe(5000 + WALL_INPUT_PAUSE_SECONDS * 1000);
  });

  test('a fresh dwell starts when the pause ends', () => {
    const paused = wallInput(startWall(0), 0);
    const end = WALL_INPUT_PAUSE_SECONDS * 1000;
    const resumed = tickWall(paused, end, stops, never);
    expect(resumed.pausedUntilMs).toBe(0);
    expect(resumed.index).toBe(0);
    expect(tickWall(resumed, end + DWELL_MS - 1, stops, never).index).toBe(0);
    expect(tickWall(resumed, end + DWELL_MS, stops, never).index).toBe(1);
  });

  test('more input extends the pause', () => {
    const first = wallInput(startWall(0), 0);
    const second = wallInput(first, 50_000);
    expect(isWallPaused(second, 100_000)).toBe(true);
    expect(isWallPaused(first, 100_000)).toBe(false);
  });
});

describe('syncWall', () => {
  test('follows the user to another stop and restarts the dwell', () => {
    const synced = syncWall(startWall(0), stops, { kind: 'env', id: 'prod' }, 7000);
    expect(synced.index).toBe(3);
    expect(synced.dwellStartMs).toBe(7000);
  });

  test('keeps the state when the page matches or is outside the cycle', () => {
    const state = startWall(0, 1);
    expect(syncWall(state, stops, { kind: 'env', id: 'dev' }, 9)).toBe(state);
    expect(syncWall(state, stops, { kind: 'env', id: 'other' }, 9)).toBe(state);
    expect(syncWall(state, stops, null, 9)).toBe(state);
  });

  test('keeps an active input pause', () => {
    const paused = wallInput(startWall(0), 0);
    expect(syncWall(paused, stops, { kind: 'home' }, 1).pausedUntilMs).toBe(0 + 60_000);
    expect(syncWall(paused, stops, { kind: 'env', id: 'stg' }, 1).pausedUntilMs).toBe(60_000);
  });
});

describe('needsAttention and sameStop', () => {
  test('warnings and incidents hold, info does not', () => {
    expect(needsAttention([alert('info')])).toBe(false);
    expect(needsAttention([alert('info'), alert('warning')])).toBe(true);
    expect(needsAttention([alert('incident')])).toBe(true);
    expect(needsAttention([])).toBe(false);
  });

  test('compares stops by kind and id', () => {
    expect(sameStop({ kind: 'home' }, { kind: 'home' })).toBe(true);
    expect(sameStop({ kind: 'env', id: 'a' }, { kind: 'env', id: 'a' })).toBe(true);
    expect(sameStop({ kind: 'env', id: 'a' }, { kind: 'env', id: 'b' })).toBe(false);
    expect(sameStop({ kind: 'home' }, { kind: 'env', id: 'a' })).toBe(false);
  });
});
