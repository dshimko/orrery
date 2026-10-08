// SPDX-License-Identifier: Apache-2.0
// One simulation step. Orbital angles are integrated (rule 1); radii, sizes, and levels
// approach their targets exponentially (rule 2); past-target uses hysteresis (rule 4).
// When paused, every rate is multiplied by zero, so nothing moves (rule 8).
import {
  approach,
  orbitRadius,
  orbitSpeed,
  simMinutesPerSecond,
  withHysteresis,
  type Alert,
  type ObjectRef,
  type Snapshot,
} from '@orrery/core';
import type { TimeState, Zone } from '../types.js';
import { ORIGIN, TAU, type Vec3 } from './math.js';
import { targetSize, type SceneModel } from './model.js';
import { advance, pulse, stepRings, type Pools } from './particles.js';
import { burst } from './spawn.js';

const ORBIT_RATE = 1.2;
const SIZE_RATE = 4;
const LEVEL_RATE = 3;
const GLOW_DECAY = 0.6;
const FLASH_DECAY = 2;
const PILE_DECAY = 0.03;
const YARD_DECAY = 0.04;
const RING_POP_RATE = 1.2;
const SPARK_DECAY = 1.6;
const SHUTTLE_SPEED = 0.16;
const STATION_PERIOD_HOURS = 12;
const COMET_PERIOD_HOURS = 40;
const STATION_SLOTS = 5;

export const SPEEDS = {
  laser: (v: { speed: number }) => v.speed,
  orb: () => 0.45,
  serve: () => 0.6,
  query: () => 0.35,
  drone: () => 0.22,
  crate: () => 0.45,
} as const;

/** Copies data levels from a snapshot; the step then approaches them. */
export function applySnapshot(model: SceneModel, snapshot: Snapshot): void {
  model.snapshot = snapshot;
  for (const state of snapshot.spokes) {
    const body = model.spokeById.get(state.id);
    if (!body) continue;
    body.age = state.ageMinutes;
    body.target = state.targetMinutes;
  }
  for (const state of snapshot.useCases) {
    const station = model.stationById.get(state.id);
    if (!station) continue;
    station.status = state.status;
    station.note = state.note;
  }
}

function zoneOf(ref: ObjectRef, model: SceneModel): Zone {
  const [kind, id] = ref.split(':');
  switch (kind) {
    case 'spoke':
      return id === model.ingest?.id ? 'ingest' : 'planets';
    case 'site':
    case 'sourceGroup':
      return 'belt';
    case 'useCase':
      return 'stations';
    case 'foreign':
      return 'comets';
    case 'shipyard':
      return 'yard';
    default:
      return 'earth';
  }
}

const SEVERITY_RANK = { incident: 2, warning: 1, info: 0 } as const;

/** Zones to keep bright: the pinned zone, else the most severe open alert's targets. */
export function focusZones(model: SceneModel, alerts: readonly Alert[]): Set<Zone> | null {
  if (model.filters.pinnedZone) return new Set([model.filters.pinnedZone]);
  if (!model.filters.focusAlerts) return null;
  const top = [...alerts]
    .filter((a) => a.severity !== 'info')
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0];
  return top ? new Set(top.targets.map((t) => zoneOf(t, model))) : null;
}

/** World position of an alert target. */
export function refPosition(model: SceneModel, ref: ObjectRef): Vec3 {
  const [kind, id = ''] = ref.split(':');
  switch (kind) {
    case 'spoke':
      return model.spokeById.get(id)?.pos ?? ORIGIN;
    case 'site':
      return model.siteById.get(id)?.pos ?? ORIGIN;
    case 'sourceGroup':
      return model.groups.find((g) => g.id === id)?.pos ?? ORIGIN;
    case 'useCase':
      return model.stationById.get(id)?.pos ?? ORIGIN;
    case 'foreign':
      return model.cometById.get(id)?.pos ?? ORIGIN;
    case 'shipyard':
      return model.yard;
    default:
      return ORIGIN;
  }
}

