// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { FileEventSource } from '../src/file-events.js';
import { MAX_REPLICAS, planReplay, replicaOf, replicaRange } from '../src/replay.js';
import { MS_PER_DAY, MS_PER_HOUR } from '../src/time.js';
import { MIN, T0, dataset, ev } from './helpers.js';

const DAY = { anchorMs: undefined, periodMs: MS_PER_DAY } as const;
const HOUR = { anchorMs: undefined, periodMs: MS_PER_HOUR } as const;
const win = (fromMs: number, toMs: number) => ({ since: new Date(fromMs), until: new Date(toMs) });

const EVENTS = [
  ev({ type: 'START', atMin: 0, run: 'a', job: 'j', outputs: [dataset('raw.a')] }),
  ev({ type: 'COMPLETE', atMin: 10, run: 'a', job: 'j' }),
  ev({ type: 'START', atMin: 5, run: 'b', job: 'k', outputs: [dataset('raw.b')] }),
  ev({ type: 'COMPLETE', atMin: 8, run: 'b', job: 'k' }),
];

describe('planReplay', () => {
  it('shifts nothing without an anchor', () => {
    expect(planReplay(DAY, T0)).toEqual({ baseShiftMs: 0, periodMs: MS_PER_DAY });
  });

  it('shifts the earliest event onto the anchor', () => {
    const anchor = T0 + 5 * MS_PER_HOUR;
    expect(planReplay({ anchorMs: anchor, periodMs: MS_PER_DAY }, T0).baseShiftMs).toBe(
      5 * MS_PER_HOUR,
    );
  });
});

describe('replicaRange', () => {
  const plan = planReplay(DAY, T0);
  const span = { minMs: T0, maxMs: T0 + 10 * MIN };

  it('finds the copy on the sample day itself', () => {
    expect(replicaRange(span, win(T0, T0 + MS_PER_HOUR), plan)).toEqual({ first: 0, last: 0 });
  });

  it('maps a later day onto a whole number of periods', () => {
    const later = T0 + 40 * MS_PER_DAY;
    expect(replicaRange(span, win(later, later + MS_PER_HOUR), plan)).toEqual({
      first: 40,
      last: 40,
    });
  });

  it('includes a copy still running when the window opens', () => {
    expect(replicaRange(span, win(T0 + 5 * MIN, T0 + 6 * MIN), plan)).toEqual({
      first: 0,
      last: 0,
    });
  });

  it('finds none in a window between copies, and copies before the sample', () => {
    const range = replicaRange(span, win(T0 + MS_PER_HOUR, T0 + 2 * MS_PER_HOUR), plan);
    expect(range.first).toBeGreaterThan(range.last);
    expect(
      replicaRange(span, win(T0 - 3 * MS_PER_DAY, T0 - 3 * MS_PER_DAY + MS_PER_HOUR), plan),
    ).toEqual({
      first: -3,
      last: -3,
    });
  });

  it('treats the window as half-open', () => {
    const range = replicaRange(span, win(T0 - MS_PER_HOUR, T0), plan);
    expect(range.first).toBeGreaterThan(range.last);
  });

  it('bounds the work for an absurd window', () => {
    const { first, last } = replicaRange(span, win(T0, T0 + 10_000 * MS_PER_DAY), plan);
    expect(last - first + 1).toBe(MAX_REPLICAS);
  });
});

describe('replicaOf', () => {
  it('shifts times and gives each copy its own run id', () => {
    const plan = planReplay(DAY, T0);
    const copy = replicaOf(EVENTS.slice(0, 2), 3, plan);
    expect(copy.map((e) => [e.runId, e.timeMs - T0])).toEqual([
      ['a@3', 3 * MS_PER_DAY],
      ['a@3', 3 * MS_PER_DAY + 10 * MIN],
    ]);
    expect(EVENTS[0]?.runId).toBe('a');
  });
});

describe('FileEventSource', () => {
  it('returns whole runs as recorded when replay is off', async () => {
    const source = new FileEventSource(EVENTS, undefined);
    const loaded = await source.load(win(T0 + 9 * MIN, T0 + 20 * MIN));
    expect(loaded.events.map((e) => e.runId).sort()).toEqual(['a', 'a']);
    expect((await source.load(win(T0 + 11 * MIN, T0 + 20 * MIN))).events).toEqual([]);
  });

  it('repeats the sample every period on any day, keeping each run together', async () => {
    const source = new FileEventSource(EVENTS, DAY);
    const day = T0 + 100 * MS_PER_DAY;
    const loaded = await source.load(win(day + 9 * MIN, day + 30 * MIN));
    expect(loaded.truncated).toBe(false);
    expect(loaded.events.filter((e) => e.runId === 'a@100')).toHaveLength(2);
    expect(loaded.events.every((e) => e.timeMs >= day)).toBe(true);
  });

  it('repeats hourly when asked', async () => {
    const source = new FileEventSource(EVENTS, HOUR);
    const loaded = await source.load(win(T0, T0 + 3 * MS_PER_HOUR));
    expect(new Set(loaded.events.map((e) => e.runId)).size).toBe(6);
  });

  it('moves the sample to the anchor', async () => {
    const anchor = T0 + 9 * MS_PER_HOUR;
    const source = new FileEventSource(EVENTS, { anchorMs: anchor, periodMs: MS_PER_DAY });
    const loaded = await source.load(win(anchor, anchor + MS_PER_HOUR));
    expect(loaded.events.map((e) => e.timeMs - anchor).sort((a, b) => a - b)).toEqual([
      0,
      5 * MIN,
      8 * MIN,
      10 * MIN,
    ]);
  });

  it('check() succeeds and does no work', async () => {
    await expect(new FileEventSource(EVENTS, undefined).check()).resolves.toBeUndefined();
  });
});
