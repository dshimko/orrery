// SPDX-License-Identifier: Apache-2.0
// The mock's time model: pure functions from (world, absolute minute) to activity, freshness,
// and station status. Nothing here keeps state, so any time can be evaluated in any order.
import type { Severity, Status } from '@orrery/core';
import type { ScriptEntry, World } from './build.js';
import { BATCH, ML, OFFICE, STUDIO, localHour } from './curves.js';
import { CONSUMER_UTC_OFFSET } from './world.js';

export const MINUTES_PER_DAY = 1440;
/** Cadences shorter than this display their mean data age (stability rule 3). */
export const MEAN_AGE_CADENCE_MINUTES = 30;
/** Relative band around the freshness target (stability rule 4). */
export const PAST_TARGET_BAND = 0.03;
const LOW_SCALE = 0.5;
const LOW_SCALE_DIM = 0.6;

export interface ActiveEntry {
  entry: ScriptEntry;
  /** Absolute minute this occurrence started (may be on the previous UTC day). */
  startedAt: number;
}

export interface UseCaseStatus {
  activity: number;
  status: Status;
  note: string;
}

export function minuteOfDay(absMinute: number): number {
  return ((absMinute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

const mod = (value: number, n: number): number => ((value % n) + n) % n;

/** Script entries active at an absolute minute, with the start of each occurrence. */
export function activeAt(world: World, absMinute: number): ActiveEntry[] {
  const m = minuteOfDay(absMinute);
  return world.script.flatMap((entry) => {
    const sinceStart = mod(m - entry.startMinute, MINUTES_PER_DAY);
    return sinceStart < entry.durationMinutes ? [{ entry, startedAt: absMinute - sinceStart }] : [];
  });
}

const hasKind = (active: readonly ActiveEntry[], kind: string): boolean =>
  active.some((a) => a.entry.kind === kind);

const targets = (a: ActiveEntry, ref: string): boolean => a.entry.targets.includes(ref);

export function siteActivity(world: World, groupId: string, absMinute: number): number {
  const group = world.topology.sourceGroups.find((g) => g.id === groupId);
  const shift = world.groupShifts.get(groupId);
  return group && shift ? shift(localHour(group.utcOffset, minuteOfDay(absMinute))) : 0;
}

/** Mean activity of every site. */
export function meanSiteActivity(world: World, absMinute: number): number {
  const levels = world.topology.sourceGroups.flatMap((g) =>
    g.sites.map(() => siteActivity(world, g.id, absMinute)),
  );
  return levels.length > 0 ? levels.reduce((a, b) => a + b, 0) / levels.length : 0;
}

export function hubActivity(world: World, absMinute: number): number {
  const hour = minuteOfDay(absMinute) / 60;
  return meanSiteActivity(world, absMinute) * 0.6 + BATCH(hour) * 0.4;
}

/** Raw domain curve at the main office's local time. */
export function spokeCurveActivity(world: World, spokeId: string, absMinute: number): number {
  const curve = world.spokeCurves.get(spokeId);
  return curve ? curve(localHour(CONSUMER_UTC_OFFSET, minuteOfDay(absMinute))) : 0;
}

/** Displayed spoke activity: the ingest spoke follows the hub; domains blend in hub activity. */
export function spokeActivity(world: World, spokeId: string, absMinute: number): number {
  const hub = hubActivity(world, absMinute);
  if (spokeId === world.ingestId) return hub;
  return spokeCurveActivity(world, spokeId, absMinute) * 0.8 + 0.2 * hub;
}

/** Effective freshness target: environments that age faster get a proportionally looser target. */
export function targetMinutes(world: World, spokeId: string): number {
  const spoke = world.topology.spokes.find((s) => s.id === spokeId);
  if (!spoke) return 0;
  return spoke.freshness.targetMinutes * Math.max(1, world.profile.agingFactor * 0.6);
}

/**
 * Data age in minutes. Short cadences report the mean age so orbits stay steady; longer
 * cadences show the sawtooth of aging and refresh. A transfer hold ages the spokes it targets.
 */
export function ageMinutes(world: World, spokeId: string, absMinute: number): number {
  const spoke = world.topology.spokes.find((s) => s.id === spokeId);
  if (!spoke) return 0;
  const { cadenceMinutes, targetMinutes: target, offsetMinutes } = spoke.freshness;
  const factor = world.profile.agingFactor;
  const cycle = cadenceMinutes * factor;
  const lag = Math.max(0, (target - cadenceMinutes) / 2) * factor;
  const sinceRefresh =
    cadenceMinutes < MEAN_AGE_CADENCE_MINUTES ? cycle / 2 : mod(absMinute - offsetMinutes, cycle);
  const held = activeAt(world, absMinute)
    .filter((a) => a.entry.kind === 'transfer-hold' && spoke.role === 'domain')
    .filter((a) => targets(a, `spoke:${spokeId}`))
    .reduce((sum, a) => sum + (absMinute - a.startedAt), 0);
  return lag + sinceRefresh + held;
}

/** Past target once age exceeds the target by the hysteresis band. */
export function isPastTarget(world: World, spokeId: string, absMinute: number): boolean {
  return (
    ageMinutes(world, spokeId, absMinute) > targetMinutes(world, spokeId) * (1 + PAST_TARGET_BAND)
  );
}

function dim(world: World, level: number): number {
  return world.profile.scale < LOW_SCALE ? level * LOW_SCALE_DIM : level;
}

export function mlLevel(world: World, absMinute: number): number {
  const hour = localHour(CONSUMER_UTC_OFFSET, minuteOfDay(absMinute));
  const boost = hasKind(activeAt(world, absMinute), 'predictive-maintenance') ? 1 : 0.7;
  return dim(world, ML(hour) * boost);
}

export function shipyardLevel(world: World, absMinute: number): number {
  const offset = world.topology.shipyard?.utcOffset ?? 0;
  return STUDIO(localHour(offset, minuteOfDay(absMinute)));
}

/** Deploys per simulated minute rate driver (per real second at 1x in the reference). */
export function deployRate(world: World, absMinute: number): number {
  const burst = hasKind(activeAt(world, absMinute), 'release') ? 0.6 : 0;
  return world.profile.deploysPerHour * 0.12 * shipyardLevel(world, absMinute) + burst;
}

export function rejectProbability(world: World, absMinute: number): number {
  const drift = hasKind(activeAt(world, absMinute), 'schema-drift') ? 0.45 : 0;
  return Math.min(1, world.profile.failureRate * 1.5 + drift);
}

export function federationRate(world: World, catalogId: string, absMinute: number): number {
  const busy = activeAt(world, absMinute).some(
    (a) =>
      a.entry.kind === 'federated-query' &&
      (targets(a, `foreign:${catalogId}`) ||
        !a.entry.targets.some((t) => t.startsWith('foreign:'))),
  );
  return busy ? 1.2 : 0.12;
}

const STATUS_BY_SEVERITY: Record<Severity, Status> = {
  incident: 'incident',
  warning: 'warning',
  info: 'ok',
};
const RANK: Record<Status, number> = { ok: 0, warning: 1, incident: 2 };
const INFO_BOOST = 0.9;

function baseUseCaseActivity(world: World, useCaseId: string, m: number): number {
  const useCase = world.topology.useCases.find((u) => u.id === useCaseId);
  const facts = world.useCaseFacts.get(useCaseId);
  if (facts?.atShipyard) {
    return 0.25 + STUDIO(localHour(world.topology.shipyard?.utcOffset ?? 0, m)) * 0.5;
  }
  const office = OFFICE(localHour(useCase?.utcOffset ?? CONSUMER_UTC_OFFSET, m)) * 0.8;
  return facts?.isWatcher ? 0.14 + office * 0.15 : office;
}

/** Station activity and status. Alerts targeting a station override its note and status. */
export function useCaseStatus(world: World, useCaseId: string, absMinute: number): UseCaseStatus {
  const m = minuteOfDay(absMinute);
  const useCase = world.topology.useCases.find((u) => u.id === useCaseId);
  const facts = world.useCaseFacts.get(useCaseId);
  let activity = baseUseCaseActivity(world, useCaseId, m);
  let status: Status = 'ok';
  let note = '';
  for (const { entry } of activeAt(world, absMinute)) {
    const isTargeted = entry.targets.includes(`useCase:${useCaseId}`);
    const readsBlocked =
      entry.kind === 'promotion-blocked' &&
      (useCase?.reads ?? []).some((spokeId) => entry.targets.includes(`spoke:${spokeId}`));
    if (isTargeted && entry.severity === 'info') activity = Math.max(activity, INFO_BOOST);
    const entryStatus = readsBlocked
      ? 'warning'
      : isTargeted
        ? STATUS_BY_SEVERITY[entry.severity]
        : 'ok';
    if (RANK[entryStatus] > RANK[status]) {
      status = entryStatus;
      activity = 1;
      note = readsBlocked ? 'Waiting on blocked release' : entry.title;
    }
  }
  const busyAbove = facts?.busyAbove ?? 0.6;
  const idleNote = activity > busyAbove ? (facts?.busy ?? 'Busy') : (facts?.quiet ?? 'Quiet');
  return { activity: Math.min(1, dim(world, activity)), status, note: note || idleNote };
}

/** Share of the bronze yard in use. */
export function backlog(world: World, absMinute: number): number {
  const m = minuteOfDay(absMinute);
  const level = BATCH(m / 60) * 0.65 + meanSiteActivity(world, absMinute) * 0.35 - (m % 180) / 900;
  return Math.min(1, Math.max(0, level));
}

/** Mean office activity across use cases (the Orloj lute). */
export function consumerActivity(world: World, absMinute: number): number {
  const m = minuteOfDay(absMinute);
  const useCases = world.topology.useCases;
  if (useCases.length === 0) return 0;
  const sum = useCases.reduce(
    (acc, u) => acc + OFFICE(localHour(u.utcOffset ?? CONSUMER_UTC_OFFSET, m)),
    0,
  );
  return sum / useCases.length;
}
