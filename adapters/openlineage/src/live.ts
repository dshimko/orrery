// SPDX-License-Identifier: Apache-2.0
// Live event stream: polls the source every 30 s, converts what is new, and yields only events
// not seen before. Each poll re-reads a short overlap because events can arrive late, and relies
// on event identity to avoid duplicates. The runs behind the stream accumulate in memory (pruned
// to the lookback) so each poll reads only the new part of the window.
import type { Clock, Logger, PlatformEvent } from '@orrery/core';
import type { IdentifiedEvent } from './convert/index.js';
import { MarquezError } from './marquez.js';
import { MS_PER_MINUTE, type TimeWindow } from './time.js';
import { MAX_LIVE_STREAM_MS } from './windows.js';

/** How often a live stream polls. */
export const LIVE_POLL_MS = 30_000;
/** How far each poll reaches back to catch events that arrived late. */
export const LIVE_OVERLAP_MS = 10 * MS_PER_MINUTE;
const MAX_SEEN = 50_000;

export interface LiveOptions {
  since: Date;
  signal: AbortSignal;
  clock: Clock;
  logger: Logger;
  poll: (window: TimeWindow) => Promise<IdentifiedEvent[]>;
}

/** Drops the oldest identities once the set outgrows its cap. */
function prune(seen: Map<string, number>): void {
  if (seen.size <= MAX_SEEN) return;
  const oldest = [...seen.entries()].sort(([, a], [, b]) => a - b);
  for (const [id] of oldest.slice(0, seen.size - MAX_SEEN)) seen.delete(id);
}

export async function* liveEvents(options: LiveOptions): AsyncGenerator<PlatformEvent> {
  const { signal, clock, logger } = options;
  const seen = new Map<string, number>();
  let cursor = options.since.getTime();
  const startedMs = clock.now().getTime();
  while (!signal.aborted) {
    const nowMs = clock.now().getTime();
    if (nowMs - startedMs >= MAX_LIVE_STREAM_MS) return;
    const from = Math.max(options.since.getTime(), cursor - LIVE_OVERLAP_MS);
    if (nowMs > from) {
      try {
        const events = await options.poll({ since: new Date(from), until: new Date(nowMs) });
        for (const item of events) {
          if (signal.aborted) return;
          if (seen.has(item.id)) continue;
          seen.set(item.id, Date.parse(item.event.ts));
          yield item.event;
        }
        prune(seen);
        cursor = nowMs;
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof MarquezError && error.code === 'auth') {
          logger.warn('Live poll was refused for credentials; ending the stream.');
          return;
        }
        logger.warn('Live poll failed; retrying on the next tick.', {
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }
    try {
      await clock.sleep(LIVE_POLL_MS, signal);
    } catch (error) {
      if (signal.aborted) return;
      throw error;
    }
  }
}
