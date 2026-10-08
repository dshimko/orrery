// SPDX-License-Identifier: Apache-2.0
// Packs vehicle pools into instance-matrix arrays. Pure functions of the model and pools, so
// they run (and are tested) without WebGL. Each returns the instance count and never writes
// past the array's capacity (stability rule 7).
import {
  arcControl,
  bezier,
  clamp,
  heading,
  lerp,
  ORIGIN,
  toward,
  TAU,
  type Vec3,
} from '../sim/math.js';
import type { SceneModel } from '../sim/model.js';
import type { Pools } from '../sim/particles.js';
import { ingestSlot } from '../sim/step.js';
import { capacityOf, putMatrix } from './matrix.js';

const POD_LIFT = 2;
const POD_STOP = 2.4;
const POD_CAR_GAP = 0.025;
const LASER_LIFT = 4.8;
const LASER_STOP = 2.6;
const HEADING_LOOKAHEAD = 0.01;
const ARC_LOOKAHEAD = 0.02;

/** Where a source vehicle aims: just outside the ingest planet, or the hub with no ingest spoke. */
function ingestTarget(model: SceneModel, from: Vec3, offset: number): Vec3 {
  const ingest = model.ingest;
  return ingest ? toward(from, ingest.pos, ingest.radius + offset) : ORIGIN;
}

export function packPods(model: SceneModel, pools: Pools, out: Float32Array): number {
  const cap = capacityOf(out);
  let n = 0;
  for (const pod of pools.pods) {
    const site = model.siteById.get(pod.siteId);
    if (!site) continue;
    const a = { x: site.pos.x, y: site.pos.y + POD_LIFT, z: site.pos.z };
    const b = ingestTarget(model, site.pos, POD_STOP);
    const c = arcControl(a, b);
    for (let q = 0; q < pod.cars; q += 1) {
      const t = pod.t - q * POD_CAR_GAP;
      if (t < 0 || t > 1 || n >= cap) continue;
      const p = bezier(a, c, b, t);
      const ahead = bezier(a, c, b, Math.min(1, t + HEADING_LOOKAHEAD));
      putMatrix(out, n, p.x, p.y, p.z, heading(p, ahead));
      n += 1;
    }
  }
  return n;
}

export function packLasers(model: SceneModel, pools: Pools, out: Float32Array): number {
  const cap = capacityOf(out);
  let n = 0;
  for (const laser of pools.lasers) {
    const site = model.siteById.get(laser.siteId);
    if (!site || n >= cap) continue;
    const b = ingestTarget(model, site.pos, LASER_STOP);
    putMatrix(
      out,
      n,
      lerp(site.pos.x, b.x, laser.t),
      lerp(site.pos.y + LASER_LIFT, b.y, laser.t),
      lerp(site.pos.z, b.z, laser.t),
    );
    n += 1;
  }
  return n;
}

const GATE_OUTER = 2.2;
const GATE_MID = 0.9;
const GATE_EXIT = 3.6;
const CRATE_SWEEP = 0.8;
const CRATE_ARC = 1.6;

export interface CratePack {
  bronze: number;
  silver: number;
}

/** Crates ride a half-ring through the gantry: bronze before it, silver after. */
export function packCrates(
  model: SceneModel,
  pools: Pools,
  bronzeOut: Float32Array,
  silverOut: Float32Array,
): CratePack {
  const ingest = model.ingest;
  const result = { bronze: 0, silver: 0 };
  if (!ingest) return result;
  const gr = ingest.radius;
  for (const crate of pools.crates) {
    const before = crate.t < 0.5;
    const r = before
      ? lerp(gr + GATE_OUTER, gr + GATE_MID, crate.t * 2)
      : lerp(gr + GATE_MID, gr + GATE_EXIT, (crate.t - 0.5) * 2);
    const p = ingestSlot(model, crate.angle + crate.t * CRATE_SWEEP, r);
    const y = p.y + Math.sin(crate.t * Math.PI) * CRATE_ARC;
    const out = before ? bronzeOut : silverOut;
    const n = before ? result.bronze : result.silver;
    if (n >= capacityOf(out)) continue;
    putMatrix(out, n, p.x, y, p.z);
    if (before) result.bronze += 1;
    else result.silver += 1;
  }
  return result;
}

