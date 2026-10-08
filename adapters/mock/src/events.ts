// SPDX-License-Identifier: Apache-2.0
// Event generation. Time is cut into one-minute buckets; each emitter's count and timing in a
// bucket come from a counter-based random keyed by (seed, emitter, minute), so any split of a
// range yields exactly the same events (stability rule 5, contract determinism).
import { DEFAULT_EVENT_WORKLOAD, rand01, type PlatformEvent } from '@orrery/core';
import type { World } from './build.js';
import { BATCH } from './curves.js';
import { alertFor } from './snapshot.js';
import {
  activeAt,
  ageMinutes,
  deployRate,
  federationRate,
  hubActivity,
  isPastTarget,
  minuteOfDay,
  mlLevel,
  rejectProbability,
  siteActivity,
  spokeActivity,
  targetMinutes,
  useCaseStatus,
} from './state.js';

const MS_PER_MINUTE = 60_000;
/** The reference rates are per real second at 1x, where one second is 12 simulated minutes. */
const SIM_MINUTES_PER_REFERENCE_SECOND = 12;
/** An age drop larger than this between minutes is a refresh landing. */
const REFRESH_DROP_MINUTES = 1;
const FIRST_RELEASE = 100;
const RELEASE_SPAN = 900;

type Draft = {
  [K in PlatformEvent['type']]: Omit<Extract<PlatformEvent, { type: K }>, 'envId' | 'ts'>;
}[PlatformEvent['type']];

interface Timed {
  ms: number;
  order: number;
  event: PlatformEvent;
}

class Bucket {
  readonly out: Timed[] = [];
  private order = 0;

  constructor(
    private readonly world: World,
    readonly minute: number,
  ) {}

  private push(ms: number, draft: Draft): void {
    const workload = DEFAULT_EVENT_WORKLOAD[draft.type];
    const event = {
      ...draft,
      envId: this.world.envId,
      ts: new Date(ms).toISOString(),
      ...(workload ? { workload } : {}),
    } as PlatformEvent;
    this.out.push({ ms, order: this.order, event });
    this.order += 1;
  }

  /** Emits at the start of the minute. */
  at(draft: Draft): void {
    this.push(this.minute * MS_PER_MINUTE, draft);
  }

  /** Emits floor(rate + u) events (u uniform in [0,1)) spread across the minute; mean = rate. */
  rate(key: string, referenceRate: number, make: (i: number) => Draft): void {
    const perMinute = Math.max(0, referenceRate) / SIM_MINUTES_PER_REFERENCE_SECOND;
    const count = Math.floor(perMinute + rand01(this.world.profile.seed, key, this.minute));
    for (let i = 0; i < count; i += 1) {
      const offset = Math.floor(
        ((i + rand01(this.world.profile.seed, key, this.minute, i, 't')) / count) * MS_PER_MINUTE,
      );
      this.push(this.minute * MS_PER_MINUTE + offset, make(i));
    }
  }

  pick<T>(key: string, items: readonly T[], i: number): T | undefined {
    return items[Math.floor(rand01(this.world.profile.seed, key, this.minute, i) * items.length)];
  }

  chance(key: string, i: number, p: number): boolean {
    return rand01(this.world.profile.seed, key, this.minute, i) < p;
  }
}

function sources(b: Bucket, world: World): void {
  const ingest = world.ingestId;
  if (!ingest) return;
  const hour = minuteOfDay(b.minute) / 60;
  for (const group of world.topology.sourceGroups) {
    const act = siteActivity(world, group.id, b.minute);
    for (const site of group.sites) {
      const ids = { sourceGroupId: group.id, siteId: site.id, spokeId: ingest };
      b.rate(`stream:${site.id}`, act * 0.9, () => ({
        type: 'source.stream',
        tier: 'bronze',
        ...ids,
      }));
      b.rate(`batch:${site.id}`, act * 0.1 * (0.4 + 1.6 * BATCH(hour)), () => ({
        type: 'source.batch',
        tier: 'bronze',
        size: 2 + Math.round(act * 2),
        ...ids,
      }));
    }
  }
  const reject = rejectProbability(world, b.minute);
  b.rate('gate', hubActivity(world, b.minute) * 1.4, (i) => ({
    type: 'ingest.gate',
    tier: 'silver',
    spokeId: ingest,
    result: b.chance('gate-reject', i, reject) ? 'reject' : 'pass',
  }));
  if (world.transferMinutes.includes(minuteOfDay(b.minute))) {
    b.at({ type: 'transfer', tier: 'silver', fromSpokeId: ingest, hubId: world.topology.hub.id });
  }
}

