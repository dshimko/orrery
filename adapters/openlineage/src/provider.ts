// SPDX-License-Identifier: Apache-2.0
// Holds the current Model: fixed for a file, rebuilt hourly for a remote source.
import type { Model } from './model.js';

/** A remote topology is rebuilt this often. */
export const MODEL_TTL_MS = 60 * 60_000;

export interface ModelProvider {
  get(): Promise<Model>;
}

export function fixedModel(model: Model): ModelProvider {
  return { get: async () => model };
}

/** Builds lazily, shares one in-flight build, and does not cache failures. */
export function cachedModel(
  build: () => Promise<Model>,
  nowMs: () => number,
  ttlMs: number = MODEL_TTL_MS,
): ModelProvider {
  let current: { atMs: number; value: Promise<Model> } | undefined;
  return {
    get(): Promise<Model> {
      const now = nowMs();
      if (current && now - current.atMs < ttlMs) return current.value;
      const value = build();
      const entry = { atMs: now, value };
      current = entry;
      value.catch(() => {
        if (current === entry) current = undefined;
      });
      return value;
    },
  };
}
