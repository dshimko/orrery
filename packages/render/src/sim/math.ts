// SPDX-License-Identifier: Apache-2.0
// Small allocation-light vector helpers shared by the simulation and the scene.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const TAU = Math.PI * 2;
export const ORIGIN: Readonly<Vec3> = Object.freeze({ x: 0, y: 0, z: 0 });

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const rad = (deg: number): number => (deg * Math.PI) / 180;

export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Point on the quadratic Bezier p0 → c → p1 at t. */
export function bezier(p0: Vec3, c: Vec3, p1: Vec3, t: number): Vec3 {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
    z: u * u * p0.z + 2 * u * t * c.z + t * t * p1.z,
  };
}

/** Control point above the midpoint of a and b; default lift grows with distance. */
export function arcControl(a: Vec3, b: Vec3, lift?: number): Vec3 {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + (lift ?? 0.18 * d + 3), z: (a.z + b.z) / 2 };
}

/** The point at distance r from `to`, on the line toward `from`. */
export function toward(from: Vec3, to: Vec3, r: number): Vec3 {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const dz = from.z - to.z;
  const l = Math.hypot(dx, dy, dz) || 1;
  return { x: to.x + (dx / l) * r, y: to.y + (dy / l) * r, z: to.z + (dz / l) * r };
}

/** Heading (rotation about Y) of motion from a to b. */
export const heading = (a: Vec3, b: Vec3): number => Math.atan2(-(b.z - a.z), b.x - a.x);
