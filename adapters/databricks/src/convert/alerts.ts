// SPDX-License-Identifier: Apache-2.0
// Alerts derived from failed and blocked runs. An alert opens when the run ends and closes when
// the same pipeline or job next succeeds. The rules are shared by snapshots and events, so the
// alerts open at time T are exactly those the event stream has opened and not yet closed.
import type { Alert } from '@orrery/core';
import type { Model, ModelObject } from '../discovery/types.js';
import { MS_PER_DAY } from '../time.js';
import type { RunRecord } from './evidence.js';

/** How long an unrecovered failure stays an alert. */
export const ALERT_WINDOW_MS = MS_PER_DAY;

export interface RunAlert {
  openedMs: number;
  /** End of the first later successful run of the same object, when there is one. */
  closedMs?: number;
  alert: Alert;
}

function target(object: ModelObject): Alert['targets'] {
  if (object.spokeId !== undefined) return [`spoke:${object.spokeId}`];
  return object.groupId !== undefined ? [`sourceGroup:${object.groupId}`] : [];
}

function alertFor(model: Model, object: ModelObject, run: RunRecord): Alert {
  const blocked = run.outcome === 'blocked';
  const ingest =
    object.spokeId !== undefined && model.spokes.get(object.spokeId)?.role === 'ingest';
  return {
    id: `${model.envId}:run:${run.runKey}`,
    severity: !blocked && ingest ? 'incident' : 'warning',
    kind: blocked ? 'run-blocked' : 'run-failed',
    title: `${object.name} ${blocked ? 'blocked' : 'failed'}`,
    text: `The ${object.kind} run ended with state ${run.state}.`,
    openedAt: new Date(run.endedMs).toISOString(),
    targets: target(object),
  };
}

/** Every alert the runs imply, ordered by opening time. */
export function deriveAlerts(model: Model, runs: readonly RunRecord[]): RunAlert[] {
  const successes = new Map<string, number[]>();
  for (const run of runs) {
    if (run.outcome !== 'success') continue;
    const list = successes.get(run.objectKey) ?? [];
    list.push(run.endedMs);
    successes.set(run.objectKey, list);
  }
  const alerts: RunAlert[] = [];
  for (const run of runs) {
    if (run.outcome !== 'failed' && run.outcome !== 'blocked') continue;
    const object = model.objects.get(run.objectKey);
    if (!object) continue;
    const alert = alertFor(model, object, run);
    if (alert.targets.length === 0) continue;
    const closedMs = (successes.get(run.objectKey) ?? []).find((ms) => ms > run.endedMs);
    alerts.push({ openedMs: run.endedMs, ...(closedMs !== undefined ? { closedMs } : {}), alert });
  }
  return alerts.sort((a, b) => a.openedMs - b.openedMs || a.alert.id.localeCompare(b.alert.id));
}

/** Alerts open at `atMs`: opened by then, within the alert window, and not yet recovered. */
export function openAlertsAt(alerts: readonly RunAlert[], atMs: number): RunAlert[] {
  return alerts.filter(
    (a) =>
      a.openedMs <= atMs &&
      a.openedMs > atMs - ALERT_WINDOW_MS &&
      (a.closedMs === undefined || a.closedMs >= atMs),
  );
}
