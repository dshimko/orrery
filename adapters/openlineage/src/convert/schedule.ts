// SPDX-License-Identifier: Apache-2.0
// Upcoming windows from `nominalTime`: runs whose scheduled start is still ahead of the snapshot
// and falls on the same UTC day. Data without such runs (the usual case: nominal times are the
// start of a run that has begun) yields an empty schedule, as before.
import type { ScheduledWindow } from '@orrery/core';
import type { Model } from '../model.js';
import type { Run } from '../runs.js';
import { MS_PER_DAY, MS_PER_MINUTE, utcDayStart } from '../time.js';
import { classifyRun } from './classify.js';

/** Length given to a scheduled window; nominal times carry a start only. */
export const SCHEDULE_WINDOW_MS = 15 * MS_PER_MINUTE;
export const MAX_SCHEDULED_WINDOWS = 50;

export function scheduleOf(model: Model, runs: readonly Run[], atMs: number): ScheduledWindow[] {
  const dayEnd = utcDayStart(atMs) + MS_PER_DAY;
  return runs
    .filter(
      (run) =>
        run.nominalStartMs !== undefined &&
        run.nominalStartMs > atMs &&
        run.nominalStartMs < dayEnd,
    )
    .map((run) => {
      const startMs = run.nominalStartMs as number;
      const isTransfer = classifyRun(model, run).some((klass) => klass.type === 'transfer');
      return {
        id: `${model.envId}:nominal:${run.runKey}`,
        title: `${run.job.name} scheduled`,
        kind: isTransfer ? ('transfer' as const) : ('scripted' as const),
        severity: 'info' as const,
        start: new Date(startMs).toISOString(),
        end: new Date(startMs + SCHEDULE_WINDOW_MS).toISOString(),
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
    .slice(0, MAX_SCHEDULED_WINDOWS);
}
