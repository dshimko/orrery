// SPDX-License-Identifier: Apache-2.0
// Vehicles in flight. Every kind lives in a pool with a fixed cap (stability rule 7): when a
// pool is full, new vehicles are dropped and counted rather than growing memory or draw calls.

/** Instanced-mesh caps, matching the reference prototype. */
export const CAPS = {
  pod: 400,
  laser: 400,
  crate: 200,
  copy: 240,
  gold: 240,
  orb: 200,
  serve: 400,
  query: 200,
  drone: 120,
  spark: 150,
  ring: 44,
  beacon: 8,
  shuttle: 3,
} as const;

export interface Laser {
  siteId: string;
  t: number;
  speed: number;
}
export interface Pod {
  siteId: string;
  t: number;
  speed: number;
  cars: number;
}
export interface Crate {
  angle: number;
  t: number;
  reject: boolean;
  crossed: boolean;
}
export interface Copy {
  spokeId: string;
  t: number;
  speed: number;
}
export interface Gold {
  spokeId: string;
  t: number;
  speed: number;
}
export interface Orb {
  spokeId: string;
  stationId: string | null;
  t: number;
}
export interface Serve {
  stationId: string;
  spokeId: string;
  t: number;
}
export interface Query {
  cometId: string;
  t: number;
}
export interface Drone {
  spokeId: string | null;
  t: number;
}
export interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}
export interface Ring {
  active: boolean;
  x: number;
  y: number;
  z: number;
  r: number;
  max: number;
  speed: number;
  color: string;
  life: number;
}
export interface Shuttle {
  state: 'idle' | 'dock' | 'fly';
  t: number;
  wait: number;
}

export interface Pools {
  lasers: Laser[];
  pods: Pod[];
  crates: Crate[];
  copies: Copy[];
  golds: Gold[];
  orbs: Orb[];
  serves: Serve[];
  queries: Query[];
  drones: Drone[];
  sparks: Spark[];
  rings: Ring[];
  shuttles: Shuttle[];
  dropped: number;
}

export function createPools(): Pools {
  return {
    lasers: [],
    pods: [],
    crates: [],
    copies: [],
    golds: [],
    orbs: [],
    serves: [],
    queries: [],
    drones: [],
    sparks: [],
    rings: Array.from({ length: CAPS.ring }, () => ({
      active: false,
      x: 0,
      y: 0,
      z: 0,
      r: 0,
      max: 0,
      speed: 0,
      color: '#FFFFFF',
      life: 0,
    })),
    shuttles: Array.from({ length: CAPS.shuttle }, () => ({
      state: 'idle' as const,
      t: 0,
      wait: 0,
    })),
    dropped: 0,
  };
}

/** Adds an item unless the pool is at its cap. Returns false (and counts) when dropped. */
export function admit<T>(pools: Pools, list: T[], cap: number, item: T): boolean {
  if (list.length >= cap) {
    pools.dropped += 1;
    return false;
  }
  list.push(item);
  return true;
}

/** Advances `t` by speed × dts and removes finished items, calling `onArrive` for each. */
export function advance<T extends { t: number }>(
  list: T[],
  speedOf: (item: T) => number,
  dts: number,
  onArrive?: (item: T) => void,
): void {
  let write = 0;
  for (const item of list) {
    item.t += speedOf(item) * dts;
    if (item.t >= 1) {
      onArrive?.(item);
      continue;
    }
    list[write] = item;
    write += 1;
  }
  list.length = write;
}

const RING_START = 0.8;

/** Starts an expanding ring pulse from the fixed ring pool; silently skipped when all are busy. */
export function pulse(
  pools: Pools,
  at: { x: number; y: number; z: number },
  color: string,
  max: number,
  speed: number,
): void {
  const ring = pools.rings.find((r) => !r.active);
  if (!ring) return;
  Object.assign(ring, {
    active: true,
    x: at.x,
    y: at.y,
    z: at.z,
    r: RING_START,
    max,
    speed,
    color,
    life: 1,
  });
}

export function stepRings(pools: Pools, dts: number): void {
  for (const ring of pools.rings) {
    if (!ring.active) continue;
    ring.r += ring.speed * dts;
    ring.life = 1 - (ring.r - RING_START) / (ring.max - RING_START);
    if (ring.life <= 0) ring.active = false;
  }
}

export function clearPools(pools: Pools): void {
  for (const list of [
    pools.lasers,
    pools.pods,
    pools.crates,
    pools.copies,
    pools.golds,
    pools.orbs,
    pools.serves,
    pools.queries,
    pools.drones,
    pools.sparks,
  ]) {
    list.length = 0;
  }
  for (const ring of pools.rings) ring.active = false;
  for (const shuttle of pools.shuttles) Object.assign(shuttle, { state: 'idle', t: 0, wait: 0 });
}
