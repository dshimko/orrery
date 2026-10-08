// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { beltPositions, landMasses, starPositions } from '../src/scene/layout.js';

describe('seeded layouts', () => {
  it('produces identical stars for the same seed and different stars otherwise', () => {
    const a = starPositions(7, 500);
    expect(a).toHaveLength(1500);
    expect(starPositions(7, 500)).toEqual(a);
    expect(starPositions(8, 500)).not.toEqual(a);
  });

  it('places stars on the outer shell', () => {
    const stars = starPositions(7, 200);
    for (let i = 0; i < 200; i += 1) {
      const r = Math.hypot(stars[i * 3] ?? 0, stars[i * 3 + 1] ?? 0, stars[i * 3 + 2] ?? 0);
      expect(r).toBeGreaterThanOrEqual(1199);
      expect(r).toBeLessThanOrEqual(1901);
    }
  });

  it('keeps belt points within the configured radius and spread', () => {
    const belt = beltPositions(3, 400, 128, 12);
    for (let i = 0; i < 400; i += 1) {
      const r = Math.hypot(belt[i * 3] ?? 0, belt[i * 3 + 2] ?? 0);
      expect(r).toBeGreaterThanOrEqual(115.9);
      expect(r).toBeLessThanOrEqual(140.1);
    }
    expect(beltPositions(3, 400, 128, 12)).toEqual(belt);
    expect(beltPositions(4, 400, 128, 12)).not.toEqual(belt);
  });

  it('lays out the same land masses per seed, sunk into the surface', () => {
    const lands = landMasses(5, 5);
    expect(lands).toHaveLength(9);
    expect(landMasses(5, 5)).toEqual(lands);
    expect(landMasses(6, 5)).not.toEqual(lands);
    for (const land of lands) {
      expect(Math.hypot(...land.position)).toBeLessThan(5);
    }
  });
});
