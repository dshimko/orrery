// SPDX-License-Identifier: Apache-2.0
import {
  lcg,
  type Alert,
  type CalendarDay,
  type ScheduledWindow,
  type Snapshot,
} from '@orrery/core';
import type { ScriptEntry, World } from './build.js';
import { BATCH } from './curves.js';
import {
  MINUTES_PER_DAY,
  activeAt,
  ageMinutes,
  backlog,
  consumerActivity,
  deployRate,
  hubActivity,
  isPastTarget,
  meanSiteActivity,
  minuteOfDay,
  mlLevel,
  siteActivity,
  spokeActivity,
  spokeCurveActivity,
  targetMinutes,
  useCaseStatus,
} from './state.js';

const MS_PER_MINUTE = 60_000;
const TRANSFER_WINDOW_MINUTES = 15;
/** A shuttle counts as flying for this long after a scheduled transfer. */
const TRANSFER_FLIGHT_MINUTES = 10;
const PROMOTION_CHANCE: Readonly<Record<string, number>> = { dev: 0.5 };
const DEFAULT_PROMOTION_CHANCE = 0.3;

export const isoAt = (absMinute: number): string =>
  new Date(absMinute * MS_PER_MINUTE).toISOString();

const dayKey = (absMinute: number): string => isoAt(absMinute).slice(0, 10);

export function alertFor(world: World, entry: ScriptEntry, startedAt: number): Alert {
  return {
    id: `${world.envId}:${entry.id}:${dayKey(startedAt)}`,
    severity: entry.severity,
    kind: entry.kind,
    title: entry.title,
    text: entry.text,
    openedAt: isoAt(startedAt),
    closesAt: isoAt(startedAt + entry.durationMinutes),
    targets: [...entry.targets] as Alert['targets'],
  };
}

function schedule(world: World, dayStart: number): ScheduledWindow[] {
  const scripted = world.script.map((entry) => ({
    id: entry.id,
    title: entry.title,
    kind: entry.kind === 'release' ? ('release' as const) : ('scripted' as const),
    severity: entry.severity,
    start: isoAt(dayStart + entry.startMinute),
    end: isoAt(dayStart + entry.startMinute + entry.durationMinutes),
  }));
  const transfers = world.transferMinutes.map((minute) => ({
    id: `transfer-${minute}`,
    title: 'Transfer to the core',
    kind: 'transfer' as const,
    severity: 'info' as const,
    start: isoAt(dayStart + minute),
    end: isoAt(dayStart + minute + TRANSFER_WINDOW_MINUTES),
  }));
  return [...scripted, ...transfers].sort((a, b) => a.start.localeCompare(b.start));
}

/** Releases per day this month, seeded as in the reference so the calendar never reshuffles. */
function calendar(world: World, at: Date): Snapshot['calendar'] {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = at.getUTCDate();
  const next = lcg(world.profile.seed * 7 + month);
  const chance = PROMOTION_CHANCE[world.tier] ?? DEFAULT_PROMOTION_CHANCE;
  const days: CalendarDay[] = Array.from({ length: daysInMonth }, (_, i) => ({
    day: i + 1,
    releases: Math.round(next() * world.profile.deploysPerHour * 6),
    promotion: next() < chance,
    monthEndClose: i + 1 === daysInMonth,
    isPast: i + 1 <= today,
  }));
  return { year, month: month + 1, days };
}

function inTransferFlight(world: World, m: number): boolean {
  return world.transferMinutes.some((t) => m >= t && m < t + TRANSFER_FLIGHT_MINUTES);
}

function workloadMix(world: World, abs: number): Record<string, number> {
  const m = minuteOfDay(abs);
  const avgSite = meanSiteActivity(world, abs);
  const domains = world.topology.spokes.filter((s) => s.role === 'domain');
  const domainAvg =
    domains.length > 0
      ? domains.reduce((acc, s) => acc + spokeActivity(world, s.id, abs), 0) / domains.length
      : 0;
  const useCases = world.topology.useCases;
  const serving =
    useCases.length > 0
      ? useCases.reduce((acc, u) => acc + useCaseStatus(world, u.id, abs).activity, 0) /
        useCases.length
      : 0;
  const shuttle = inTransferFlight(world, m) ? 0.9 : 0.1;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  return {
    streaming: avgSite,
    batch: BATCH(m / 60) * (0.6 + 0.4 * avgSite),
    transfer: clamp01(shuttle * 0.5 + domainAvg * 0.5),
    transform: clamp01(((hubActivity(world, abs) + domainAvg) / 2) * 1.2),
    ml: mlLevel(world, abs),
    serving,
    build: clamp01(deployRate(world, abs) * (world.profile.deploysPerHour / 1.5)),
  };
}

function counts(world: World, abs: number, openIncidents: number): Snapshot['counts'] {
  const m = minuteOfDay(abs);
  const { spokes } = world.topology;
  const total = spokes.reduce((acc, s) => acc + s.metrics.pipelines, 0);
  const running = spokes.reduce(
    (acc, s) => acc + s.metrics.pipelines * (0.15 + 0.6 * spokeCurveActivity(world, s.id, abs)),
    0,
  );
  const drift = activeAt(world, abs).some((a) => a.entry.kind === 'schema-drift') ? 3 : 0;
  return {
    runningPipelines: Math.round(running),
    failedRuns: Math.round(total * world.profile.failureRate * (1 + m / MINUTES_PER_DAY) + drift),
    spokesPastTarget: spokes.filter((s) => isPastTarget(world, s.id, abs)).length,
    deploysToday: Math.floor(world.profile.deploysPerHour * (m / 60) * 0.8),
    products: spokes.reduce((acc, s) => acc + s.metrics.products, 0),
    openIncidents,
  };
}

function spendPerHour(world: World, abs: number): number {
  const spend = world.topology.spokes.reduce(
    (acc, s) => acc + s.metrics.pipelines * (0.2 + 0.8 * spokeCurveActivity(world, s.id, abs)),
    0,
  );
  return Math.round(spend * 0.9);
}

/** The full state of one environment at an absolute minute. Pure: same inputs, same output. */
export function snapshotAt(world: World, at: Date): Snapshot {
  const abs = at.getTime() / MS_PER_MINUTE;
  const dayStart = Math.floor(abs / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  const alerts = activeAt(world, abs).map((a) => alertFor(world, a.entry, a.startedAt));
  const { topology } = world;
  return {
    envId: world.envId,
    at: at.toISOString(),
    hub: { activity: hubActivity(world, abs) },
    spokes: topology.spokes.map((s) => ({
      id: s.id,
      ageMinutes: ageMinutes(world, s.id, abs),
      targetMinutes: targetMinutes(world, s.id),
      pastTarget: isPastTarget(world, s.id, abs),
      activity: spokeActivity(world, s.id, abs),
    })),
    sourceGroups: topology.sourceGroups.map((g) => {
      const activity = siteActivity(world, g.id, abs);
      return { id: g.id, activity, sites: g.sites.map((site) => ({ id: site.id, activity })) };
    }),
    useCases: topology.useCases.map((u) => ({ id: u.id, ...useCaseStatus(world, u.id, abs) })),
    workloads: workloadMix(world, abs),
    counts: counts(world, abs, alerts.filter((a) => a.severity !== 'info').length),
    backlog: backlog(world, abs),
    spendPerHour: spendPerHour(world, abs),
    consumerActivity: consumerActivity(world, abs),
    previousDayClean: !world.script.some((entry) => entry.severity === 'incident'),
    alerts,
    schedule: schedule(world, dayStart),
    calendar: calendar(world, at),
  };
}
