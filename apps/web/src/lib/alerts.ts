// SPDX-License-Identifier: Apache-2.0
import { type Alert, parseRef, type Severity } from '@orrery/core';
import type { PickTarget } from '@orrery/render';

const SEVERITY_RANK: Record<Severity, number> = { incident: 0, warning: 1, info: 2 };

/** Most severe first, then most recently opened first, then id for a stable order. */
export function compareAlerts(a: Alert, b: Alert): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  const byTime = Date.parse(b.openedAt) - Date.parse(a.openedAt);
  if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
  return a.id.localeCompare(b.id);
}

export function sortAlerts(alerts: readonly Alert[]): Alert[] {
  return [...alerts].sort(compareAlerts);
}

/** Maps an object reference to something the view can focus, if it is focusable. */
export function refToPickTarget(ref: string): PickTarget | null {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  switch (parsed.kind) {
    case 'hub':
    case 'shipyard':
      return { kind: parsed.kind };
    case 'spoke':
    case 'site':
    case 'useCase':
    case 'foreign':
      return parsed.id === undefined ? null : { kind: parsed.kind, id: parsed.id };
    default:
      return null;
  }
}

/** The first target of the alert that the view can focus. */
export function firstFocusTarget(alert: Alert): PickTarget | null {
  for (const ref of alert.targets) {
    const target = refToPickTarget(ref);
    if (target) return target;
  }
  return null;
}

/** Incident-severity alerts whose id is not in `seen`. */
export function newIncidents(seen: ReadonlySet<string>, alerts: readonly Alert[]): Alert[] {
  return alerts.filter((alert) => alert.severity === 'incident' && !seen.has(alert.id));
}

export function announcementFor(incidents: readonly Alert[]): string {
  const [first, ...rest] = incidents;
  if (!first) return '';
  const more = rest.length > 0 ? ` and ${rest.length} more` : '';
  return `New incident: ${first.title}${more}.`;
}

/** Warning and incident alerts: the ones that count for the tab title and the live banner. */
export function isAttentionAlert(alert: Alert): boolean {
  return alert.severity === 'warning' || alert.severity === 'incident';
}

export function countAttention(alerts: readonly Alert[]): number {
  return alerts.filter(isAttentionAlert).length;
}

/** Alert ids seen so far, per environment. An environment absent from the map is not loaded yet. */
export type SeenAlerts = ReadonlyMap<string, ReadonlySet<string>>;

export interface OpenAlert {
  envId: string;
  alert: Alert;
}

export interface AlertDiff {
  seen: SeenAlerts;
  /** Warning and incident alerts that were not open at the previous snapshot. */
  fresh: OpenAlert[];
}

/**
 * Diffs the open alerts of the loaded environments against what was seen before. An
 * environment's first appearance only records its alerts, so alerts present at startup are
 * never reported. Info alerts are recorded but never reported.
 */
export function diffAlerts(
  seen: SeenAlerts,
  loadedEnvIds: readonly string[],
  open: readonly OpenAlert[],
): AlertDiff {
  const next = new Map<string, ReadonlySet<string>>();
  const fresh: OpenAlert[] = [];
  for (const envId of loadedEnvIds) {
    const own = open.filter((item) => item.envId === envId);
    const before = seen.get(envId);
    next.set(envId, new Set(own.map((item) => item.alert.id)));
    if (!before) continue;
    for (const item of own) {
      if (isAttentionAlert(item.alert) && !before.has(item.alert.id)) fresh.push(item);
    }
  }
  return { seen: next, fresh };
}

/** Screen reader text for newly opened alerts, e.g. `New incident on prod: Late feed.` */
export function announcementForNew(fresh: readonly { envName: string; alert: Alert }[]): string {
  const [first, ...rest] = fresh;
  if (!first) return '';
  const more = rest.length > 0 ? ` and ${rest.length} more` : '';
  return `New ${first.alert.severity} on ${first.envName}: ${first.alert.title}${more}.`;
}
