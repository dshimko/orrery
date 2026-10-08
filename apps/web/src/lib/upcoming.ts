// SPDX-License-Identifier: Apache-2.0
import type { ScheduledWindow, Snapshot } from '@orrery/core';

/** The environment fields the upcoming list needs. */
export interface UpcomingEnv {
  id: string;
  name: string;
  tier: string;
}

export const UPCOMING_HORIZON_MS = 24 * 60 * 60_000;
export const HOME_UPCOMING_LIMIT = 8;

export interface UpcomingItem {
  /** Unique across environments. */
  key: string;
  env: UpcomingEnv;
  window: ScheduledWindow;
  startMs: number;
}

export interface UpcomingOptions {
  /** Maximum rows returned; default unlimited. */
  limit?: number;
  horizonMs?: number;
}

/**
 * Planned windows that start after `now` and before `now + 24 h`, earliest first, then in the
 * order the environments are given (promotion order). Windows are compared as absolute instants,
 * so they may fall on any UTC date.
 */
export function upcomingEvents(
  entries: readonly { env: UpcomingEnv; snapshot: Pick<Snapshot, 'schedule'> | null | undefined }[],
  now: Date,
  options: UpcomingOptions = {},
): UpcomingItem[] {
  const nowMs = now.getTime();
  const untilMs = nowMs + (options.horizonMs ?? UPCOMING_HORIZON_MS);
  const items: { item: UpcomingItem; rank: number }[] = [];
  entries.forEach(({ env, snapshot }, rank) => {
    for (const window of snapshot?.schedule ?? []) {
      const startMs = Date.parse(window.start);
      if (Number.isNaN(startMs) || startMs <= nowMs || startMs >= untilMs) continue;
      items.push({ item: { key: `${env.id}:${window.id}`, env, window, startMs }, rank });
    }
  });
  items.sort(
    (a, b) =>
      a.item.startMs - b.item.startMs || a.rank - b.rank || a.item.key.localeCompare(b.item.key),
  );
  const sorted = items.map((entry) => entry.item);
  return options.limit === undefined ? sorted : sorted.slice(0, options.limit);
}
