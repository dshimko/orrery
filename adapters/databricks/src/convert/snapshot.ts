// SPDX-License-Identifier: Apache-2.0
// Rows to Snapshot: freshness, activity, counts, alerts, backlog, spend, and the release calendar.
// Pure and deterministic for a given topology, evidence, and time.
import {
  DEFAULT_EVENT_WORKLOAD,
  type CalendarDay,
  type Snapshot,
  type SnapshotPart,
  type Status,
  type UseCaseState,
} from '@orrery/core';
import type { QueryName } from '../queries.js';
import { schemaMatches } from '../discovery/matchers.js';
import type { Discovery, Model, ModelObject } from '../discovery/types.js';
import { schemaKey } from '../rows.js';
import { MS_PER_DAY, MS_PER_HOUR, utcDayStart } from '../time.js';
import { ALERT_WINDOW_MS, deriveAlerts, openAlertsAt, type RunAlert } from './alerts.js';
import { classifyObject } from './classify.js';
import { releaseOf, type Evidence } from './evidence.js';
import {
  RUNNING_STALE_MS,
  ageMinutesOf,
  isPastTarget,
  spokeActivity,
  spokeFreshness,
} from './freshness.js';

const STATEMENTS_FOR_FULL_ACTIVITY = 20;
const DEPLOYS_FOR_FULL_ACTIVITY = 3;
const WORKLOAD_LOAD_FOR_FULL = 3;
const BACKLOG_FULL = 8;
const HOURS_BILLED = 24;
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

const round = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

function isRunning(run: Evidence['runs'][number], atMs: number): boolean {
  return (
    run.outcome === 'running' && run.startedMs <= atMs && atMs - run.endedMs <= RUNNING_STALE_MS
  );
}

function groupActivity(model: Model, evidence: Evidence, atMs: number, groupId: string): number {
  let load = 0;
  for (const run of evidence.runs) {
    if (model.objects.get(run.objectKey)?.groupId !== groupId) continue;
    if (isRunning(run, atMs)) load += 1;
    else if (
      run.outcome === 'success' &&
      run.endedMs <= atMs &&
      atMs - run.endedMs <= MS_PER_HOUR
    ) {
      load += RECENT_WEIGHT;
    }
  }
  return clamp01(load / WORKLOAD_LOAD_FOR_FULL);
}

function readsInLastHour(
  model: Model,
  evidence: Evidence,
  atMs: number,
  useCase: Model['useCases'][number],
): number {
  return evidence.reads
    .filter((r) => r.minuteMs <= atMs && atMs - r.minuteMs < MS_PER_HOUR)
    .reduce((sum, read) => {
      const schema = model.schemas.get(schemaKey(read.catalog, read.schema));
      const hit = schema !== undefined && schemaMatches(useCase.matcher, schema);
      return hit ? sum + read.statements : sum;
    }, 0);
}

function useCaseStates(
  discovery: Discovery,
  evidence: Evidence,
  atMs: number,
  open: readonly RunAlert[],
): UseCaseState[] {
  const { model, topology } = discovery;
  return model.useCases.map((useCase) => {
    const reads = topology.useCases.find((u) => u.id === useCase.id)?.reads ?? [];
    const statements = readsInLastHour(model, evidence, atMs, useCase);
    const severities = open
      .filter((a) => a.alert.targets.some((t) => reads.some((id) => t === `spoke:${id}`)))
      .map((a) => a.alert.severity);
    const status: Status = severities.includes('incident')
      ? 'incident'
      : severities.length > 0
        ? 'warning'
        : 'ok';
    return {
      id: useCase.id,
      activity: clamp01(statements / STATEMENTS_FOR_FULL_ACTIVITY),
      status,
      note: `${statements} statements in the last hour`,
    };
  });
}

function workloadMix(
  model: Model,
  evidence: Evidence,
  atMs: number,
  consumer: number,
  deploysLastHour: number,
): Record<string, number> {
  const load = new Map<string, number>();
  for (const run of evidence.runs) {
    const object: ModelObject | undefined = model.objects.get(run.objectKey);
    const klass = object ? classifyObject(model, object) : undefined;
    const workload = klass ? DEFAULT_EVENT_WORKLOAD[klass.type] : undefined;
    if (!workload) continue;
    const weight = isRunning(run, atMs)
      ? 1
      : run.outcome === 'success' && run.endedMs <= atMs && atMs - run.endedMs <= MS_PER_HOUR
        ? RECENT_WEIGHT
        : 0;
    load.set(workload, (load.get(workload) ?? 0) + weight);
  }
  const mix: Record<string, number> = {};
  for (const id of WORKLOADS) mix[id] = clamp01((load.get(id) ?? 0) / WORKLOAD_LOAD_FOR_FULL);
  mix['serving'] = consumer;
  mix['build'] = clamp01(deploysLastHour / DEPLOYS_FOR_FULL_ACTIVITY);
  return mix;
}

function calendarOf(model: Model, evidence: Evidence, atMs: number): Snapshot['calendar'] {
  const at = new Date(atMs);
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const monthStart = Date.UTC(year, month, 1);
  const releases = new Array<number>(daysInMonth).fill(0);
  for (const change of evidence.changes) {
    if (releaseOf(change, model.releaseTagKey) === undefined) continue;
    if (change.changedMs < monthStart || change.changedMs > atMs) continue;
    const index = Math.floor((change.changedMs - monthStart) / MS_PER_DAY);
    releases[index] = (releases[index] ?? 0) + 1;
  }
  const today = at.getUTCDate();
  const days: CalendarDay[] = releases.map((count, i) => ({
    day: i + 1,
    releases: count,
    promotion: false,
    monthEndClose: i + 1 === daysInMonth,
    isPast: i + 1 <= today,
  }));
  return { year, month: month + 1, days };
}

