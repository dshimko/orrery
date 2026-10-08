// SPDX-License-Identifier: Apache-2.0
// Which queries a snapshot or an event window needs, and over which time ranges. Windows are
// snapped to the polling interval of each query class so repeated polls hit the cache.
import { CLASS_INTERVAL_MS, type QueryName } from './queries.js';
import type { Priority } from './poller.js';
import type { Sources } from './sources.js';
import type { RowSets } from './convert/evidence.js';
import {
  MS_PER_DAY,
  MS_PER_HOUR,
  floorTo,
  snapOutward,
  windowEndingAt,
  type TimeWindow,
} from './time.js';

/** Run history behind a snapshot: covers the previous UTC day for previousDayClean. */
export const SNAPSHOT_RUN_LOOKBACK_MS = 2 * MS_PER_DAY;
/** Lookback for the last-write fallbacks and data quality results. */
export const FRESHNESS_LOOKBACK_MS = 7 * MS_PER_DAY;
/** Events look this far before the window so recoveries pair with earlier failures. */
export const EVENT_LOOKBACK_MS = MS_PER_DAY;
/** The window the spend estimate averages over (billing lags up to 12 hours). */
export const BILLING_WINDOW_MS = MS_PER_DAY;

async function gather(
  sources: Sources,
  requests: readonly (readonly [QueryName, TimeWindow])[],
  signal: AbortSignal | undefined,
  priority: Priority,
): Promise<RowSets> {
  const results = await Promise.all(
    requests.map(
      async ([name, window]) =>
        [name, await sources.everywhere(name, window, signal, priority)] as const,
    ),
  );
  return Object.fromEntries(results);
}

/** Row sets for `snapshot(at)`. */
export function fetchSnapshotRows(
  sources: Sources,
  atMs: number,
  signal?: AbortSignal,
): Promise<RowSets> {
  const timeline = CLASS_INTERVAL_MS.timeline;
  const freshness = CLASS_INTERVAL_MS.freshness;
  const runs = windowEndingAt(atMs, SNAPSHOT_RUN_LOOKBACK_MS, timeline);
  const recent = windowEndingAt(atMs, MS_PER_HOUR, timeline);
  const slow = windowEndingAt(atMs, FRESHNESS_LOOKBACK_MS, freshness);
  const monthStart = Date.UTC(new Date(atMs).getUTCFullYear(), new Date(atMs).getUTCMonth(), 1);
  const changes = { since: new Date(monthStart), until: new Date(floorTo(atMs, freshness)) };
  return gather(
    sources,
    [
      ['job_runs', runs],
      ['pipeline_updates', runs],
      ['station_reads', recent],
      ['table_freshness', slow],
      ['lineage_last_writes', slow],
      ['job_changes', changes],
      ['billing_usage', windowEndingAt(atMs, BILLING_WINDOW_MS, freshness)],
    ],
    signal,
    'snapshot',
  );
}

/**
 * Row sets for the events in `window` (callers cap its length). Query bounds are widened to the
 * timeline interval so repeated polls share cache entries; the converter filters to the exact
 * window afterwards. */
export function fetchEventRows(
  sources: Sources,
  window: TimeWindow,
  signal?: AbortSignal,
): Promise<RowSets> {
  const snapped = snapOutward(window, CLASS_INTERVAL_MS.timeline);
  const runs = {
    since: new Date(snapped.since.getTime() - EVENT_LOOKBACK_MS),
    until: snapped.until,
  };
  return gather(
    sources,
    [
      ['job_runs', runs],
      ['pipeline_updates', runs],
      ['lineage_writes', snapped],
      ['station_reads', snapped],
      ['pipeline_expectations', snapped],
      ['job_changes', snapped],
    ],
    signal,
    'events',
  );
}
