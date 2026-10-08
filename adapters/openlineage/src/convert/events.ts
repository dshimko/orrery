// SPDX-License-Identifier: Apache-2.0
// Runs to PlatformEvents. Every event has a stable identity (for live de-duplication) and a
// timestamp taken from the data, never from the clock, so a given set of runs always yields the
// same events and any split of a window yields the same events in total.
import { DEFAULT_EVENT_WORKLOAD, type PlatformEvent } from '@orrery/core';
import { spokeOf, type Model } from '../model.js';
import type { Run } from '../runs.js';
import { MS_PER_MINUTE, type TimeWindow } from '../time.js';
import { ALERT_WINDOW_MS, deriveAlerts } from './alerts.js';
import { classifyRun, serveReads, writtenSpokes, type RunClass } from './classify.js';
import { PAST_TARGET_FACTOR, refreshesBySpoke } from './refresh.js';

export interface IdentifiedEvent {
  /** Stable identity: the same real-world occurrence always has the same id. */
  id: string;
  event: PlatformEvent;
}

type Draft = {
  [K in PlatformEvent['type']]: Omit<Extract<PlatformEvent, { type: K }>, 'envId' | 'ts'>;
}[PlatformEvent['type']];

const TYPE_ORDER: readonly PlatformEvent['type'][] = [
  'alert.close',
  'alert.open',
  'deploy',
  'source.stream',
  'source.batch',
  'ingest.gate',
  'transfer',
  'copy',
  'product.publish',
  'ml.run',
  'freshness.change',
  'serve.read',
  'federation.query',
  'promotion',
];
/** One cargo pod per this much run time, on top of the first. */
const MINUTES_PER_BATCH_POD = 5;
const MAX_BATCH_PODS = 4;
/** With output statistics: one more cargo pod per this many bytes written, or rows written. */
export const BYTES_PER_BATCH_POD = 256 * 1024 * 1024;
export const ROWS_PER_BATCH_POD = 1_000_000;

class Collector {
  private readonly items = new Map<string, { ms: number; event: PlatformEvent }>();

  constructor(
    private readonly envId: string,
    private readonly window: TimeWindow,
  ) {}

  add(id: string, ms: number, draft: Draft): void {
    if (ms < this.window.since.getTime() || ms >= this.window.until.getTime()) return;
    const workload = DEFAULT_EVENT_WORKLOAD[draft.type];
    const event = {
      ...draft,
      envId: this.envId,
      ts: new Date(ms).toISOString(),
      ...(workload ? { workload } : {}),
    } as PlatformEvent;
    this.items.set(id, { ms, event });
  }

  result(): IdentifiedEvent[] {
    return [...this.items.entries()]
      .sort(
        ([ia, a], [ib, b]) =>
          a.ms - b.ms ||
          TYPE_ORDER.indexOf(a.event.type) - TYPE_ORDER.indexOf(b.event.type) ||
          ia.localeCompare(ib),
      )
      .map(([id, item]) => ({ id, event: item.event }));
  }
}

/**
 * Cargo pods of a batch, 1 to 4. The data a run wrote to the spoke decides it when the run
 * reported `outputStatistics` (bytes first, else rows); otherwise its duration does.
 */
export function batchSize(model: Model, run: Run, spokeId: string): number {
  const written = run.outputs.filter((ref) => spokeOf(model, ref) === spokeId);
  const sum = (pick: (ref: Run['outputs'][number]) => number | undefined): number | undefined => {
    const values = written.map(pick).filter((value): value is number => value !== undefined);
    return values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0);
  };
  const bytes = sum((ref) => ref.stats?.sizeBytes);
  const rows = sum((ref) => ref.stats?.rowCount);
  const extra =
    bytes !== undefined
      ? bytes / BYTES_PER_BATCH_POD
      : rows !== undefined
        ? rows / ROWS_PER_BATCH_POD
        : Math.max(0, run.endMs - (run.startMs ?? run.endMs)) /
          MS_PER_MINUTE /
          MINUTES_PER_BATCH_POD;
  return 1 + Math.min(MAX_BATCH_PODS - 1, Math.floor(extra));
}

