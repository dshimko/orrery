// SPDX-License-Identifier: Apache-2.0
import type { PlatformEvent } from '@orrery/core';

export const HEARTBEAT_INTERVAL_MS = 15_000;
/** Yield to the event loop after this many events so other requests and disconnects run. */
export const YIELD_EVERY_EVENTS = 200;

export interface SseOptions {
  source: AsyncIterable<PlatformEvent>;
  /** Writes a chunk; returns false when the socket buffer is full (backpressure). */
  write: (chunk: string) => boolean;
  /** Resolves when the socket can take more data. */
  drain: () => Promise<void>;
  /** Aborts when the client disconnects or the server shuts down. */
  signal: AbortSignal;
  heartbeatMs?: number;
}

export function formatSseEvent(event: PlatformEvent): string {
  return `event: platform\ndata: ${JSON.stringify(event)}\n\n`;
}

const nextTick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Pipes events to `write` as Server-Sent Events with a heartbeat comment, until the source ends
 * or `signal` aborts. It waits for `drain` when the client is slow and yields to the event loop
 * regularly, so one stream can never starve the server. The source should observe the same
 * signal (adapters receive it through `events(since, until, signal)`) so its work stops too.
 */
export async function pumpSse({
  source,
  write,
  drain,
  signal,
  heartbeatMs = HEARTBEAT_INTERVAL_MS,
}: SseOptions): Promise<void> {
  const iterator = source[Symbol.asyncIterator]();
  const aborted = new Promise<'aborted'>((resolve) => {
    if (signal.aborted) resolve('aborted');
    else signal.addEventListener('abort', () => resolve('aborted'), { once: true });
  });
  const heartbeat = setInterval(() => write(': heartbeat\n\n'), heartbeatMs);
  write(': connected\n\n');
  let sent = 0;
  try {
    while (!signal.aborted) {
      const next = await Promise.race([iterator.next(), aborted]);
      if (next === 'aborted' || next.done) break;
      const hasRoom = write(formatSseEvent(next.value));
      sent += 1;
      if (!hasRoom) {
        if ((await Promise.race([drain(), aborted])) === 'aborted') break;
      } else if (sent % YIELD_EVERY_EVENTS === 0) {
        await nextTick();
      }
    }
  } finally {
    clearInterval(heartbeat);
    // A generator parked in an await only returns once it resumes; do not block on that.
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
  }
}
