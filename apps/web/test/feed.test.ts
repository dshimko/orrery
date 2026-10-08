// SPDX-License-Identifier: Apache-2.0
import type { Snapshot, Topology } from '@orrery/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Api } from '../src/lib/api.js';
import { createEnvFeed, TOPOLOGY_RETRY_MS } from '../src/lib/feed.js';
import { SNAPSHOT_REFRESH_MS } from '../src/lib/scheduler.js';

const START = new Date('2026-03-04T10:40:00Z');
const topology = { envId: 'stg' } as unknown as Topology;
const snapshot = { envId: 'stg' } as unknown as Snapshot;

function setup(
  topologyResults: (() => Promise<Topology>)[],
  snapshotResult: () => Promise<Snapshot>,
) {
  let nowMs = START.getTime();
  const topologyCalls = vi.fn();
  const snapshotCalls = vi.fn();
  const eventCalls = vi.fn();
  const queue = [...topologyResults];
  const api = {
    topology: (...args: unknown[]) => {
      topologyCalls(...args);
      const next = queue.shift();
      return next ? next() : Promise.reject(new Error('no more'));
    },
    snapshot: (...args: unknown[]) => {
      snapshotCalls(...args);
      return snapshotResult();
    },
    events: (...args: unknown[]) => {
      eventCalls(...args);
      return Promise.resolve([]);
    },
  } as unknown as Api;
  const sink = { onTopology: vi.fn(), onSnapshot: vi.fn(), onError: vi.fn() };
  const feed = createEnvFeed({ api, envId: 'stg', now: () => new Date(nowMs), sink });
  return {
    feed,
    sink,
    topologyCalls,
    snapshotCalls,
    eventCalls,
    setNow: (ms: number) => {
      nowMs = ms;
    },
  };
}

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

describe('createEnvFeed', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('loads the topology, then a snapshot, and never fetches events', async () => {
    const ctx = setup([() => Promise.resolve(topology)], () => Promise.resolve(snapshot));
    await flush();
    expect(ctx.sink.onTopology).toHaveBeenCalledWith(topology);
    expect(ctx.snapshotCalls).toHaveBeenCalledTimes(1);
    expect(ctx.sink.onSnapshot).toHaveBeenCalledWith(snapshot);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.eventCalls).not.toHaveBeenCalled();
    ctx.feed.stop();
  });

  test('refetches the snapshot after a scrub', async () => {
    const ctx = setup([() => Promise.resolve(topology)], () => Promise.resolve(snapshot));
    await flush();
    ctx.setNow(START.getTime() + 2 * SNAPSHOT_REFRESH_MS);
    ctx.feed.jump();
    await flush();
    expect(ctx.snapshotCalls).toHaveBeenCalledTimes(2);
    ctx.feed.stop();
  });

  test('reports a failing topology and retries without blocking', async () => {
    const ctx = setup(
      [() => Promise.reject(new Error('down')), () => Promise.resolve(topology)],
      () => Promise.resolve(snapshot),
    );
    await flush();
    expect(ctx.sink.onError).toHaveBeenCalledTimes(1);
    expect(ctx.sink.onSnapshot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TOPOLOGY_RETRY_MS);
    expect(ctx.sink.onTopology).toHaveBeenCalledWith(topology);
    expect(ctx.sink.onSnapshot).toHaveBeenCalledWith(snapshot);
    ctx.feed.stop();
  });

  test('reports a failing snapshot', async () => {
    const ctx = setup([() => Promise.resolve(topology)], () => Promise.reject(new Error('503')));
    await flush();
    expect(ctx.sink.onError).toHaveBeenCalled();
    ctx.feed.stop();
  });

  test('stops retrying once stopped', async () => {
    const ctx = setup([() => Promise.reject(new Error('down'))], () => Promise.resolve(snapshot));
    await flush();
    ctx.feed.stop();
    await vi.advanceTimersByTimeAsync(TOPOLOGY_RETRY_MS * 3);
    expect(ctx.topologyCalls).toHaveBeenCalledTimes(1);
  });
});
