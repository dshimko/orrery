// SPDX-License-Identifier: Apache-2.0
// The eight stability rules from the spec, tested on the headless simulation layer.
import { MockAdapter } from '@orrery/adapter-mock';
import {
  Visuals,
  createTextGate,
  type PlatformEvent,
  type Snapshot,
  type Topology,
} from '@orrery/core';
import { FixedClock, collect, loadExampleEnvironment, silentLogger } from '@orrery/testkit';
import { PerspectiveCamera } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CAPS,
  CameraRig,
  applySnapshot,
  createModel,
  createPools,
  spawn,
  step,
  type SceneModel,
} from '../src/index.js';

const visuals = Visuals.parse({});
const AT = new Date('2026-10-07T10:40:00Z');
const FRAME = 1 / 60;
const VIEW = { width: 1920, height: 1080 };

let topology: Topology;
let snapshot: Snapshot;
let events: PlatformEvent[];

beforeAll(async () => {
  const adapter = new MockAdapter();
  await adapter.init(loadExampleEnvironment('demo.yaml', 'prod'), {
    clock: new FixedClock(AT),
    logger: silentLogger,
    env: {},
  });
  topology = await adapter.topology();
  snapshot = await adapter.snapshot(AT);
  events = await collect(adapter.events(AT, new Date(AT.getTime() + 30 * 60_000)));
});

const fresh = (seed = 33): SceneModel => createModel(topology, visuals, seed, snapshot);
const playing = (at = AT) => ({ at, speed: 1, paused: false });

function withAge(base: Snapshot, spokeId: string, ageMinutes: number): Snapshot {
  return { ...base, spokes: base.spokes.map((s) => (s.id === spokeId ? { ...s, ageMinutes } : s)) };
}

/** Screen positions of every body and label anchor through a fixed camera. */
function screen(model: SceneModel, rig: CameraRig): number[] {
  const camera = new PerspectiveCamera(visuals.camera.fovDeg, VIEW.width / VIEW.height, 0.5, 4000);
  camera.position.copy(rig.position());
  camera.quaternion.copy(rig.pose.rotation);
  camera.updateMatrixWorld();
  const points = [
    ...model.spokes.map((s) => s.pos),
    ...model.stations.map((s) => s.pos),
    ...model.comets.map((c) => c.pos),
    ...[...model.siteById.values()].map((s) => s.pos),
  ];
  return points.flatMap((p) => {
    const v = camera.position.clone().set(p.x, p.y, p.z).project(camera);
    return [((v.x + 1) / 2) * VIEW.width, ((1 - v.y) / 2) * VIEW.height];
  });
}

