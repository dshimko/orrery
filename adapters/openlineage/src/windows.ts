// SPDX-License-Identifier: Apache-2.0
// How far back each request reads, so freshness, alerts, and crossings see their cause.
import type { ModelCore } from './model.js';
import { MS_PER_DAY, MS_PER_MINUTE } from './time.js';
import { PAST_TARGET_FACTOR } from './convert/refresh.js';

/** Longest window `events(since, until)` accepts. */
export const EVENT_WINDOW_MAX_MS = MS_PER_DAY;
/** A live stream ends after this long so the client reconnects. */
export const MAX_LIVE_STREAM_MS = 15 * MS_PER_MINUTE;
const MIN_EVENT_LOOKBACK_MS = MS_PER_DAY;
const MIN_SNAPSHOT_LOOKBACK_MS = 2 * MS_PER_DAY;
const MAX_LOOKBACK_MS = 7 * MS_PER_DAY;
const CROSSING_SLACK_MS = 60 * MS_PER_MINUTE;

const capped = (ms: number): number => Math.min(MAX_LOOKBACK_MS, ms);

/** Events look back far enough to pair recoveries with failures and to find band crossings. */
export function eventLookbackMs(model: Pick<ModelCore, 'maxTargetMinutes'>): number {
  const crossing = model.maxTargetMinutes * PAST_TARGET_FACTOR * MS_PER_MINUTE + CROSSING_SLACK_MS;
  return capped(Math.max(MIN_EVENT_LOOKBACK_MS, crossing));
}

/** A snapshot looks back for the latest refresh of every spoke and for open alerts. */
export function snapshotLookbackMs(model: Pick<ModelCore, 'maxTargetMinutes'>): number {
  const refresh = 2 * model.maxTargetMinutes * MS_PER_MINUTE;
  return capped(Math.max(MIN_SNAPSHOT_LOOKBACK_MS, refresh));
}