/** Places bodies from integrated angles and simulated hours. Pure function of the model. */
export function placeBodies(model: SceneModel): void {
  for (const s of model.spokes) {
    s.pos.x = s.orbit * Math.cos(s.angle);
    s.pos.y = s.orbit * 0.05 * Math.sin(s.angle * 2 + s.phase);
    s.pos.z = s.orbit * Math.sin(s.angle);
  }
  const h = model.simHours;
  const stationR = model.visuals.world.stationOrbit;
  for (const t of model.stations) {
    if (t.fixed) {
      Object.assign(t.pos, t.fixed);
      continue;
    }
    const b = (t.phase * TAU) / STATION_SLOTS + (h * TAU) / STATION_PERIOD_HOURS;
    t.pos.x = stationR * Math.cos(b);
    t.pos.y = 1.4 * Math.sin(b * 1.5);
    t.pos.z = stationR * Math.sin(b);
  }
  const [ex, ez] = model.visuals.world.cometEllipse;
  for (const c of model.comets) {
    const b = c.phase + (h * TAU) / COMET_PERIOD_HOURS;
    c.pos.x = ex * Math.cos(b);
    c.pos.y = 14 * Math.sin(b * 2);
    c.pos.z = ez * Math.sin(b);
  }
}

function stepBodies(model: SceneModel, dt: number, simHoursDelta: number): void {
  const { snapshot, visuals } = model;
  const band = visuals.stability.hysteresis;
  const activity = new Map(snapshot.spokes.map((s) => [s.id, s.activity]));
  for (const s of model.spokes) {
    s.orbit = approach(s.orbit, orbitRadius(s.age, visuals.freshnessOrbit), ORBIT_RATE, dt);
    s.angle += simHoursDelta * orbitSpeed(s.orbit, visuals.orbitSpeed);
    s.radius = approach(s.radius, targetSize(model, s.spoke), SIZE_RATE, dt);
    s.activity = approach(s.activity, activity.get(s.id) ?? 0, LEVEL_RATE, dt);
    s.glow = Math.max(0, s.glow - GLOW_DECAY * dt);
    s.pastTarget = withHysteresis(s.pastTarget, s.age, s.target, band);
  }
  const siteLevels = new Map(
    snapshot.sourceGroups.flatMap((g) => g.sites.map((s) => [s.id, s.activity] as const)),
  );
  for (const site of model.siteById.values()) {
    site.activity = approach(site.activity, siteLevels.get(site.id) ?? 0, LEVEL_RATE, dt);
    site.pile = Math.max(0, site.pile - PILE_DECAY * dt);
  }
  const stationLevels = new Map(snapshot.useCases.map((u) => [u.id, u.activity]));
  for (const t of model.stations) {
    t.activity = approach(t.activity, stationLevels.get(t.id) ?? 0, LEVEL_RATE, dt);
    t.flash = Math.max(0, t.flash - FLASH_DECAY * dt);
  }
  for (const p of model.ringSatellites) p.pop = Math.min(1, p.pop + dt * RING_POP_RATE);
  model.yardPile = Math.max(0, model.yardPile - YARD_DECAY * dt);
}

export function ingestSlot(model: SceneModel, angle: number, r: number): Vec3 {
  const at = model.ingest?.pos ?? ORIGIN;
  return { x: at.x + r * Math.cos(angle), y: at.y, z: at.z + r * Math.sin(angle) };
}

function isHeld(model: SceneModel): boolean {
  return model.snapshot.alerts.some((a) => a.kind === 'transfer-hold');
}