describe('stability rules', () => {
  it('1. integrates orbital angles; a radius change never makes the angle jump', () => {
    const [a, b] = [fresh(), fresh()];
    applySnapshot(b, withAge(snapshot, 'sales', 1));
    const pools = createPools();
    for (let i = 0; i < 10; i += 1) {
      step(a, pools, FRAME, playing());
      step(b, pools, FRAME, playing());
    }
    const angle = (m: SceneModel) => m.spokeById.get('sales')?.angle ?? NaN;
    expect(Math.abs(angle(a) - angle(b))).toBeLessThan(0.01);
  });

  it('2. moves radius toward its target exponentially, never straight from data', () => {
    const model = fresh();
    const before = model.spokeById.get('sales')?.orbit ?? 0;
    applySnapshot(model, withAge(snapshot, 'sales', 100_000));
    step(model, createPools(), FRAME, playing());
    const after = model.spokeById.get('sales')?.orbit ?? 0;
    const k = 1 - Math.exp(-1.2 * FRAME);
    expect(after - before).toBeCloseTo((visuals.freshnessOrbit.max - before) * k, 9);
  });

  it('3. keeps short-cadence spokes on a steady orbit across a day of snapshots', async () => {
    const adapter = new MockAdapter();
    await adapter.init(loadExampleEnvironment('demo.yaml', 'prod'), {
      clock: new FixedClock(AT),
      logger: silentLogger,
      env: {},
    });
    const ages = await Promise.all(
      [0, 3, 7, 13, 19].map(
        async (h) =>
          (await adapter.snapshot(new Date(AT.getTime() + h * 3_600_000))).spokes.find(
            (s) => s.id === 'operations',
          )?.ageMinutes,
      ),
    );
    expect(new Set(ages).size).toBe(1);
  });

  it('4. uses 3% hysteresis so past-target cannot flicker near the threshold', () => {
    const model = fresh();
    const target = model.spokeById.get('sales')?.target ?? 0;
    const flips: boolean[] = [];
    for (let i = 0; i < 100; i += 1) {
      applySnapshot(model, withAge(snapshot, 'sales', target * (i % 2 ? 1.01 : 0.99)));
      step(model, createPools(), FRAME, playing());
      flips.push(model.spokeById.get('sales')?.pastTarget ?? false);
    }
    expect(new Set(flips).size).toBe(1);
  });

  it('5. seeds randomness per environment: same seed gives the same layout and vehicles', () => {
    const [a, b, c] = [fresh(33), fresh(33), fresh(34)];
    expect(a.ringSatellites).toEqual(b.ringSatellites);
    expect(a.ringSatellites).not.toEqual(c.ringSatellites);
    const [pa, pb] = [createPools(), createPools()];
    events.forEach((e, i) => spawn(a, pa, e, i));
    events.forEach((e, i) => spawn(b, pb, e, i));
    expect(pa).toEqual(pb);
  });

  it('6. lets DOM text through at most 4 times a second and only when it changes', () => {
    const gate = createTextGate(visuals.stability.domHz);
    const accepted = Array.from({ length: 60 }, (_, i) =>
      gate('sales', `age ${i}`, i * (1000 / 60)),
    ).filter(Boolean);
    expect(accepted.length).toBeLessThanOrEqual(5);
    expect(gate('sales', 'same', 10_000)).toBe(true);
    expect(gate('sales', 'same', 20_000)).toBe(false);
  });

  it('7. caps particle pools and moves vehicles independent of frame rate', () => {
    const model = fresh();
    const pools = createPools();
    const site = topology.sourceGroups[0]?.sites[0]?.id ?? '';
    const flood = Array.from({ length: CAPS.laser + 50 }, (_, i) => ({
      type: 'source.stream' as const,
      envId: 'prod',
      ts: AT.toISOString(),
      sourceGroupId: '',
      siteId: site,
      spokeId: 'ingest',
      ...(i < 0 ? {} : {}),
    }));
    flood.forEach((e, i) => spawn(model, pools, e, i));
    expect(pools.lasers).toHaveLength(CAPS.laser);
    expect(pools.dropped).toBe(50);

    const [fine, coarse] = [createPools(), createPools()];
    const [mf, mc] = [fresh(), fresh()];
    const gold: PlatformEvent = {
      type: 'product.publish',
      envId: 'prod',
      ts: AT.toISOString(),
      spokeId: 'sales',
      hubId: 'core',
    };
    spawn(mf, fine, gold, 0);
    spawn(mc, coarse, gold, 0);
    for (let i = 0; i < 60; i += 1) step(mf, fine, FRAME, playing());
    for (let i = 0; i < 4; i += 1) step(mc, coarse, 0.25, playing());
    expect(fine.golds[0]?.t).toBeCloseTo(coarse.golds[0]?.t ?? NaN, 9);
  });

  it('8. with time paused and no input, nothing moves more than 1 px between frames', () => {
    const model = fresh();
    const pools = createPools();
    const rig = new CameraRig(visuals.camera);
    events.forEach((e, i) => spawn(model, pools, e, i));
    for (let i = 0; i < 120; i += 1) {
      step(model, pools, FRAME, playing());
      rig.step(FRAME);
    }
    for (let i = 0; i < 600; i += 1) rig.step(FRAME);
    const paused = { at: AT, speed: 1, paused: true };
    let previous = screen(model, rig);
    let worst = 0;
    for (let i = 0; i < 120; i += 1) {
      step(model, pools, FRAME, paused);
      rig.step(FRAME);
      const current = screen(model, rig);
      worst = Math.max(worst, ...current.map((v, j) => Math.abs(v - (previous[j] ?? v))));
      previous = current;
    }
    expect(worst).toBeLessThanOrEqual(1);
  });
});
