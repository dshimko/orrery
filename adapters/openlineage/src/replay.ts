// SPDX-License-Identifier: Apache-2.0
// Replay of a recorded sample onto the requested time. A sample's events are historical; replay
// repeats the whole sample every period (day or hour) so the scene is alive at any time. This is
// a convenience for file sources only; it never touches Marquez data.
import type { ReplaySettings } from './options.js';
import type { TimeWindow } from './time.js';
import type { RunEvent } from './types.js';

/** Replicas of one run examined per load; bounds the work for absurdly long windows. */
export const MAX_REPLICAS = 2000;

export interface ReplayPlan {
  /** Added to every recorded time before the period shift. */
  baseShiftMs: number;
  periodMs: number;
}

/** The base shift: the anchor minus the sample's earliest event (zero without an anchor). */
export function planReplay(settings: ReplaySettings, earliestMs: number): ReplayPlan {
  const anchor = settings.anchorMs ?? earliestMs;
  return { baseShiftMs: anchor - earliestMs, periodMs: settings.periodMs };
}

/**
 * The replica indexes `k` whose copy of a run spanning `[minMs, maxMs]` overlaps the window
 * (copy `k` runs at `time + baseShift + k * period`). `first > last` means none.
 */
/** `Math.ceil` without negative zero. */
const ceil = (value: number): number => Math.ceil(value) + 0;

export function replicaRange(
  span: { minMs: number; maxMs: number },
  window: TimeWindow,
  plan: ReplayPlan,
): { first: number; last: number } {
  const last = ceil((window.until.getTime() - span.minMs - plan.baseShiftMs) / plan.periodMs) - 1;
  const first = ceil((window.since.getTime() - span.maxMs - plan.baseShiftMs) / plan.periodMs);
  return { first: Math.max(first, last - MAX_REPLICAS + 1), last };
}

/** Copy `k` of a run's events, with a replica run id so copies never merge. */
export function replicaOf(events: readonly RunEvent[], k: number, plan: ReplayPlan): RunEvent[] {
  const shiftMs = plan.baseShiftMs + k * plan.periodMs;
  return events.map((event) => ({
    ...event,
    runId: `${event.runId}@${k}`,
    timeMs: event.timeMs + shiftMs,
    // The schedule moves with the run, so replayed nominal times stay consistent.
    ...(event.nominalStartMs !== undefined
      ? { nominalStartMs: event.nominalStartMs + shiftMs }
      : {}),
  }));
}
