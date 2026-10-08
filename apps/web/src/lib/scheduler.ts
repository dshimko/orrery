// SPDX-License-Identifier: Apache-2.0
import type { PlatformEvent, Snapshot } from '@orrery/core';
import { type Api, isAbort } from './api.js';

export const SNAPSHOT_REFRESH_MS = 5 * 60_000;
/** Live mode polls the snapshot this often in real time. */
export const LIVE_POLL_MS = 30_000;
export const EVENT_WINDOW_MS = 15 * 60_000;
export const SCHEDULER_TICK_MS = 250;
/** Pause before retrying a failed event window. */
export const RETRY_DELAY_MS = 3000;

export interface SchedulerSink {
  onSnapshot(snapshot: Snapshot): void;
  onEvents(events: readonly PlatformEvent[]): void;
  /** Called on a jump, before refetching. */
  onClear(): void;
  onError(error: unknown): void;
}

export interface SchedulerOptions {
  api: Api;
  envId: string;
  /** Current simulated time. */
  now: () => Date;
  sink: SchedulerSink;
  /** The snapshot already loaded for the starting time. */
  initialSnapshotAt: Date;
  /** Set to false for views that only draw snapshots (home); default true. */
  fetchEvents?: boolean;
  /**
   * True while the clock follows the wall clock. Live mode polls the snapshot every
   * `LIVE_POLL_MS` of real time and takes events from the live stream, not from windows.
   */
  isLive?: () => boolean;
}

export interface Scheduler {
  /** Starts the periodic check. */
  start(): void;
  /** Runs one check now (also called by the timer). */
  tick(): void;
  /** Live mode: polls again now (e.g. the tab became visible); a no-op in replay. */
  refresh(): void;
  /** Sim time jumped: abort in-flight work, clear transient state, refetch. */
  jump(): void;
  /** Aborts everything and stops the timer. */
  stop(): void;
}

/**
 * Keeps the snapshot fresh and prefetches events. In replay it refreshes every 5 simulated
 * minutes and prefetches events in 15-minute windows ahead of simulated time. In live mode it
 * polls every 30 real seconds at the clock's current instant and leaves events to the stream.
 * One request per kind in flight at a time.
 */
export function createScheduler(options: SchedulerOptions): Scheduler {
  const { api, envId, sink } = options;
  const shouldFetchEvents = options.fetchEvents !== false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let controller = new AbortController();
  const isLive = options.isLive ?? (() => false);
  let snapshotAt = options.initialSnapshotAt.getTime();
  /** Real time of the last live poll attempt. */
  let livePolledAt = Number.NEGATIVE_INFINITY;
  let eventsUntil = options.initialSnapshotAt.getTime();
  let snapshotBusy = false;
  let eventsBusy = false;
  let eventsRetryAt = 0;
  let stopped = false;

  const report = (error: unknown): void => {
    if (!isAbort(error) && !stopped) sink.onError(error);
  };

  function refreshSnapshot(at: Date): void {
    snapshotBusy = true;
    const { signal } = controller;
    api
      .snapshot(envId, at, signal)
      .then((snapshot) => {
        if (signal.aborted) return;
        snapshotAt = at.getTime();
        sink.onSnapshot(snapshot);
      })
      .catch((error: unknown) => {
        // Count the attempt so a failing server is retried every 5 simulated minutes, not each tick.
        if (!signal.aborted) snapshotAt = at.getTime();
        report(error);
      })
      .finally(() => {
        if (!signal.aborted) snapshotBusy = false;
      });
  }

  function prefetchEvents(since: Date): void {
    eventsBusy = true;
    const until = new Date(since.getTime() + EVENT_WINDOW_MS);
    const { signal } = controller;
    api
      .events(envId, since, until, signal)
      .then((events) => {
        if (signal.aborted) return;
        eventsUntil = until.getTime();
        sink.onEvents(events);
      })
      .catch((error: unknown) => {
        if (!signal.aborted) eventsRetryAt = Date.now() + RETRY_DELAY_MS;
        report(error);
      })
      .finally(() => {
        if (!signal.aborted) eventsBusy = false;
      });
  }

  function tick(): void {
    if (stopped) return;
    const now = options.now();
    const nowMs = now.getTime();
    if (isLive()) {
      if (!snapshotBusy && Date.now() - livePolledAt >= LIVE_POLL_MS) {
        livePolledAt = Date.now();
        refreshSnapshot(now);
      }
      return;
    }
    if (!snapshotBusy && Math.abs(nowMs - snapshotAt) >= SNAPSHOT_REFRESH_MS) {
      refreshSnapshot(now);
    }
    if (
      shouldFetchEvents &&
      !eventsBusy &&
      Date.now() >= eventsRetryAt &&
      eventsUntil - nowMs < EVENT_WINDOW_MS
    ) {
      prefetchEvents(new Date(Math.max(eventsUntil, nowMs)));
    }
  }

  return {
    start() {
      if (timer === undefined) timer = setInterval(tick, SCHEDULER_TICK_MS);
    },
    tick,
    refresh() {
      if (stopped || !isLive()) return;
      livePolledAt = Number.NEGATIVE_INFINITY;
      tick();
    },
    jump() {
      if (stopped) return;
      controller.abort();
      controller = new AbortController();
      snapshotBusy = false;
      eventsBusy = false;
      eventsRetryAt = 0;
      const nowMs = options.now().getTime();
      snapshotAt = Number.NEGATIVE_INFINITY;
      livePolledAt = Number.NEGATIVE_INFINITY;
      eventsUntil = nowMs;
      sink.onClear();
      tick();
    },
    stop() {
      stopped = true;
      controller.abort();
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
  };
}
