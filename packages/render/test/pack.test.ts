// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, it } from 'vitest';
import { CAPS, createPools, placeBodies, type Pools, type SceneModel } from '../src/index.js';
import { MATRIX_SIZE, capacityOf, putMatrix } from '../src/scene/matrix.js';
import {
  packCopies,
  packCrates,
  packDrones,
  packGolds,
  packLasers,
  packOrbs,
  packPods,
  packQueries,
  packServes,
  packSparks,
} from '../src/scene/pack.js';
import { formatAge } from '../src/scene/spokes.js';
import { popScale } from '../src/scene/hub.js';
import { freshModel, loadFixture, type Fixture } from './fixture.js';

let fixture: Fixture;
let model: SceneModel;

beforeAll(async () => {
  fixture = await loadFixture();
});

function setup(): { model: SceneModel; pools: Pools } {
  model = freshModel(fixture);
  placeBodies(model);
  return { model, pools: createPools() };
}

const buffer = (cap: number) => new Float32Array(cap * MATRIX_SIZE);
const sentinelTail = (out: Float32Array, count: number): boolean =>
  out.slice(count * MATRIX_SIZE).every((v) => v === 0);

describe('putMatrix', () => {
  it('writes translation, yaw, and scale in column-major order', () => {
    const out = buffer(2);
    putMatrix(out, 1, 1, 2, 3, Math.PI / 2, 2, 3, 4);
    const m = [...out.slice(16)];
    expect(m[12]).toBe(1);
    expect(m[13]).toBe(2);
    expect(m[14]).toBe(3);
    expect(m[5]).toBe(3);
    expect(m[2]).toBeCloseTo(-2, 6);
    expect(m[8]).toBeCloseTo(4, 6);
    expect(m[15]).toBe(1);
    expect(capacityOf(out)).toBe(2);
  });
});

describe('vehicle packing respects caps', () => {
  it('packs each pool kind and never writes past capacity', () => {
    const { model: m, pools } = setup();
    const site = [...m.siteById.values()][0];
    const spoke = m.spokes.find((s) => !s.isIngest);
    const station = m.stations[0];
    const comet = m.comets[0];
    if (!site || !spoke || !station || !comet) throw new Error('fixture lacks bodies');
    const over = 50;
    for (let i = 0; i < CAPS.laser + over; i += 1)
      pools.lasers.push({ siteId: site.id, t: 0.5, speed: 1 });
    for (let i = 0; i < CAPS.pod + over; i += 1)
      pools.pods.push({ siteId: site.id, t: 0.9, speed: 0.2, cars: 4 });
    for (let i = 0; i < CAPS.copy + over; i += 1)
      pools.copies.push({ spokeId: spoke.id, t: 0.5, speed: 0.3 });
    for (let i = 0; i < CAPS.gold + over; i += 1)
      pools.golds.push({ spokeId: spoke.id, t: 0.5, speed: 0.3 });
    for (let i = 0; i < CAPS.orb + over; i += 1)
      pools.orbs.push({ spokeId: spoke.id, stationId: station.id, t: 0.5 });
    for (let i = 0; i < CAPS.serve + over; i += 1)
      pools.serves.push({ stationId: station.id, spokeId: spoke.id, t: 0.5 });
    for (let i = 0; i < CAPS.query + over; i += 1)
      pools.queries.push({ cometId: comet.id, t: 0.5 });
    for (let i = 0; i < CAPS.drone + over; i += 1) pools.drones.push({ spokeId: spoke.id, t: 0.5 });
    for (let i = 0; i < CAPS.spark + over; i += 1)
      pools.sparks.push({ x: 1, y: 1, z: 1, vx: 0, vy: 0, vz: 0, life: 0.5 });

    const cases: [string, number, (out: Float32Array) => number][] = [
      ['laser', CAPS.laser, (o) => packLasers(m, pools, o)],
      ['pod', CAPS.pod, (o) => packPods(m, pools, o)],
      ['copy', CAPS.copy, (o) => packCopies(m, pools, o)],
      ['gold', CAPS.gold, (o) => packGolds(m, pools, o)],
      ['orb', CAPS.orb, (o) => packOrbs(m, pools, o)],
      ['serve', CAPS.serve, (o) => packServes(m, pools, o)],
      ['query', CAPS.query, (o) => packQueries(m, pools, o)],
      ['drone', CAPS.drone, (o) => packDrones(m, pools, o, 1)],
      ['spark', CAPS.spark, (o) => packSparks(pools, o)],
    ];
    for (const [name, cap, pack] of cases) {
      const out = buffer(cap + 4);
      const trimmed = out.subarray(0, cap * MATRIX_SIZE);
      const count = pack(trimmed);
      expect(count, name).toBe(cap);
      expect(sentinelTail(out, cap), name).toBe(true);
    }
  });

  it('packs nothing from empty pools', () => {
    const { model: m, pools } = setup();
    expect(packPods(m, pools, buffer(4))).toBe(0);
    expect(packSparks(pools, buffer(4))).toBe(0);
    expect(packCrates(m, pools, buffer(4), buffer(4))).toEqual({ bronze: 0, silver: 0 });
  });

  it('puts crates bronze before the gantry and silver after, within capacity', () => {
    const { model: m, pools } = setup();
    for (let i = 0; i < 10; i += 1) {
      pools.crates.push({ angle: i, t: i < 4 ? 0.2 : 0.8, reject: false, crossed: i >= 4 });
    }
    const bronze = buffer(CAPS.crate);
    const silver = buffer(CAPS.crate);
    expect(packCrates(m, pools, bronze, silver)).toEqual({ bronze: 4, silver: 6 });
    const small = buffer(2);
    expect(packCrates(m, pools, small, buffer(2))).toEqual({ bronze: 2, silver: 2 });
  });

  it('skips vehicles whose endpoints no longer exist', () => {
    const { model: m, pools } = setup();
    pools.copies.push({ spokeId: 'gone', t: 0.5, speed: 0.3 });
    pools.pods.push({ siteId: 'gone', t: 0.5, speed: 0.2, cars: 3 });
    expect(packCopies(m, pools, buffer(4))).toBe(0);
    expect(packPods(m, pools, buffer(4))).toBe(0);
  });

  it('is deterministic for identical state', () => {
    const a = setup();
    const b = setup();
    const site = [...a.model.siteById.values()][0];
    if (!site) throw new Error('no site');
    for (const s of [a, b]) s.pools.pods.push({ siteId: site.id, t: 0.6, speed: 0.2, cars: 3 });
    const outA = buffer(8);
    const outB = buffer(8);
    expect(packPods(a.model, a.pools, outA)).toBe(packPods(b.model, b.pools, outB));
    expect(outA).toEqual(outB);
  });
});

describe('small helpers', () => {
  it('pops satellites in and settles at exactly 1', () => {
    expect(popScale(1)).toBe(1);
    expect(popScale(0)).toBeCloseTo(0.3, 6);
    expect(popScale(0.999)).toBeCloseTo(1, 1);
  });

  it('formats freshness ages like the reference', () => {
    expect(formatAge(12.4)).toBe('12 min');
    expect(formatAge(192)).toBe('3.2 h');
    expect(formatAge(2880)).toBe('2.0 d');
  });
});