const HUB_LIFT = 1;
const COPY_ARC = 5;
const GOLD_DIP = -1;
const GOLD_ARC = -5;
const ORB_ARC = 10;
const SERVE_ARC_INGEST = 6;
const SERVE_ARC_HUB = 2.5;
const QUERY_ARC = 10;
const DRONE_ARC = 8;
const DRONE_BOB = 0.12;
const DRONE_BOB_RATE = 9;
const DRONE_SPIN_RATE = 3;

/** Writes one arc vehicle, optionally oriented along its path. Returns false when full. */
function putArc(
  out: Float32Array,
  n: number,
  a: Vec3,
  b: Vec3,
  lift: number,
  t: number,
  oriented: boolean,
): boolean {
  if (n >= capacityOf(out)) return false;
  const c = arcControl(a, b, lift);
  const p = bezier(a, c, b, t);
  const ry = oriented ? heading(p, bezier(a, c, b, Math.min(1, t + ARC_LOOKAHEAD))) : 0;
  putMatrix(out, n, p.x, p.y, p.z, ry);
  return true;
}

export function packCopies(model: SceneModel, pools: Pools, out: Float32Array): number {
  const hub = { x: 0, y: HUB_LIFT, z: 0 };
  let n = 0;
  for (const copy of pools.copies) {
    const spoke = model.spokeById.get(copy.spokeId);
    if (spoke && putArc(out, n, hub, spoke.pos, COPY_ARC, copy.t, true)) n += 1;
  }
  return n;
}

export function packGolds(model: SceneModel, pools: Pools, out: Float32Array): number {
  const hub = { x: 0, y: GOLD_DIP, z: 0 };
  let n = 0;
  for (const gold of pools.golds) {
    const spoke = model.spokeById.get(gold.spokeId);
    if (spoke && putArc(out, n, spoke.pos, hub, GOLD_ARC, gold.t, false)) n += 1;
  }
  return n;
}

export function packOrbs(model: SceneModel, pools: Pools, out: Float32Array): number {
  let n = 0;
  for (const orb of pools.orbs) {
    const spoke = model.spokeById.get(orb.spokeId);
    const station = orb.stationId ? model.stationById.get(orb.stationId) : undefined;
    if (spoke && station && putArc(out, n, spoke.pos, station.pos, ORB_ARC, orb.t, false)) n += 1;
  }
  return n;
}

export function packServes(model: SceneModel, pools: Pools, out: Float32Array): number {
  let n = 0;
  for (const serve of pools.serves) {
    const station = model.stationById.get(serve.stationId);
    if (!station) continue;
    const fromIngest = model.ingest !== null && serve.spokeId === model.ingest.id;
    const from = fromIngest && model.ingest ? model.ingest.pos : ORIGIN;
    const lift = fromIngest ? SERVE_ARC_INGEST : SERVE_ARC_HUB;
    if (putArc(out, n, from, station.pos, lift, Math.min(1, serve.t), false)) n += 1;
  }
  return n;
}

export function packQueries(model: SceneModel, pools: Pools, out: Float32Array): number {
  let n = 0;
  for (const query of pools.queries) {
    const comet = model.cometById.get(query.cometId);
    if (comet && putArc(out, n, comet.pos, ORIGIN, QUERY_ARC, query.t, false)) n += 1;
  }
  return n;
}

export function packDrones(
  model: SceneModel,
  pools: Pools,
  out: Float32Array,
  spin: number,
): number {
  const cap = capacityOf(out);
  let n = 0;
  for (const drone of pools.drones) {
    if (n >= cap) break;
    const target = (drone.spokeId ? model.spokeById.get(drone.spokeId)?.pos : undefined) ?? ORIGIN;
    const c = arcControl(model.yard, target, DRONE_ARC);
    const p = bezier(model.yard, c, target, Math.min(1, drone.t));
    putMatrix(
      out,
      n,
      p.x,
      p.y + Math.sin(spin * DRONE_BOB_RATE + n) * DRONE_BOB,
      p.z,
      (spin * DRONE_SPIN_RATE) % TAU,
    );
    n += 1;
  }
  return n;
}

export function packSparks(pools: Pools, out: Float32Array): number {
  const cap = capacityOf(out);
  let n = 0;
  for (const spark of pools.sparks) {
    if (n >= cap) break;
    putMatrix(out, n, spark.x, spark.y, spark.z, 0, clamp(spark.life, 0, 1));
    n += 1;
  }
  return n;
}