function classDraft(model: Model, klass: RunClass, run: Run): Draft {
  switch (klass.type) {
    case 'source.stream':
      return {
        type: klass.type,
        tier: klass.tier,
        sourceGroupId: klass.groupId,
        siteId: klass.siteId,
        spokeId: klass.spokeId,
      };
    case 'source.batch': {
      return {
        type: klass.type,
        tier: klass.tier,
        sourceGroupId: klass.groupId,
        siteId: klass.siteId,
        spokeId: klass.spokeId,
        size: batchSize(model, run, klass.spokeId),
      };
    }
    case 'transfer':
      return { type: 'transfer', tier: klass.tier, fromSpokeId: klass.spokeId, hubId: model.hubId };
    case 'copy':
      return { type: 'copy', tier: klass.tier, hubId: model.hubId, spokeId: klass.spokeId };
    case 'product.publish':
      return {
        type: 'product.publish',
        tier: klass.tier,
        hubId: model.hubId,
        spokeId: klass.spokeId,
      };
  }
}

function runEvents(out: Collector, model: Model, runs: readonly Run[]): void {
  for (const run of runs) {
    const times = run.refreshes;
    if (times.length === 0) continue;
    const classes = classifyRun(model, run);
    for (const ms of run.job.streaming ? times : times.slice(-1)) {
      for (const klass of classes) {
        out.add(
          `run:${run.runKey}:${klass.spokeId}:${klass.type}:${ms}`,
          ms,
          classDraft(model, klass, run),
        );
      }
    }
    if (run.job.streaming) continue;
    for (const read of serveReads(model, run)) {
      out.add(`serve:${run.runKey}:${read.useCaseId}:${read.spokeId}`, run.endMs, {
        type: 'serve.read',
        tier: 'gold',
        useCaseId: read.useCaseId,
        spokeId: read.spokeId,
      });
    }
  }
}

function freshnessEvents(out: Collector, model: Model, runs: readonly Run[]): void {
  const bySpoke = refreshesBySpoke(model, runs);
  for (const spoke of model.spokes) {
    const times = bySpoke.get(spoke.id) ?? [];
    const limitMs = spoke.targetMinutes * PAST_TARGET_FACTOR * MS_PER_MINUTE;
    times.forEach((ms, i) => {
      out.add(`fresh:${spoke.id}:${ms}`, ms, {
        type: 'freshness.change',
        spokeId: spoke.id,
        ageMinutes: 0,
        targetMinutes: spoke.targetMinutes,
        pastTarget: false,
      });
      const crossesAt = ms + limitMs;
      const next = times[i + 1];
      if (next !== undefined && next <= crossesAt) return;
      out.add(`late:${spoke.id}:${ms}`, crossesAt, {
        type: 'freshness.change',
        spokeId: spoke.id,
        ageMinutes: Math.round(spoke.targetMinutes * PAST_TARGET_FACTOR * 10) / 10,
        targetMinutes: spoke.targetMinutes,
        pastTarget: true,
      });
    });
  }
}

function alertEvents(out: Collector, model: Model, runs: readonly Run[]): void {
  for (const item of deriveAlerts(model, runs)) {
    out.add(`alert.open:${item.alert.id}`, item.openedMs, {
      type: 'alert.open',
      alert: item.alert,
    });
    if (item.closedMs !== undefined && item.openedMs > item.closedMs - ALERT_WINDOW_MS) {
      out.add(`alert.close:${item.alert.id}`, item.closedMs, {
        type: 'alert.close',
        alertId: item.alert.id,
      });
    }
  }
}

function gateEvents(out: Collector, model: Model, runs: readonly Run[]): void {
  for (const run of runs) {
    if (run.state !== 'failed' && run.state !== 'aborted') continue;
    for (const spokeId of writtenSpokes(model, run)) {
      if (model.spokes.find((spoke) => spoke.id === spokeId)?.role !== 'ingest') continue;
      out.add(`gate:${run.runKey}:${spokeId}`, run.endMs, {
        type: 'ingest.gate',
        tier: 'silver',
        spokeId,
        result: 'reject',
      });
    }
  }
}

/** All events with `since <= ts < until`, sorted by timestamp, with stable identities. */
export function buildEvents(
  model: Model,
  runs: readonly Run[],
  window: TimeWindow,
): IdentifiedEvent[] {
  const out = new Collector(model.envId, window);
  runEvents(out, model, runs);
  freshnessEvents(out, model, runs);
  alertEvents(out, model, runs);
  gateEvents(out, model, runs);
  return out.result();
}