function stepVehicles(model: SceneModel, pools: Pools, dt: number): void {
  const ingest = model.ingest;
  const colors = model.visuals.colors;
  advance(pools.lasers, SPEEDS.laser, dt);
  advance(
    pools.pods,
    (p) => p.speed,
    dt,
    (pod) => {
      model.yardPile = Math.min(1.4, model.yardPile + 0.06 * pod.cars);
      const site = model.siteById.get(pod.siteId);
      if (site) site.pile = Math.min(1, site.pile + 0.1);
      if (ingest) pulse(pools, ingest.pos, colors.bronze, ingest.radius + 3, 6);
    },
  );
  for (const crate of pools.crates) {
    if (!crate.crossed && crate.t + SPEEDS.crate() * dt >= 0.5) {
      crate.crossed = true;
      if (crate.reject && ingest)
        burst(model, pools, ingestSlot(model, crate.angle, ingest.radius + 1), 6, crate.angle);
    }
  }
  advance(pools.crates, SPEEDS.crate, dt);
  pools.crates.splice(
    0,
    pools.crates.length,
    ...pools.crates.filter((c) => !(c.reject && c.crossed)),
  );
  const held = isHeld(model);
  for (const s of pools.shuttles) {
    if (s.state === 'dock') {
      s.wait -= dt;
      if (s.wait <= 0 && !held) Object.assign(s, { state: 'fly', t: 0 });
    } else if (s.state === 'fly') {
      s.t += SHUTTLE_SPEED * dt;
      if (s.t >= 1) {
        s.state = 'idle';
        pulse(pools, ORIGIN, colors.silver, 9, 7);
      }
    }
  }
  advance(
    pools.copies,
    (c) => c.speed,
    dt,
    (c) => {
      const spoke = model.spokeById.get(c.spokeId);
      if (spoke) spoke.glow = 1;
    },
  );
  advance(
    pools.golds,
    (g) => g.speed,
    dt,
    (g) => {
      const satellite = model.ringSatellites.find((p) => p.spokeId === g.spokeId && p.pop >= 1);
      if (satellite) satellite.pop = 0;
      pulse(pools, ORIGIN, colors.gold, 8, 6);
    },
  );
  advance(pools.orbs, SPEEDS.orb, dt, (o) => {
    const station = o.stationId ? model.stationById.get(o.stationId) : undefined;
    if (station) station.flash = 0.7;
  });
  advance(pools.serves, SPEEDS.serve, dt, (s) => {
    const station = model.stationById.get(s.stationId);
    if (station) station.flash = 0.7;
  });
  advance(pools.queries, SPEEDS.query, dt, () => pulse(pools, ORIGIN, colors.federated, 7, 6));
  advance(pools.drones, SPEEDS.drone, dt, (d) => {
    const spoke = d.spokeId ? model.spokeById.get(d.spokeId) : undefined;
    if (!spoke) return;
    pulse(pools, spoke.pos, colors.build, 6, 6);
    spoke.glow = 1;
  });
  let write = 0;
  for (const spark of pools.sparks) {
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    spark.z += spark.vz * dt;
    spark.life -= SPARK_DECAY * dt;
    if (spark.life > 0) pools.sparks[write++] = spark;
  }
  pools.sparks.length = write;
  stepRings(pools, dt);
}

const PULSE_SECONDS = { incident: 1.2, warning: 1.2, info: 2 } as const;
const PULSE_SIZE = { incident: 10, warning: 10, info: 7 } as const;

function stepAlerts(model: SceneModel, pools: Pools, dt: number): void {
  const { alerts } = model.snapshot;
  const colors = model.visuals.colors;
  const open = new Set(alerts.map((a) => a.id));
  for (const id of [...model.alertPulse.keys()]) if (!open.has(id)) model.alertPulse.delete(id);
  for (const alert of alerts) {
    const acc = (model.alertPulse.get(alert.id) ?? 0) + dt;
    if (acc < PULSE_SECONDS[alert.severity]) {
      model.alertPulse.set(alert.id, acc);
      continue;
    }
    model.alertPulse.set(alert.id, 0);
    for (const ref of alert.targets)
      pulse(pools, refPosition(model, ref), colors[alert.severity], PULSE_SIZE[alert.severity], 6);
  }
  model.focusZones = focusZones(model, alerts);
}

/**
 * Advances the scene by `realDt` seconds of wall time at the given playback state. Simulated
 * motion scales with sqrt(speed) as in the reference, so 4x stays legible.
 */
export function step(model: SceneModel, pools: Pools, realDt: number, time: TimeState): void {
  const playing = time.paused ? 0 : 1;
  const dt = Math.max(0, realDt) * playing;
  const live = time.live === true;
  // Live: orbits follow the wall clock and vehicles keep their 1x pace whatever `speed` says.
  const dts = live ? dt : dt * Math.sqrt(time.speed);
  const simHoursDelta = playing
    ? live
      ? realDt / 3600
      : (realDt * simMinutesPerSecond(model.visuals.time, time.speed)) / 60
    : 0;
  model.simHours = time.at.getTime() / 3_600_000;
  model.animTime += dts;
  stepBodies(model, dt, simHoursDelta);
  placeBodies(model);
  stepVehicles(model, pools, dts);
  stepAlerts(model, pools, dts);
}
