// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { hash32, lcg, rand01 } from '../src/random.js';

describe('seeded randomness', () => {
  it('lcg matches the reference prototype sequence', () => {
    // Reference: s=(s*1664525+1013904223)>>>0; return s/4294967296, seeded with 11.
    let s = 11;
    const expected = Array.from({ length: 5 }, () => {
      s = (Number((BigInt(s) * 1664525n + 1013904223n) % 4294967296n) >>> 0) as number;
      return s / 4294967296;
    });
    const next = lcg(11);
    expect(Array.from({ length: 5 }, next)).toEqual(expected);
  });

  it('treats seed 0 as 1, like the reference', () => {
    expect(lcg(0)()).toBe(lcg(1)());
  });

  it('hash32 and rand01 are stable, distinct per key, and in range', () => {
    expect(hash32('env', 1)).toBe(hash32('env', 1));
    expect(hash32('env', 1)).not.toBe(hash32('env', 2));
    expect(hash32('1')).not.toBe(hash32(1));
    const values = Array.from({ length: 1000 }, (_, i) => rand01('k', i));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});
