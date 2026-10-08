// SPDX-License-Identifier: Apache-2.0
// Runs to Snapshot: freshness, activity, counts, alerts, backlog, and a calendar of zeros (run
// events carry no releases or promotions). Pure and deterministic for a given model, runs, and time.
import {
  DEFAULT_EVENT_WORKLOAD,
  type CalendarDay,
  type Snapshot,
  type Status,
  type UseCaseState,
} from '@orrery/core';
import type { Model } from '../model.js';
import type { Run } from '../runs.js';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, utcDayStart } from '../time.js';
import { ALERT_WINDOW_MS, deriveAlerts, openAlertsAt, type RunAlert } from './alerts.js';
import { classifyRun, hasHubOutput, serveReads, writtenSpokes } from './classify.js';
import { ageMinutesAt, isPastTarget, refreshesBySpoke } from './refresh.js';
import { scheduleOf } from './schedule.js';

/** A run without a final state counts as running while its latest event is this recent. */
export const RUNNING_STALE_MS = 90 * MS_PER_MINUTE;
const LOAD_FOR_FULL = 3;
const USE_CASE_RUNS_FOR_FULL = 2;
const BACKLOG_FULL = 8;
const RECENT_WEIGHT = 0.5;
const WORKLOADS = [
  'streaming',
  'batch',
  'transfer',
  'transform',
  'ml',
  'serving',
  'build',
] as const;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

function isRunning(run: Run, atMs: number): boolean {
  return (
    run.state === 'running' &&
    (run.startMs ?? run.endMs) <= atMs &&
    atMs - run.endMs <= RUNNING_STALE_MS
  );
}

/** Load of one run at `atMs`: running counts fully, a completion in the last hour counts half. */
function weightOf(run: Run, atMs: number): number {
  if (isRunning(run, atMs)) return 1;
  const recent = run.state === 'complete' && run.endMs <= atMs && atMs - run.endMs <= MS_PER_HOUR;
  return recent ? RECENT_WEIGHT : 0;
}

function loadBy(
  runs: readonly Run[],
  atMs: number,
  keysOf: (run: Run) => readonly string[],
): Map<string, number> {
  const load = new Map<string, number>();
  for (const run of runs) {
    const weight = weightOf(run, atMs);
    if (weight === 0) continue;
    for (const key of keysOf(run)) load.set(key, (load.get(key) ?? 0) + weight);
  }
  return load;
}

function useCaseStates(
  model: Model,
  runs: readonly Run[],
  atMs: number,
  open: readonly RunAlert[],
): UseCaseState[] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    if (run.state !== 'complete' || run.endMs > atMs || atMs - run.endMs > MS_PER_HOUR) continue;
    for (const useCaseId of new Set(serveReads(model, run).map((read) => read.useCaseId))) {
      counts.set(useCaseId, (counts.get(useCaseId) ?? 0) + 1);
    }
  }
  return model.topology.useCases.map((useCase) => {
    const severities = open
      .filter((a) => a.alert.targets.some((t) => useCase.reads.some((id) => t === `spoke:${id}`)))
      .map((a) => a.alert.severity);
    const status: Status = severities.includes('incident')
      ? 'incident'
      : severities.length > 0
        ? 'warning'
        : 'ok';
    const reads = counts.get(useCase.id) ?? 0;
    return {
      id: useCase.id,
      activity: clamp01(reads / USE_CASE_RUNS_FOR_FULL),
      status,
      note: `${reads} ${reads === 1 ? 'run' : 'runs'} in the last hour`,
    };
  });
}

function workloadMix(
  model: Model,
  runs: readonly Run[],
  atMs: number,
  consumer: number,
): Record<string, number> {
  const load = new Map<string, number>();
  for (const run of runs) {
    const weight = weightOf(run, atMs);
    if (weight === 0) continue;
    for (const klass of classifyRun(model, run)) {
      const workload = DEFAULT_EVENT_WORKLOAD[klass.type];
      if (workload) load.set(workload, (load.get(workload) ?? 0) + weight);
    }
  }
  const mix: Record<string, number> = {};
  for (const id of WORKLOADS) mix[id] = clamp01((load.get(id) ?? 0) / LOAD_FOR_FULL);
  mix['serving'] = consumer;
  return mix;
}

