// SPDX-License-Identifier: Apache-2.0
// Alerts from failed and aborted runs. An alert opens when the run ends and closes when the same
// job next completes. Snapshots and events share these rules, so the alerts open at time T are
// exactly those the event stream has opened and not yet closed.
import type { Alert } from '@orrery/core';
import type { Model } from '../model.js';
import type { Run } from '../runs.js';
import { MS_PER_DAY } from '../time.js';
import { readSpokes, writtenSpokes } from './classify.js';

/** How long an unrecovered failure stays an alert. */
export const ALERT_WINDOW_MS = MS_PER_DAY;

export interface RunAlert {
  openedMs: number;
  /** End of the first later completion of the same job, when there is one. */
  closedMs?: number;
  alert: Alert;
  /** The failed run wrote an ingest spoke. */
  writesIngest: boolean;
}

function targetsOf(model: Model, run: Run): Alert['targets'] {
  const spokes = writtenSpokes(model, run);
  const ids = spokes.length > 0 ? spokes : readSpokes(model, run).slice(0, 1);
  return ids.length > 0 ? ids.map((id) => `spoke:${id}` as const) : ['hub'];
}

function alertFor(model: Model, run: Run): { alert: Alert; writesIngest: boolean } {
  const writesIngest = writtenSpokes(model, run).some(
    (id) => model.spokes.find((spoke) => spoke.id === id)?.role === 'ingest',
  );
  const aborted = run.state === 'aborted';
  return {
    writesIngest,
    alert: {
      id: `${model.envId}:run:${run.runKey}`,
      severity: writesIngest ? 'incident' : 'warning',
      kind: aborted ? 'run-aborted' : 'run-failed',
      title: `${run.job.name} ${aborted ? 'aborted' : 'failed'}`,
      text: `The run ended as ${aborted ? 'aborted' : 'failed'}.${run.errorMessage ? ` ${run.errorMessage}` : ''}`,
      openedAt: new Date(run.endMs).toISOString(),
      targets: targetsOf(model, run),
    },
  };
}

/** Every alert the runs imply, ordered by opening time. */
export function deriveAlerts(model: Model, runs: readonly Run[]): RunAlert[] {
  const completions = new Map<string, number[]>();
  for (const run of runs) {
    if (run.state !== 'complete') continue;
    completions.set(run.jobKey, [...(completions.get(run.jobKey) ?? []), run.endMs]);
  }
  const alerts: RunAlert[] = [];
  for (const run of runs) {
    if (run.state !== 'failed' && run.state !== 'aborted') continue;
    const closedMs = (completions.get(run.jobKey) ?? []).find((ms) => ms > run.endMs);
    alerts.push({
      openedMs: run.endMs,
      ...(closedMs !== undefined ? { closedMs } : {}),
      ...alertFor(model, run),
    });
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
