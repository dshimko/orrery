// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { FixedClock, ScaledClock } from '../src/index.js';

describe('FixedClock', () => {
  it('returns a fresh copy of the current time', () => {
    const clock = new FixedClock('2026-01-01T00:00:00Z');
    const first = clock.now();
    first.setUTCFullYear(1999);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('moves with set and advance', () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    clock.advance(1500);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:01.500Z');
    clock.set('2027-02-03T04:05:06Z');
    expect(clock.now().toISOString()).toBe('2027-02-03T04:05:06.000Z');
  });

  it('advances on sleep without real waiting', async () => {
    const clock = new FixedClock('2026-01-01T00:00:00Z');
    await clock.sleep(3_600_000);
    expect(clock.now().toISOString()).toBe('2026-01-01T01:00:00.000Z');
  });

  it('rejects sleep with an AbortError when the signal is already aborted', async () => {
    const clock = new FixedClock('2026-01-01T00:00:00Z');
    await expect(clock.sleep(10, AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('rejects sleep when the signal aborts before the microtask runs', async () => {
    const clock = new FixedClock('2026-01-01T00:00:00Z');
    const controller = new AbortController();
    const pending = clock.sleep(10, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects an invalid date', () => {
    expect(() => new FixedClock('nope')).toThrow(RangeError);
  });
});

describe('ScaledClock', () => {
  it('scales elapsed real time by speed', () => {
    let real = 1000;
    const clock = new ScaledClock('2026-01-01T00:00:00Z', 60, () => real);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    real += 1000;
    expect(clock.now().toISOString()).toBe('2026-01-01T00:01:00.000Z');
  });

  it('rejects a non-positive speed', () => {
    expect(() => new ScaledClock('2026-01-01T00:00:00Z', 0)).toThrow(RangeError);
    expect(() => new ScaledClock('2026-01-01T00:00:00Z', -2)).toThrow(RangeError);
  });

  it('sleeps for ms divided by speed in real time', async () => {
    const clock = new ScaledClock('2026-01-01T00:00:00Z', 1000);
    const started = performance.now();
    await clock.sleep(20_000);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('aborts a pending sleep', async () => {
    const clock = new ScaledClock('2026-01-01T00:00:00Z', 1);
    const controller = new AbortController();
    const pending = clock.sleep(60_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(clock.sleep(1, AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
