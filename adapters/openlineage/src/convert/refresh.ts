// SPDX-License-Identifier: Apache-2.0
// When each spoke was last refreshed, and the 3% band that decides "past target".
import type { Model } from '../model.js';
import type { Run } from '../runs.js';
import { MS_PER_MINUTE } from '../time.js';
import { writtenSpokes } from './classify.js';

/** Past-target threshold factor: age must exceed target by 3% (stability rule 4). */
export const PAST_TARGET_FACTOR = 1.03;
/** Age reported for a spoke with no refresh in the lookback: seven days. */
export const NO_EVIDENCE_AGE_MINUTES = 7 * 24 * 60;

/** Refresh times per spoke (ascending, distinct), from runs that wrote a dataset in it. */
export function refreshesBySpoke(model: Model, runs: readonly Run[]): Map<string, number[]> {
  const times = new Map<string, Set<number>>(model.spokes.map((spoke) => [spoke.id, new Set()]));
  for (const run of runs) {
    if (run.refreshes.length === 0) continue;
    for (const spokeId of writtenSpokes(model, run)) {
      for (const ms of run.refreshes) times.get(spokeId)?.add(ms);
    }
  }
  return new Map([...times].map(([id, set]) => [id, [...set].sort((a, b) => a - b)]));
}

export function ageMinutesAt(refreshes: readonly number[], atMs: number): number {
  const last = refreshes.filter((ms) => ms <= atMs).at(-1);
  if (last === undefined) return NO_EVIDENCE_AGE_MINUTES;
  return Math.round(Math.max(0, (atMs - last) / MS_PER_MINUTE) * 10) / 10;
}

export function isPastTarget(ageMinutes: number, targetMinutes: number): boolean {
  return ageMinutes > targetMinutes * PAST_TARGET_FACTOR;
}
