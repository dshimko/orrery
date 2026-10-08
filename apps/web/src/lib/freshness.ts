// SPDX-License-Identifier: Apache-2.0

/** Consecutive failed polls after which the data is called stale. */
export const STALE_AFTER_FAILURES = 2;

export interface FreshnessSummary {
  /** Wall-clock ms of the newest successful poll, or null before any. */
  lastOkMs: number | null;
  /** True when some source has failed `STALE_AFTER_FAILURES` polls in a row. */
  isStale: boolean;
}

export interface FreshnessTracker {
  ok(source: string, nowMs: number): void;
  fail(source: string): void;
  summary(): FreshnessSummary;
}

/** Tracks poll outcomes per data source (one per environment) for the freshness indicator. */
export function createFreshnessTracker(): FreshnessTracker {
  const sources = new Map<string, { lastOkMs: number | null; failures: number }>();
  const entry = (source: string): { lastOkMs: number | null; failures: number } =>
    sources.get(source) ?? { lastOkMs: null, failures: 0 };
  return {
    ok(source, nowMs) {
      sources.set(source, { lastOkMs: nowMs, failures: 0 });
    },
    fail(source) {
      const current = entry(source);
      sources.set(source, { ...current, failures: current.failures + 1 });
    },
    summary() {
      let lastOkMs: number | null = null;
      let isStale = false;
      for (const value of sources.values()) {
        if (value.lastOkMs !== null && (lastOkMs === null || value.lastOkMs > lastOkMs)) {
          lastOkMs = value.lastOkMs;
        }
        if (value.failures >= STALE_AFTER_FAILURES) isStale = true;
      }
      return { lastOkMs, isStale };
    },
  };
}
