// SPDX-License-Identifier: Apache-2.0
// Live event stream: polls the run timelines every 30 s, converts each poll, and yields only
// events not seen before. System tables lag by up to about an hour, so each poll re-reads a
// two-hour overlap and relies on event identity to avoid duplicates.
import type { Clock, Logger, PlatformEvent } from '@orrery/core';
import { SqlError } from './contracts.js';
import type { IdentifiedEvent } from './convert/index.js';
import { CLASS_INTERVAL_MS } from './queries.js';
import { MS_PER_DAY, MS_PER_HOUR, type TimeWindow } from './time.js';

/** Longest window `events(since, until)` accepts. */
export const EVENT_WINDOW_MAX_MS = MS_PER_DAY;
/** How far each live poll reaches back to catch rows that arrived late. */
export const LIVE_OVERLAP_MS = 2 * MS_PER_HOUR;
/** A live stream ends after this long so the client reconnects (and re-authenticates). */
export const MAX_LIVE_STREAM_MS = 15 * 60_000;
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

/** An expired or rejected token will not recover on retry: the client must reconnect. */
function isCredentialFailure(error: unknown): boolean {
  return error instanceof SqlError && (error.code === 'auth' || error.code === 'permission_denied');
}

export async function* liveEvents(options: LiveOptions): AsyncGenerator<PlatformEvent> {
  const { signal, clock, logger } = options;
  const seen = new Map<string, number>();
  let cursor = options.since.getTime();
  const startedMs = clock.now().getTime();
  while (!signal.aborted) {
    const nowMs = clock.now().getTime();
    if (nowMs - startedMs >= MAX_LIVE_STREAM_MS) return;
    const from = Math.max(
      options.since.getTime(),
      cursor - LIVE_OVERLAP_MS,
      nowMs - EVENT_WINDOW_MAX_MS,
    );
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
        if (isCredentialFailure(error)) {
          logger.warn(
            'Live poll was refused for credentials; ending the stream so the client reconnects.',
          );
          return;
        }
        logger.warn('Live poll failed; retrying on the next tick.', {
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }
    try {
      await clock.sleep(CLASS_INTERVAL_MS.timeline, signal);
    } catch (error) {
      if (signal.aborted) return;
      throw error;
    }
  }
}
