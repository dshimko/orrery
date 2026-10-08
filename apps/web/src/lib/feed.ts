// SPDX-License-Identifier: Apache-2.0
import type { Snapshot, Topology } from '@orrery/core';
import { type Api, isAbort } from './api.js';
import { createScheduler, type Scheduler } from './scheduler.js';

/** Pause before retrying a topology that failed to load. */
export const TOPOLOGY_RETRY_MS = 10_000;

export interface FeedSink {
  onTopology(topology: Topology): void;
  onSnapshot(snapshot: Snapshot): void;
  /** A load or refresh failed. The feed keeps retrying; one environment never blocks another. */
  onError(error: unknown): void;
}

export interface FeedOptions {
  api: Api;
  envId: string;
  /** Current shared simulated time. */
  now: () => Date;
  sink: FeedSink;
}

export interface EnvFeed {
  /** Sim time jumped (scrub): refetch the snapshot now. */
  jump(): void;
  stop(): void;
}

/**
 * Loads one environment's topology once (retrying on failure), then keeps its snapshot fresh
 * with the shared scheduler: every 5 simulated minutes and after a jump. Events are not fetched
 * because the Orloj faces draw snapshots only.
 */
export function createEnvFeed(options: FeedOptions): EnvFeed {
  const { api, envId, now, sink } = options;
  const controller = new AbortController();
  let scheduler: Scheduler | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const startScheduler = (): void => {
    scheduler = createScheduler({
      api,
      envId,
      now,
      initialSnapshotAt: now(),
      fetchEvents: false,
      sink: {
        onSnapshot: sink.onSnapshot,
        onEvents: () => undefined,
        onClear: () => undefined,
        onError: sink.onError,
      },
    });
    scheduler.start();
    // The scheduler starts with nothing loaded; a jump fetches the first snapshot.
    scheduler.jump();
  };

  const loadTopology = (): void => {
    api
      .topology(envId, controller.signal)
      .then((topology) => {
        if (stopped) return;
        sink.onTopology(topology);
        startScheduler();
      })
      .catch((error: unknown) => {
        if (stopped || isAbort(error)) return;
        sink.onError(error);
        retryTimer = setTimeout(loadTopology, TOPOLOGY_RETRY_MS);
      });
  };

  loadTopology();

  return {
    jump() {
      scheduler?.jump();
    },
    stop() {
      stopped = true;
      controller.abort();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      scheduler?.stop();
    },
  };
}
