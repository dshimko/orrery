// SPDX-License-Identifier: Apache-2.0
import { COMPARE_PATH, type Query, buildUrl } from './router.js';

/**
 * Compare mode is our reading of the spec's "compare mode": two or three environments shown
 * side by side as full system views that share ONE simulated clock, so the same moment can be
 * checked in each. The spec does not define it further. Each pane has its own camera and data
 * scheduler; the time controls, and the `t`, `date`, `speed`, and `paused` parameters, apply to all.
 */
export const MIN_COMPARE_ENVS = 2;
export const MAX_COMPARE_ENVS = 3;

/** The last two environments in promotion order, the pair people most often compare. */
export function defaultComparePair(orderedIds: readonly string[]): string[] {
  return orderedIds.slice(-MIN_COMPARE_ENVS);
}

/**
 * Parses `envs=a,b,c`: unknown and repeated ids are dropped and at most three are kept. When
 * fewer than two remain, the default pair is used.
 */
export function parseCompareEnvs(
  text: string | undefined,
  orderedIds: readonly string[],
): string[] {
  const requested = (text ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  const valid: string[] = [];
  for (const id of requested) {
    if (orderedIds.includes(id) && !valid.includes(id)) valid.push(id);
  }
  const kept = valid.slice(0, MAX_COMPARE_ENVS);
  return kept.length >= MIN_COMPARE_ENVS ? kept : defaultComparePair(orderedIds);
}

export function serializeCompareEnvs(ids: readonly string[]): string {
  return ids.join(',');
}

export function compareUrl(ids: readonly string[], extra: Query = {}): string {
  return buildUrl(COMPARE_PATH, { ...extra, envs: serializeCompareEnvs(ids) });
}

/**
 * Puts `envId` in a slot, swapping with the slot that already shows it, or removes the slot when
 * `envId` is null. A removal that would leave fewer than two environments is ignored.
 */
export function withCompareSlot(
  ids: readonly string[],
  slot: number,
  envId: string | null,
): string[] {
  const next = [...ids];
  if (envId === null) {
    if (next.length <= MIN_COMPARE_ENVS) return next;
    next.splice(slot, 1);
    return next;
  }
  const other = next.indexOf(envId);
  const previous = next[slot];
  if (other >= 0 && other !== slot && previous !== undefined) next[other] = previous;
  next[slot] = envId;
  return next.slice(0, MAX_COMPARE_ENVS);
}
