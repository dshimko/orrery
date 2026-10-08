// SPDX-License-Identifier: Apache-2.0
import type { PlatformEvent } from '@orrery/core';
import { describe, expect, it } from 'vitest';
import { EventQueue, isTimeJump, JUMP_MINUTES, MAX_QUEUED } from '../src/queue.js';

const stream = (ts: string): PlatformEvent => ({
  envId: 'prod',
  ts,
  type: 'source.stream',
  sourceGroupId: 'g',
  siteId: 's',
  spokeId: 'ingest',
});
const ms = (ts: string): number => Date.parse(ts);

describe('EventQueue', () => {
  it('drains only events whose timestamp has passed, in order', () => {
    const queue = new EventQueue();
    queue.push([
      stream('2026-10-07T10:02:00Z'),
      stream('2026-10-07T10:00:00Z'),
      stream('2026-10-07T10:01:00Z'),
    ]);
    const due = queue.drain(ms('2026-10-07T10:01:00Z'));
    expect(due.map((q) => q.event.ts)).toEqual(['2026-10-07T10:00:00Z', '2026-10-07T10:01:00Z']);
    expect(queue.size).toBe(1);
  });

  it('numbers same-timestamp events of one type so each gets its own randomness', () => {
    const queue = new EventQueue();
    const ts = '2026-10-07T10:00:00Z';
    queue.push([stream(ts), stream(ts), stream(ts)]);
    expect(queue.drain(ms(ts)).map((q) => q.index)).toEqual([0, 1, 2]);
  });

  it('skips events with unparseable timestamps and clears on request', () => {
    const queue = new EventQueue();
    queue.push([stream('not a date'), stream('2026-10-07T10:00:00Z')]);
    expect(queue.size).toBe(1);
    queue.clear();
    expect(queue.size).toBe(0);
  });

  it('bounds the queue by dropping the furthest-future events', () => {
    const queue = new EventQueue();
    const base = ms('2026-10-07T00:00:00Z');
    const events = Array.from({ length: MAX_QUEUED + 10 }, (_, i) =>
      stream(new Date(base + i * 1000).toISOString()),
    );
    queue.push(events);
    expect(queue.size).toBe(MAX_QUEUED);
    expect(queue.drain(Infinity).at(-1)?.event.ts).toBe(events[MAX_QUEUED - 1]?.ts);
  });
});

describe('isTimeJump', () => {
  const t = ms('2026-10-07T10:00:00Z');

  it('treats normal forward progress and equal times as continuous', () => {
    expect(isTimeJump(t, t)).toBe(false);
    expect(isTimeJump(t, t + 5_000)).toBe(false);
    expect(isTimeJump(t, t + JUMP_MINUTES * 60_000)).toBe(false);
  });

  it('flags backward moves and forward jumps past ten sim-minutes', () => {
    expect(isTimeJump(t, t - 1)).toBe(true);
    expect(isTimeJump(t, t + JUMP_MINUTES * 60_000 + 1)).toBe(true);
  });
});