function domains(b: Bucket, world: World): void {
  const hubId = world.topology.hub.id;
  for (const spoke of world.topology.spokes.filter((s) => s.role === 'domain')) {
    const act = spokeActivity(world, spoke.id, b.minute);
    b.rate(`copy:${spoke.id}`, act * 0.35, () => ({
      type: 'copy',
      tier: 'silver',
      hubId,
      spokeId: spoke.id,
    }));
    b.rate(`product:${spoke.id}`, act * 0.25, () => ({
      type: 'product.publish',
      tier: 'gold',
      hubId,
      spokeId: spoke.id,
    }));
  }
  const mlSpokes = world.topology.spokes.filter((s) => s.hasMl);
  if (mlSpokes.length > 0) {
    const fallback = mlSpokes[0]?.id ?? '';
    b.rate('ml', mlLevel(world, b.minute) * 0.5, (i) => ({
      type: 'ml.run',
      spokeId: b.pick('ml-target', mlSpokes, i)?.id ?? fallback,
    }));
  }
}

function consumers(b: Bucket, world: World): void {
  for (const useCase of world.topology.useCases) {
    const act = useCaseStatus(world, useCase.id, b.minute).activity;
    for (const spokeId of useCase.reads) {
      b.rate(`serve:${useCase.id}:${spokeId}`, act * 0.5, () => ({
        type: 'serve.read',
        tier: 'gold',
        useCaseId: useCase.id,
        spokeId,
      }));
    }
  }
  for (const catalog of world.topology.foreignCatalogs) {
    b.rate(`federation:${catalog.id}`, federationRate(world, catalog.id, b.minute), () => ({
      type: 'federation.query',
      foreignCatalogId: catalog.id,
    }));
  }
}

function releaseName(world: World, minute: number): string {
  const day = Math.floor(minute / 1440);
  return `r-${FIRST_RELEASE + (day % RELEASE_SPAN)}`;
}

function builds(b: Bucket, world: World): void {
  const spokes = world.topology.spokes;
  b.rate('deploy', deployRate(world, b.minute), (i) => {
    const spoke = b.pick('deploy-target', spokes, i);
    return {
      type: 'deploy',
      release: releaseName(world, b.minute),
      ...(spoke ? { spokeId: spoke.id } : {}),
    };
  });
}

function freshness(b: Bucket, world: World): void {
  for (const spoke of world.topology.spokes) {
    const age = ageMinutes(world, spoke.id, b.minute);
    const before = ageMinutes(world, spoke.id, b.minute - 1);
    const late = isPastTarget(world, spoke.id, b.minute);
    const wasLate = isPastTarget(world, spoke.id, b.minute - 1);
    if (before - age > REFRESH_DROP_MINUTES || late !== wasLate) {
      b.at({
        type: 'freshness.change',
        spokeId: spoke.id,
        ageMinutes: age,
        targetMinutes: targetMinutes(world, spoke.id),
        pastTarget: late,
      });
    }
  }
}

function script(b: Bucket, world: World): void {
  for (const { entry, startedAt } of activeAt(world, b.minute)) {
    if (startedAt !== b.minute) continue;
    b.at({ type: 'alert.open', alert: alertFor(world, entry, startedAt) });
    if (entry.kind === 'promotion-blocked' && world.promotesTo) {
      b.at({
        type: 'promotion',
        release: releaseName(world, b.minute),
        fromEnvId: world.envId,
        toEnvId: world.promotesTo,
        status: 'blocked',
      });
    }
  }
  for (const { entry, startedAt } of activeAt(world, b.minute - 1)) {
    if (startedAt + entry.durationMinutes !== b.minute) continue;
    b.at({ type: 'alert.close', alertId: alertFor(world, entry, startedAt).id });
    if (entry.kind === 'release' && world.promotesTo) {
      b.at({
        type: 'promotion',
        release: releaseName(world, b.minute),
        fromEnvId: world.envId,
        toEnvId: world.promotesTo,
        status: 'promoted',
      });
    }
  }
}

/** All events in one simulated minute, in timestamp order. */
export function eventsInMinute(world: World, minute: number): PlatformEvent[] {
  const bucket = new Bucket(world, minute);
  script(bucket, world);
  freshness(bucket, world);
  sources(bucket, world);
  domains(bucket, world);
  consumers(bucket, world);
  builds(bucket, world);
  return bucket.out.sort((a, b) => a.ms - b.ms || a.order - b.order).map((timed) => timed.event);
}

/** Events with since <= ts < until, generated minute by minute. */
export function* eventsBetween(world: World, since: Date, until: Date): Generator<PlatformEvent> {
  const sinceMs = since.getTime();
  const untilMs = until.getTime();
  const first = Math.floor(sinceMs / MS_PER_MINUTE);
  const last = Math.ceil(untilMs / MS_PER_MINUTE);
  for (let minute = first; minute < last; minute += 1) {
    for (const event of eventsInMinute(world, minute)) {
      const ms = Date.parse(event.ts);
      if (ms >= sinceMs && ms < untilMs) yield event;
    }
  }
}
