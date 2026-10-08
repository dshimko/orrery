// SPDX-License-Identifier: Apache-2.0

const MS_PER_SECOND = 1000;

/** Fraction of the remaining distance covered in dt seconds at the given rate. */
export function approachFactor(rate: number, dt: number): number {
  if (!(dt > 0)) return 0;
  return 1 - Math.exp(-rate * dt);
}

/** Exponential approach of current toward target; frame-rate independent. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * approachFactor(rate, dt);
}

/** Exponential decay of a value (camera inertia). */
export function decay(value: number, rate: number, dt: number): number {
  if (!(dt > 0)) return value;
  return value * Math.exp(-rate * dt);
}

/** Schmitt-trigger style threshold test with a relative dead band. */
export function withHysteresis(
  wasOver: boolean,
  value: number,
  threshold: number,
  band: number,
): boolean {
  return wasOver ? !(value < threshold * (1 - band)) : value > threshold * (1 + band);
}

/** Creates a per-key gate that passes only changed text, at most maxHz times per second per key. */
export function createTextGate(
  maxHz: number,
): (key: string, text: string, nowMs: number) => boolean {
  const minIntervalMs = MS_PER_SECOND / maxHz;
  const last = new Map<string, { text: string; atMs: number }>();
  return (key, text, nowMs) => {
    const prev = last.get(key);
    if (prev !== undefined) {
      if (prev.text === text) return false;
      if (nowMs - prev.atMs < minIntervalMs) return false;
    }
    last.set(key, { text, atMs: nowMs });
    return true;
  };
}
