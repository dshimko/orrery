// SPDX-License-Identifier: Apache-2.0
// Per-spoke data age. Evidence order (spec): data quality results, then the last successful
// pipeline update or job run of the spoke's objects, then the last lineage write into its schemas.
import type { Model } from '../discovery/types.js';
import { MS_PER_HOUR, MS_PER_MINUTE } from '../time.js';
import type { Evidence } from './evidence.js';

/** Past-target threshold factor: age must exceed target by 3% (stability rule 4). */
export const PAST_TARGET_FACTOR = 1.03;
/** Age reported for a spoke with no evidence at all: the longest lookback, seven days. */
export const NO_EVIDENCE_AGE_MINUTES = 7 * 24 * 60;
/** A run without a final state counts as running while its last slice is this recent. */
export const RUNNING_STALE_MS = 90 * MS_PER_MINUTE;
const ACTIVITY_FULL = 3;
const RECENT_COMPLETION_WEIGHT = 0.5;

export type FreshnessSource = 'quality' | 'run' | 'lineage' | 'none';

export interface SpokeFreshness {
  lastMs?: number;
  source: FreshnessSource;
}

function latest(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : Math.max(...values);
}

/** Last refresh time of each spoke at `atMs`, from the best evidence available. */
export function spokeFreshness(
  model: Model,
  evidence: Evidence,
  atMs: number,
): Map<string, SpokeFreshness> {
  const result = new Map<string, SpokeFreshness>();
  for (const spokeId of model.spokes.keys()) {
    const inSpoke = (key: string): boolean => model.schemas.get(key)?.spokeId === spokeId;
    const quality = latest(
      evidence.quality
        .filter((q) => q.eventMs <= atMs && q.lastCommitMs <= atMs && inSpoke(q.schemaKey))
        .map((q) => q.lastCommitMs),
    );
    const runs = latest(
      evidence.runs
        .filter(
          (r) =>
            r.outcome === 'success' &&
            r.endedMs <= atMs &&
            model.objects.get(r.objectKey)?.spokeId === spokeId,
        )
        .map((r) => r.endedMs),
    );
    const lineage = latest(
      evidence.lastWrites
        .filter((w) => w.lastMs <= atMs && inSpoke(w.schemaKey))
        .map((w) => w.lastMs),
    );
    if (quality !== undefined) result.set(spokeId, { lastMs: quality, source: 'quality' });
    else if (runs !== undefined) result.set(spokeId, { lastMs: runs, source: 'run' });
    else if (lineage !== undefined) result.set(spokeId, { lastMs: lineage, source: 'lineage' });
    else result.set(spokeId, { source: 'none' });
  }
  return result;
}

export function ageMinutesOf(freshness: SpokeFreshness | undefined, atMs: number): number {
  if (freshness?.lastMs === undefined) return NO_EVIDENCE_AGE_MINUTES;
  const minutes = Math.max(0, (atMs - freshness.lastMs) / MS_PER_MINUTE);
  return Math.round(minutes * 10) / 10;
}

export function isPastTarget(ageMinutes: number, targetMinutes: number): boolean {
  return ageMinutes > targetMinutes * PAST_TARGET_FACTOR;
}

/** 0 to 1 activity from running runs and completions in the last hour, per spoke. */
export function spokeActivity(
  model: Model,
  evidence: Evidence,
  atMs: number,
  spokeId: string,
): number {
  let load = 0;
  for (const run of evidence.runs) {
    if (model.objects.get(run.objectKey)?.spokeId !== spokeId) continue;
    if (
      run.outcome === 'running' &&
      run.startedMs <= atMs &&
      atMs - run.endedMs <= RUNNING_STALE_MS
    ) {
      load += 1;
    } else if (
      run.outcome === 'success' &&
      run.endedMs <= atMs &&
      atMs - run.endedMs <= MS_PER_HOUR
    ) {
      load += RECENT_COMPLETION_WEIGHT;
    }
  }
  return Math.min(1, load / ACTIVITY_FULL);
}
