// SPDX-License-Identifier: Apache-2.0
import type { ObjectRef } from './refs.js';

export type Severity = 'incident' | 'warning' | 'info';
export type Status = 'ok' | 'warning' | 'incident';

export interface Alert {
  id: string;
  severity: Severity;
  /** Free-form category such as `transfer-hold` or `schema-drift`. */
  kind: string;
  title: string;
  text: string;
  /** ISO timestamp. */
  openedAt: string;
  /** ISO timestamp when the alert is expected or known to close. */
  closesAt?: string;
  targets: ObjectRef[];
}

export interface SpokeState {
  id: string;
  ageMinutes: number;
  targetMinutes: number;
  pastTarget: boolean;
  /** 0 to 1. */
  activity: number;
}

export interface UseCaseState {
  id: string;
  activity: number;
  status: Status;
  note: string;
}

export interface ScheduledWindow {
  id: string;
  title: string;
  kind: 'transfer' | 'release' | 'scripted';
  severity: Severity;
  start: string;
  end: string;
}

export interface CalendarDay {
  day: number;
  releases: number;
  promotion: boolean;
  monthEndClose: boolean;
  /** False for days after the snapshot date: planned rather than observed. */
  isPast: boolean;
}

export interface Snapshot {
  envId: string;
  /** ISO timestamp the snapshot describes. */
  at: string;
  hub: { activity: number };
  spokes: SpokeState[];
  sourceGroups: { id: string; activity: number; sites: { id: string; activity: number }[] }[];
  useCases: UseCaseState[];
  /** Activity per workload id, 0 to 1. */
  workloads: Record<string, number>;
  counts: {
    runningPipelines: number;
    failedRuns: number;
    spokesPastTarget: number;
    deploysToday: number;
    products: number;
    openIncidents: number;
  };
  /** Share of the ingest yard in use, 0 to 1. */
  backlog: number;
  spendPerHour: number;
  /** Mean consumer activity across use cases, 0 to 1. */
  consumerActivity: number;
  /** True when the previous UTC day had no incident-severity alert. */
  previousDayClean: boolean;
  alerts: Alert[];
  /** Planned windows starting within the next 24 hours of `at` (rolling window): transfers, releases, and scripted events. */
  schedule: ScheduledWindow[];
  calendar: { year: number; month: number; days: CalendarDay[] };
}