export const UNAVAILABLE_REASONS = {
  schedule: 'No schedule data from this adapter.',
  calendar: 'No release data: job history is not readable.',
  spend: 'No cost data: system billing tables are not readable.',
  backlog: 'No backlog data: job and pipeline run history is not readable.',
  consumers: 'No consumer data: query history is not readable.',
} as const satisfies Record<SnapshotPart, string>;

/**
 * Parts this adapter cannot supply. The schedule is never available (decision 83). The others
 * depend on which source queries degraded for the current viewer: a part is unavailable when its
 * source failed on any target, except backlog, which needs both run histories to be lost.
 */
export function unavailableParts(
  degraded: ReadonlySet<QueryName>,
): NonNullable<Snapshot['unavailable']> {
  const parts: Partial<Record<SnapshotPart, string>> = {
    schedule: UNAVAILABLE_REASONS.schedule,
  };
  if (degraded.has('job_changes')) parts.calendar = UNAVAILABLE_REASONS.calendar;
  if (degraded.has('billing_usage')) parts.spend = UNAVAILABLE_REASONS.spend;
  if (degraded.has('job_runs') && degraded.has('pipeline_updates')) {
    parts.backlog = UNAVAILABLE_REASONS.backlog;
  }
  if (degraded.has('station_reads')) parts.consumers = UNAVAILABLE_REASONS.consumers;
  return parts;
}

/**
 * The full state of one environment at `at`. `degraded` names the queries that failed for the
 * viewer; it decides which parts are marked unavailable.
 */
export function buildSnapshot(
  discovery: Discovery,
  evidence: Evidence,
  at: Date,
  degraded: ReadonlySet<QueryName> = new Set(),
): Snapshot {
  const { model, topology } = discovery;
  const atMs = at.getTime();
  const freshness = spokeFreshness(model, evidence, atMs);
  const spokes = topology.spokes.map((spoke) => {
    const targetMinutes = spoke.freshness.targetMinutes;
    const ageMinutes = ageMinutesOf(freshness.get(spoke.id), atMs);
    return {
      id: spoke.id,
      ageMinutes,
      targetMinutes,
      pastTarget: isPastTarget(ageMinutes, targetMinutes),
      activity: spokeActivity(model, evidence, atMs, spoke.id),
    };
  });
  const alerts = deriveAlerts(model, evidence.runs);
  const open = openAlertsAt(alerts, atMs);
  const dayStart = utcDayStart(atMs);
  const useCases = useCaseStates(discovery, evidence, atMs, open);
  const consumerActivity = mean(useCases.map((u) => u.activity));
  const releaseChanges = evidence.changes.filter(
    (c) => releaseOf(c, model.releaseTagKey) !== undefined && c.changedMs <= atMs,
  );
  const ingestLoad =
    evidence.runs.filter(
      (r) => isRunning(r, atMs) && model.objects.get(r.objectKey)?.spokeId === model.ingestId,
    ).length +
    open.filter(
      (a) => model.ingestId !== undefined && a.alert.targets.includes(`spoke:${model.ingestId}`),
    ).length;
  return {
    envId: topology.envId,
    at: at.toISOString(),
    hub: { activity: round(mean(spokes.map((s) => s.activity)), 4) },
    spokes,
    sourceGroups: topology.sourceGroups.map((group) => {
      const activity = groupActivity(model, evidence, atMs, group.id);
      return {
        id: group.id,
        activity,
        sites: group.sites.map((site) => ({ id: site.id, activity })),
      };
    }),
    useCases,
    workloads: workloadMix(
      model,
      evidence,
      atMs,
      consumerActivity,
      releaseChanges.filter((c) => atMs - c.changedMs <= MS_PER_HOUR).length,
    ),
    counts: {
      runningPipelines: evidence.runs.filter(
        (r) => model.objects.has(r.objectKey) && isRunning(r, atMs),
      ).length,
      failedRuns: evidence.runs.filter(
        (r) =>
          r.outcome === 'failed' &&
          model.objects.has(r.objectKey) &&
          r.endedMs <= atMs &&
          atMs - r.endedMs < ALERT_WINDOW_MS,
      ).length,
      spokesPastTarget: spokes.filter((s) => s.pastTarget).length,
      deploysToday: releaseChanges.filter((c) => c.changedMs >= dayStart).length,
      products: topology.spokes.reduce((sum, s) => sum + s.metrics.products, 0),
      openIncidents: open.filter((a) => a.alert.severity !== 'info').length,
    },
    backlog: clamp01(ingestLoad / BACKLOG_FULL),
    spendPerHour: round(evidence.spendTotal / HOURS_BILLED, 2),
    consumerActivity,
    previousDayClean: !alerts.some(
      (a) =>
        a.alert.severity === 'incident' &&
        a.openedMs >= dayStart - MS_PER_DAY &&
        a.openedMs < dayStart,
    ),
    alerts: open.map((a) => a.alert),
    schedule: [],
    calendar: calendarOf(model, evidence, atMs),
    unavailable: unavailableParts(degraded),
  };
}
