// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { EventStore, MAX_STORED_EVENTS } from '../src/event-store.js';
import { ev } from './helpers.js';

const at = (minute: number, run = `r${minute}`) =>
  ev({ type: 'COMPLETE', atMin: minute, run, job: 'j' });

describe('EventStore', () => {
  it('holds up to 100,000 events by default', () => {
    expect(MAX_STORED_EVENTS).toBe(100_000);
  });

  it('merges events by identity', () => {
    const store = new EventStore(10);
    expect(store.add([at(1), at(2)])).toBe(0);
    store.add([at(1), at(3)]);
    expect(store.size).toBe(3);
  });

  it('evicts the oldest events by time once over capacity and reports how many', () => {
    const store = new EventStore(3);
    store.add([at(5), at(1), at(3)]);
    const evicted = store.add([at(4), at(2)]);
    expect(evicted).toBe(2);
    expect(
      store
        .all()
        .map((e) => e.runId)
        .sort(),
    ).toEqual(['r3', 'r4', 'r5']);
  });

  it('stays at capacity under a long stream of events', () => {
    const store = new EventStore(50);
    for (let minute = 0; minute < 500; minute += 1) store.add([at(minute)]);
    expect(store.size).toBe(50);
    expect(Math.min(...store.all().map((e) => e.timeMs))).toBe(at(450).timeMs);
  });

  it('drops events older than the lookback', () => {
    const store = new EventStore(10);
    store.add([at(1), at(2), at(3)]);
    store.prune(at(2).timeMs);
    expect(
      store
        .all()
        .map((e) => e.runId)
        .sort(),
    ).toEqual(['r2', 'r3']);
  });

  it('rejects a capacity that is not a positive whole number', () => {
    expect(() => new EventStore(0)).toThrow(RangeError);
    expect(() => new EventStore(1.5)).toThrow(RangeError);
  });
});
