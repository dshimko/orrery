// SPDX-License-Identifier: Apache-2.0
// Folds a stream of RunEvents into one record per run.
import {
  datasetKey,
  eventIdentity,
  jobKey,
  type DatasetRef,
  type JobRef,
  type RunEvent,
  type RunEventType,
} from './types.js';

export type RunState = 'running' | 'complete' | 'failed' | 'aborted';

export interface Run {
  runKey: string;
  job: JobRef;
  jobKey: string;
  state: RunState;
  startMs: number | undefined;
  /** When the run ended; for a running run, the time of its latest event. */
  endMs: number;
  inputs: DatasetRef[];
  outputs: DatasetRef[];
  /**
   * When the run refreshed its outputs: its completion, or for a streaming job every event
   * (START, RUNNING, COMPLETE). Ascending.
   */
  refreshes: number[];
}

const TERMINAL: Readonly<Partial<Record<RunEventType, RunState>>> = {
  COMPLETE: 'complete',
  FAIL: 'failed',
  ABORT: 'aborted',
};

/** Tie-break among events of one run at the same instant. */
const TYPE_RANK: Readonly<Record<RunEventType, number>> = {
  START: 0,
  RUNNING: 1,
  OTHER: 2,
  COMPLETE: 3,
  FAIL: 4,
  ABORT: 5,
};

function mergeDatasets(into: Map<string, DatasetRef>, refs: readonly DatasetRef[]): void {
  for (const ref of refs) {
    const key = datasetKey(ref);
    const known = into.get(key);
    into.set(key, known ? { ...known, tags: { ...known.tags, ...ref.tags } } : ref);
  }
}

function refreshTimes(
  ordered: readonly RunEvent[],
  streaming: boolean,
  terminal: RunEvent | undefined,
): number[] {
  if (streaming) {
    const beats = ordered.filter(
      (event) => event.eventType !== 'FAIL' && event.eventType !== 'ABORT',
    );
    return [...new Set(beats.map((event) => event.timeMs))];
  }
  return terminal && TERMINAL[terminal.eventType] === 'complete' ? [terminal.timeMs] : [];
}

function foldRun(runKey: string, events: readonly RunEvent[]): Run {
  const ordered = [...events].sort(
    (a, b) => a.timeMs - b.timeMs || TYPE_RANK[a.eventType] - TYPE_RANK[b.eventType],
  );
  const inputs = new Map<string, DatasetRef>();
  const outputs = new Map<string, DatasetRef>();
  for (const event of ordered) {
    mergeDatasets(inputs, event.inputs);
    mergeDatasets(outputs, event.outputs);
  }
  const first = ordered[0] as RunEvent;
  const last = ordered[ordered.length - 1] as RunEvent;
  const terminal = ordered.find((event) => TERMINAL[event.eventType] !== undefined);
  const start = ordered.find((event) => event.eventType === 'START');
  // The newest event carries the freshest job facets.
  const job = (terminal ?? last).job;
  return {
    runKey,
    job,
    jobKey: jobKey(job),
    state: terminal ? (TERMINAL[terminal.eventType] as RunState) : 'running',
    startMs: (start ?? first).timeMs,
    endMs: (terminal ?? last).timeMs,
    inputs: [...inputs.values()],
    outputs: [...outputs.values()],
    refreshes: refreshTimes(ordered, job.streaming, terminal),
  };
}

/**
 * One record per run, ordered by end time then run id. Duplicate events (the same run, type,
 * and time) are ignored. With `atMs`, only events up to and including that instant are used.
 */
export function buildRuns(events: readonly RunEvent[], atMs?: number): Run[] {
  const seen = new Set<string>();
  const byRun = new Map<string, RunEvent[]>();
  for (const event of events) {
    if (atMs !== undefined && event.timeMs > atMs) continue;
    const identity = eventIdentity(event);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const list = byRun.get(event.runId);
    if (list) list.push(event);
    else byRun.set(event.runId, [event]);
  }
  return [...byRun.entries()]
    .map(([runKey, list]) => foldRun(runKey, list))
    .sort((a, b) => a.endMs - b.endMs || a.runKey.localeCompare(b.runKey));
}
