// SPDX-License-Identifier: Apache-2.0
// Maps platform events to vehicles. Randomness is keyed by the event, so the same events
// always produce the same vehicles (stability rule 5).
import { rand01, type PlatformEvent } from '@orrery/core';
import { TAU } from './math.js';
import type { SceneModel } from './model.js';
import { CAPS, admit, type Pools } from './particles.js';

const MAX_SHUTTLE_WAIT = 2.2;

function stationFor(model: SceneModel, spokeId: string): string | null {
  const readers = model.stations.filter((s) => s.useCase.reads.includes(spokeId));
  const atYard = readers.find((s) => s.fixed !== null);
  return (atYard ?? readers[0])?.id ?? null;
}

function spawnShuttle(pools: Pools): void {
  const idle = pools.shuttles.find((s) => s.state === 'idle');
  if (!idle) {
    pools.dropped += 1;
    return;
  }
  Object.assign(idle, { state: 'dock', t: 0, wait: MAX_SHUTTLE_WAIT });
}

/** Spawns the vehicle for one event. Events with no vehicle (alerts, freshness) are ignored. */
export function spawn(model: SceneModel, pools: Pools, event: PlatformEvent, index: number): void {
  const r = (key: string) => rand01(model.seed, event.ts, event.type, index, key);
  switch (event.type) {
    case 'source.stream':
      admit(pools, pools.lasers, CAPS.laser, {
        siteId: event.siteId,
        t: 0,
        speed: 1 + r('v') * 0.4,
      });
      return;
    case 'source.batch':
      admit(pools, pools.pods, CAPS.pod, {
        siteId: event.siteId,
        t: 0,
        speed: 0.2 + r('v') * 0.05,
        cars: event.size,
      });
      return;
    case 'ingest.gate':
      admit(pools, pools.crates, CAPS.crate, {
        angle: r('a') * TAU,
        t: 0,
        reject: event.result === 'reject',
        crossed: false,
      });
      return;
    case 'transfer':
      spawnShuttle(pools);
      return;
    case 'copy':
      admit(pools, pools.copies, CAPS.copy, {
        spokeId: event.spokeId,
        t: 0,
        speed: 0.32 + r('v') * 0.06,
      });
      return;
    case 'product.publish':
      admit(pools, pools.golds, CAPS.gold, {
        spokeId: event.spokeId,
        t: 0,
        speed: 0.3 + r('v') * 0.06,
      });
      return;
    case 'ml.run':
      admit(pools, pools.orbs, CAPS.orb, {
        spokeId: event.spokeId,
        stationId: stationFor(model, event.spokeId),
        t: 0,
      });
      return;
    case 'serve.read':
      admit(pools, pools.serves, CAPS.serve, {
        stationId: event.useCaseId,
        spokeId: event.spokeId,
        t: 0,
      });
      return;
    case 'federation.query':
      admit(pools, pools.queries, CAPS.query, { cometId: event.foreignCatalogId, t: 0 });
      return;
    case 'deploy':
      admit(pools, pools.drones, CAPS.drone, { spokeId: event.spokeId ?? null, t: 0 });
      return;
    default:
      return;
  }
}

/** Sparks for a rejected crate at the gantry, seeded by the crate's angle. */
export function burst(
  model: SceneModel,
  pools: Pools,
  at: { x: number; y: number; z: number },
  count: number,
  key: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const r = (k: string) => rand01(model.seed, 'spark', key, i, k);
    const a = r('a') * TAU;
    const speed = 2 + r('s') * 4;
    admit(pools, pools.sparks, CAPS.spark, {
      x: at.x,
      y: at.y,
      z: at.z,
      vx: Math.cos(a) * speed,
      vy: (r('y') - 0.3) * 4,
      vz: Math.sin(a) * speed,
      life: 1,
    });
  }
}
