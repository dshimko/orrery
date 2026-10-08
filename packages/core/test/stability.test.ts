// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  approach,
  approachFactor,
  createTextGate,
  decay,
  withHysteresis,
} from '../src/stability.js';

describe('approachFactor', () => {
  it('is 0 for non-positive dt and tends to 1 for large dt', () => {
    expect(approachFactor(2, 0)).toBe(0);
    expect(approachFactor(2, -1)).toBe(0);
    expect(approachFactor(2, 100)).toBeCloseTo(1, 12);
  });

  it('equals 1 - e^(-rate*dt)', () => {
    expect(approachFactor(2, 0.5)).toBeCloseTo(1 - Math.exp(-1), 12);
  });
});

describe('approach', () => {
  it('is frame-rate independent', () => {
    const one = approach(0, 10, 2, 0.4);
    const two = approach(approach(0, 10, 2, 0.2), 10, 2, 0.2);
    expect(Math.abs(one - two)).toBeLessThan(1e-12);
  });

  it('stays put when dt is 0 and never overshoots', () => {
    expect(approach(3, 10, 2, 0)).toBe(3);
    expect(approach(3, 10, 2, 1000)).toBeLessThanOrEqual(10);
    expect(approach(3, -10, 2, 1)).toBeGreaterThanOrEqual(-10);
  });
});

describe('decay', () => {
  it('decays exponentially and is frame-rate independent', () => {
    expect(decay(8, 2.8, 0.5)).toBeCloseTo(8 * Math.exp(-1.4), 12);
    const split = decay(decay(8, 2.8, 0.25), 2.8, 0.25);
    expect(Math.abs(split - decay(8, 2.8, 0.5))).toBeLessThan(1e-12);
  });

  it('returns the value unchanged for non-positive dt', () => {
    expect(decay(8, 2.8, 0)).toBe(8);
    expect(decay(8, 2.8, -1)).toBe(8);
  });
});

describe('withHysteresis', () => {
  it('turns on only above threshold*(1+band)', () => {
    expect(withHysteresis(false, 103, 100, 0.03)).toBe(false);
    expect(withHysteresis(false, 103.5, 100, 0.03)).toBe(true);
  });

  it('turns off only below threshold*(1-band)', () => {
    expect(withHysteresis(true, 97, 100, 0.03)).toBe(true);
    expect(withHysteresis(true, 96.5, 100, 0.03)).toBe(false);
  });

  it('does not flicker when the value oscillates 1% around the threshold', () => {
    for (const start of [false, true]) {
      let state = start;
      for (let i = 0; i < 20; i += 1) {
        const next = withHysteresis(state, i % 2 === 0 ? 101 : 99, 100, 0.03);
        expect(next).toBe(start);
        state = next;
      }
    }
  });
});

describe('createTextGate', () => {
  it('accepts the first text for a key', () => {
    const gate = createTextGate(4);
    expect(gate('a', 'x', 0)).toBe(true);
  });

  it('rejects unchanged text even after the interval', () => {
    const gate = createTextGate(4);
    gate('a', 'x', 0);
    expect(gate('a', 'x', 10_000)).toBe(false);
  });

  it('rate limits changed text to maxHz', () => {
    const gate = createTextGate(4);
    expect(gate('a', 'x', 0)).toBe(true);
    expect(gate('a', 'y', 100)).toBe(false);
    expect(gate('a', 'y', 250)).toBe(true);
    expect(gate('a', 'z', 400)).toBe(false);
  });

  it('tracks keys independently and separately per gate', () => {
    const gate = createTextGate(4);
    gate('a', 'x', 0);
    expect(gate('b', 'x', 10)).toBe(true);
    expect(createTextGate(4)('a', 'x', 10)).toBe(true);
  });
});
