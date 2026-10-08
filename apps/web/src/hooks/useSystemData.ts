// SPDX-License-Identifier: Apache-2.0
import type { Snapshot } from '@orrery/core';
import type { SystemView } from '@orrery/render';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useOnVisible } from './useOnVisible.js';
import { type Api, eventStreamUrl } from '../lib/api.js';
import { openEventStream } from '../lib/event-stream.js';
import type { FreshnessTracker } from '../lib/freshness.js';
import { createScheduler, type Scheduler } from '../lib/scheduler.js';
import { createThrottle } from '../lib/throttle.js';
import type { TimeController } from '../lib/time.js';

const DOM_UPDATE_MS = 250;

export interface SystemData {
  /** Latest snapshot, updated at most 4x/s for DOM rendering. */
  snapshot: Snapshot;
  /** Set when a background refresh failed; the page keeps showing the last good data. */
  refreshError: string | null;
  /** Call after a scrub or returning to live. */
  jump: () => void;
}

/**
 * Runs the data scheduler for one environment and feeds the view. While `isLive`, events come
 * from the environment's live stream; in replay they are prefetched in windows.
 */
export function useSystemData(
  api: Api,
  envId: string,
  controller: TimeController,
  initial: Snapshot,
  viewRef: RefObject<SystemView | null>,
  isLive: boolean,
  freshness?: FreshnessTracker,
): SystemData {
  const [snapshot, setSnapshot] = useState(initial);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const schedulerRef = useRef<Scheduler | null>(null);

  useEffect(() => {
    const throttle = createThrottle<Snapshot>(setSnapshot, DOM_UPDATE_MS);
    const scheduler = createScheduler({
      api,
      envId,
      now: () => controller.state().at,
      initialSnapshotAt: controller.state().at,
      isLive: () => controller.state().live === true,
      sink: {
        onSnapshot(next) {
          viewRef.current?.setSnapshot(next);
          throttle.push(next);
          setRefreshError(null);
          freshness?.ok(envId, Date.now());
        },
        onEvents(events) {
          viewRef.current?.pushEvents(events);
        },
        onClear() {
          viewRef.current?.clearTransient();
        },
        onError() {
          freshness?.fail(envId);
          setRefreshError('Live data is unavailable. Showing the last update.');
        },
      },
    });
    schedulerRef.current = scheduler;
    scheduler.start();
    scheduler.tick();
    return () => {
      scheduler.stop();
      throttle.cancel();
      schedulerRef.current = null;
    };
  }, [api, envId, controller, viewRef, freshness]);

  useEffect(() => {
    if (!isLive) return;
    const stream = openEventStream({
      url: (since) => eventStreamUrl(envId, since),
      since: controller.state().at,
      onEvent: (event) => {
        viewRef.current?.pushEvents([event]);
      },
    });
    return () => {
      stream.close();
    };
  }, [envId, controller, viewRef, isLive]);

  useOnVisible(() => {
    schedulerRef.current?.refresh();
  });

  const jump = useCallback(() => {
    schedulerRef.current?.jump();
  }, []);

  return { snapshot, refreshError, jump };
}
