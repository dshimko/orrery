// SPDX-License-Identifier: Apache-2.0
// An in-memory event source over a parsed file, with optional replay.
import type { ReplaySettings } from './options.js';
import { planReplay, replicaOf, replicaRange, type ReplayPlan } from './replay.js';
import type { EventSource, LoadResult } from './source.js';
import type { TimeWindow } from './time.js';
import type { RunEvent } from './types.js';

interface RecordedRun {
  events: RunEvent[];
  minMs: number;
  maxMs: number;
}

function groupRuns(events: readonly RunEvent[]): RecordedRun[] {
  const byRun = new Map<string, RecordedRun>();
  for (const event of events) {
    const run = byRun.get(event.runId);
    if (!run) {
      byRun.set(event.runId, { events: [event], minMs: event.timeMs, maxMs: event.timeMs });
      continue;
    }
    run.events.push(event);
    run.minMs = Math.min(run.minMs, event.timeMs);
    run.maxMs = Math.max(run.maxMs, event.timeMs);
  }
  return [...byRun.values()];
}

export class FileEventSource implements EventSource {
  readonly kind = 'file';
  private readonly runs: readonly RecordedRun[];
  private readonly plan: ReplayPlan | undefined;

  constructor(
    readonly recorded: readonly RunEvent[],
    replay: ReplaySettings | undefined,
  ) {
    this.runs = groupRuns(recorded);
    const earliest = this.runs.reduce((min, run) => Math.min(min, run.minMs), Infinity);
    this.plan = replay ? planReplay(replay, earliest) : undefined;
  }

  async check(): Promise<void> {
    // The file was read at init; nothing can fail later.
  }

  async load(window: TimeWindow): Promise<LoadResult> {
    const since = window.since.getTime();
    const until = window.until.getTime();
    const events: RunEvent[] = [];
    for (const run of this.runs) {
      if (!this.plan) {
        if (run.maxMs >= since && run.minMs < until) events.push(...run.events);
        continue;
      }
      const { first, last } = replicaRange(run, window, this.plan);
      for (let k = first; k <= last; k += 1) events.push(...replicaOf(run.events, k, this.plan));
    }
    return { events, truncated: false };
  }
}
