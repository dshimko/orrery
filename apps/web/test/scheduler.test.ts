// SPDX-License-Identifier: Apache-2.0
import type { PlatformEvent, Snapshot } from '@orrery/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Api } from '../src/lib/api.js';
import {
  createScheduler,
  EVENT_WINDOW_MS,
  RETRY_DELAY_MS,
  SNAPSHOT_REFRESH_MS,
} from '../src/lib/scheduler.js';

const START = new Date('2026-03-04T10:40:00Z');
const snapshot = { envId: 'prod' } as unknown as Snapshot;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(extra: { fetchEvents?: boolean } = {}) {
  let nowMs = START.getTime();
  const eventCalls: { since: Date; until: Date; signal: AbortSignal | undefined }[] = [];
  const snapshotCalls: { at: Date; signal: AbortSignal | undefined }[] = [];
  const pendingEvents: Deferred<PlatformEvent[]>[] = [];
  const pendingSnapshots: Deferred<Snapshot>[] = [];
  const api = {
    snapshot: (_id: string, at: Date, signal?: AbortSignal) => {
      snapshotCalls.push({ at, signal });
      const next = deferred<Snapshot>();
      pendingSnapshots.push(next);
      return next.promise;
    },
    events: (_id: string, since: Date, until: Date, signal?: AbortSignal) => {
      eventCalls.push({ since, until, signal });
      const next = deferred<PlatformEvent[]>();
      pendingEvents.push(next);
      return next.promise;
    },
  } as unknown as Api;
  const sink = {
    onSnapshot: vi.fn(),
    onEvents: vi.fn(),
    onClear: vi.fn(),
    onError: vi.fn(),
  };
  const scheduler = createScheduler({
    api,
    envId: 'prod',
    now: () => new Date(nowMs),
    initialSnapshotAt: START,
    sink,
    ...extra,
  });
  return {
    scheduler,
    sink,
    eventCalls,
    snapshotCalls,
    pendingEvents,
    pendingSnapshots,
    setNow: (ms: number) => {
      nowMs = ms;
    },
  };
}

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

describe('scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('prefetches the first 15-minute window and pushes its events', async () => {
    const ctx = setup();
    ctx.scheduler.tick();
    expect(ctx.eventCalls).toHaveLength(1);
    expect(ctx.eventCalls[0]?.since).toEqual(START);
    expect(ctx.eventCalls[0]?.until.getTime()).toBe(START.getTime() + EVENT_WINDOW_MS);
    const events = [{ type: 'deploy' }] as unknown as PlatformEvent[];
    ctx.pendingEvents[0]?.resolve(events);
    await flush();
    expect(ctx.sink.onEvents).toHaveBeenCalledWith(events);
  });

  test('skips event windows when fetchEvents is false but still refreshes snapshots', async () => {
    const ctx = setup({ fetchEvents: false });
    ctx.scheduler.tick();
    expect(ctx.eventCalls).toHaveLength(0);
    ctx.setNow(START.getTime() + SNAPSHOT_REFRESH_MS);
    ctx.scheduler.tick();
    expect(ctx.eventCalls).toHaveLength(0);
    expect(ctx.snapshotCalls).toHaveLength(1);
  });

  test('runs one event request at a time', async () => {
    const ctx = setup();
    ctx.scheduler.tick();
    ctx.scheduler.tick();
    ctx.scheduler.tick();
    expect(ctx.eventCalls).toHaveLength(1);
    ctx.pendingEvents[0]?.resolve([]);
    await flush();
    ctx.scheduler.tick();
    expect(ctx.eventCalls).toHaveLength(1);
    // Once simulated time eats into the buffer, the next window starts where the first ended.
    ctx.setNow(START.getTime() + 60_000);
    ctx.scheduler.tick();
    expect(ctx.eventCalls[1]?.since.getTime()).toBe(START.getTime() + EVENT_WINDOW_MS);
    ctx.pendingEvents[1]?.resolve([]);
    await flush();
    ctx.scheduler.tick();
    // 30 minutes are now buffered: nothing more to fetch.
    expect(ctx.eventCalls).toHaveLength(2);
  });

  test('refreshes the snapshot after 5 simulated minutes', async () => {
    const ctx = setup();
    ctx.scheduler.tick();
    expect(ctx.snapshotCalls).toHaveLength(0);
    ctx.setNow(START.getTime() + SNAPSHOT_REFRESH_MS);
    ctx.scheduler.tick();
    expect(ctx.snapshotCalls).toHaveLength(1);
    ctx.scheduler.tick();
    expect(ctx.snapshotCalls).toHaveLength(1);
    ctx.pendingSnapshots[0]?.resolve(snapshot);
    await flush();
    expect(ctx.sink.onSnapshot).toHaveBeenCalledWith(snapshot);
  });

  test('a jump aborts in-flight requests, clears, and refetches', async () => {
    const ctx = setup();
    ctx.scheduler.tick();
    const firstSignal = ctx.eventCalls[0]?.signal;
    const jumpTo = START.getTime() + 6 * 3_600_000;
    ctx.setNow(jumpTo);
    ctx.scheduler.jump();
    expect(firstSignal?.aborted).toBe(true);
    expect(ctx.sink.onClear).toHaveBeenCalledTimes(1);
    expect(ctx.snapshotCalls).toHaveLength(1);
    expect(ctx.snapshotCalls[0]?.at.getTime()).toBe(jumpTo);
    expect(ctx.eventCalls[1]?.since.getTime()).toBe(jumpTo);
    // The aborted request resolving late must not reach the sink.
    ctx.pendingEvents[0]?.resolve([{ type: 'deploy' }] as unknown as PlatformEvent[]);
    await flush();
    expect(ctx.sink.onEvents).not.toHaveBeenCalled();
  });

  test('reports errors, ignores aborts, and retries events after a delay', async () => {
    const ctx = setup();
    ctx.scheduler.tick();
    ctx.pendingEvents[0]?.reject(new Error('boom'));
    await flush();
    expect(ctx.sink.onError).toHaveBeenCalledTimes(1);
    ctx.scheduler.tick();
    expect(ctx.eventCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    ctx.scheduler.tick();
    expect(ctx.eventCalls).toHaveLength(2);
  });

  test('aborts everything and stops on stop()', () => {
    const ctx = setup();
    ctx.scheduler.start();
    ctx.scheduler.tick();
    const signal = ctx.eventCalls[0]?.signal;
    ctx.scheduler.stop();
    expect(signal?.aborted).toBe(true);
    vi.advanceTimersByTime(5000);
    ctx.scheduler.tick();
    expect(ctx.eventCalls).toHaveLength(1);
  });

  test('the timer drives ticks after start()', () => {
    const ctx = setup();
    ctx.scheduler.start();
    vi.advanceTimersByTime(300);
    expect(ctx.eventCalls).toHaveLength(1);
    ctx.scheduler.stop();
  });
});
