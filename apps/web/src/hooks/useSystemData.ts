// SPDX-License-Identifier: Apache-2.0
import type { Snapshot } from '@orrery/core';
import type { SystemView } from '@orrery/render';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import type { Api } from '../lib/api.js';
import { createScheduler, type Scheduler } from '../lib/scheduler.js';
import { createThrottle } from '../lib/throttle.js';
import type { TimeController } from '../lib/time.js';

const DOM_UPDATE_MS = 250;

export interface SystemData {
  /** Latest snapshot, updated at most 4x/s for DOM rendering. */
  snapshot: Snapshot;
  /** Set when a background refresh failed; the page keeps showing the last good data. */
  refreshError: string | null;
  /** Call after a scrub or jump. */
  jump: () => void;
}

/** Runs the data scheduler for one environment and feeds the view. */
export function useSystemData(
  api: Api,
  envId: string,
  controller: TimeController,
  initial: Snapshot,
  viewRef: RefObject<SystemView | null>,
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
      sink: {
        onSnapshot(next) {
          viewRef.current?.setSnapshot(next);
          throttle.push(next);
          setRefreshError(null);
        },
        onEvents(events) {
          viewRef.current?.pushEvents(events);
        },
        onClear() {
          viewRef.current?.clearTransient();
        },
        onError() {
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
  }, [api, envId, controller, viewRef]);

  const jump = useCallback(() => {
    schedulerRef.current?.jump();
  }, []);

  return { snapshot, refreshError, jump };
}