function calendarOf(atMs: number): Snapshot['calendar'] {
  const at = new Date(atMs);
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = at.getUTCDate();
  const days: CalendarDay[] = Array.from({ length: daysInMonth }, (_, i) => ({
    day: i + 1,
    releases: 0,
    promotion: false,
    monthEndClose: i + 1 === daysInMonth,
    isPast: i + 1 <= today,
  }));
  return { year, month: month + 1, days };
}

/** The full state of one environment at `at`, from runs whose events are at or before it. */
export function buildSnapshot(model: Model, runs: readonly Run[], at: Date): Snapshot {
  const atMs = at.getTime();
  const { topology } = model;
  const refreshes = refreshesBySpoke(model, runs);
  const spokeLoad = loadBy(runs, atMs, (run) => writtenSpokes(model, run));
  const spokes = topology.spokes.map((spoke) => {
    const ageMinutes = ageMinutesAt(refreshes.get(spoke.id) ?? [], atMs);
    const targetMinutes = spoke.freshness.targetMinutes;
    return {
      id: spoke.id,
      ageMinutes,
      targetMinutes,
      pastTarget: isPastTarget(ageMinutes, targetMinutes),
      activity: clamp01((spokeLoad.get(spoke.id) ?? 0) / LOAD_FOR_FULL),
    };
  });
  const groupLoad = loadBy(runs, atMs, (run) =>
    classifyRun(model, run).flatMap((klass) => ('groupId' in klass ? [klass.groupId] : [])),
  );
  const hubLoad =
    loadBy(runs, atMs, (run) => (hasHubOutput(model, run) ? ['hub'] : [])).get('hub') ?? 0;
  const alerts = deriveAlerts(model, runs);
  const open = openAlertsAt(alerts, atMs);
  const useCases = useCaseStates(model, runs, atMs, open);
  const consumerActivity = mean(useCases.map((u) => u.activity));
  const dayStart = utcDayStart(atMs);
  const ingestIds = new Set(model.spokes.filter((s) => s.role === 'ingest').map((s) => s.id));
  const ingestLoad =
    runs.filter(
      (r) => isRunning(r, atMs) && writtenSpokes(model, r).some((id) => ingestIds.has(id)),
    ).length + open.filter((a) => a.writesIngest).length;
  return {
    envId: topology.envId,
    at: at.toISOString(),
    hub: {
      activity: round4(clamp01(mean(spokes.map((s) => s.activity)) + hubLoad / LOAD_FOR_FULL)),
    },
    spokes,
    sourceGroups: topology.sourceGroups.map((group) => {
      const activity = clamp01((groupLoad.get(group.id) ?? 0) / LOAD_FOR_FULL);
      return {
        id: group.id,
        activity,
        sites: group.sites.map((site) => ({ id: site.id, activity })),
      };
    }),
    useCases,
    workloads: workloadMix(model, runs, atMs, consumerActivity),
    counts: {
      runningPipelines: runs.filter((r) => isRunning(r, atMs)).length,
      failedRuns: runs.filter(
        (r) =>
          (r.state === 'failed' || r.state === 'aborted') &&
          r.endMs <= atMs &&
          atMs - r.endMs < ALERT_WINDOW_MS,
      ).length,
      spokesPastTarget: spokes.filter((s) => s.pastTarget).length,
      deploysToday: 0,
      products: topology.spokes.reduce((sum, s) => sum + s.metrics.products, 0),
      openIncidents: open.filter((a) => a.alert.severity !== 'info').length,
    },
    backlog: clamp01(ingestLoad / BACKLOG_FULL),
    spendPerHour: 0,
    consumerActivity,
    previousDayClean: !alerts.some(
      (a) =>
        a.alert.severity === 'incident' &&
        a.openedMs >= dayStart - MS_PER_DAY &&
        a.openedMs < dayStart,
    ),
    alerts: open.map((a) => a.alert),
    schedule: scheduleOf(model, runs, atMs),
    calendar: calendarOf(atMs),
  };
}
