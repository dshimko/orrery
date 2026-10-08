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
