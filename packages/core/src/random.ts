// SPDX-License-Identifier: Apache-2.0
// Seeded randomness (stability rule 5): layout and mock data never reshuffle between frames or
// reloads. Nothing in Orrery's model or renderer may call Math.random.

/** Returns a generator of floats in [0, 1). Same LCG as the reference prototypes. */
export function lcg(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Stable 32-bit hash of the given parts (FNV-1a with a final avalanche). */
export function hash32(...parts: readonly (string | number)[]): number {
  let h = FNV_OFFSET;
  for (const part of parts) {
    const text = `${typeof part}:${part}|`;
    for (let i = 0; i < text.length; i += 1) {
      h = Math.imul(h ^ text.charCodeAt(i), FNV_PRIME);
    }
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Counter-based random float in [0, 1) keyed by its parts. Unlike a stream generator the value
 * does not depend on how many numbers were drawn before, so results are stable under any split
 * of a time range.
 */
export function rand01(...parts: readonly (string | number)[]): number {
  return hash32(...parts) / 4294967296;
}
