// SPDX-License-Identifier: Apache-2.0
// Static scene layouts from seeded generators (stability rule 5): same seed, same layout.
import { lcg } from '@orrery/core';
import { TAU } from '../sim/math.js';

const STAR_SEED_OFFSET = 11;
const BELT_SEED_OFFSET = 13;
const STAR_RADIUS_MIN = 1200;
const STAR_RADIUS_SPAN = 700;
const BELT_HEIGHT = 5;

/** Star positions on a shell around the scene, as packed x, y, z floats. */
export function starPositions(seed: number, count: number): Float32Array {
  const next = lcg(seed + STAR_SEED_OFFSET);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const u = next() * 2 - 1;
    const a = next() * TAU;
    const r = STAR_RADIUS_MIN + next() * STAR_RADIUS_SPAN;
    const s = Math.sqrt(1 - u * u);
    out.set([r * s * Math.cos(a), r * u, r * s * Math.sin(a)], i * 3);
  }
  return out;
}

/** Asteroid belt points: radius +/- spread, a few units of height, packed x, y, z floats. */
export function beltPositions(
  seed: number,
  count: number,
  radius: number,
  spread: number,
): Float32Array {
  const next = lcg(seed + BELT_SEED_OFFSET);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const a = next() * TAU;
    const r = radius - spread + next() * spread * 2;
    out.set([r * Math.cos(a), (next() - 0.5) * BELT_HEIGHT, r * Math.sin(a)], i * 3);
  }
  return out;
}

export interface LandMass {
  radius: number;
  position: readonly [number, number, number];
}

const LAND_COUNT = 9;
const LAND_RADIUS_MIN = 1.4;
const LAND_RADIUS_SPAN = 0.9;
const LAND_LATITUDE_SPAN = 2.2;
const LAND_SINK = 0.8;
/** The reference hub has radius 5 and land radii are authored for it. */
const REFERENCE_HUB_RADIUS = 5;

/** Land blobs sunk into the hub surface, scaled to the configured hub radius. */
export function landMasses(seed: number, hubRadius: number): LandMass[] {
  const next = lcg(seed);
  const k = hubRadius / REFERENCE_HUB_RADIUS;
  return Array.from({ length: LAND_COUNT }, () => {
    const radius = (LAND_RADIUS_MIN + next() * LAND_RADIUS_SPAN) * k;
    const d = hubRadius - radius * LAND_SINK;
    const a = next() * TAU;
    const b = (next() - 0.5) * LAND_LATITUDE_SPAN;
    const position: [number, number, number] = [
      d * Math.cos(a) * Math.cos(b),
      d * Math.sin(b),
      d * Math.sin(a) * Math.cos(b),
    ];
    return { radius, position };
  });
}
