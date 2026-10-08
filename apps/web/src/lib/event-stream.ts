// SPDX-License-Identifier: Apache-2.0
import type { PlatformEvent } from '@orrery/core';

export const BACKOFF_INITIAL_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;
/** The server rejects a `since` older than 15 minutes; stay a minute inside the limit. */
export const MAX_LOOKBACK_MS = 14 * 60_000;
export const PLATFORM_EVENT = 'platform';

/** The slice of the browser `EventSource` this client uses. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type EventSourceFactory = new (url: string) => EventSourceLike;

export interface EventStreamOptions {
  /** Stream URL for a `since` instant. */
  url: (since: Date) => string;
  /** First `since`, normally the current instant. */
  since: Date;
  onEvent: (event: PlatformEvent) => void;
  /** Wall clock in ms; used to clamp `since` to the server's lookback limit. */
  now?: () => number;
  /** Defaults to the global `EventSource`. */
  EventSourceCtor?: EventSourceFactory;
}

export interface EventStream {
  close(): void;
}

function parseEvent(data: unknown): PlatformEvent | null {
  if (typeof data !== 'string') return null;
  try {
    const value: unknown = JSON.parse(data);
    const isEvent =
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { ts?: unknown }).ts === 'string';
    return isEvent ? (value as PlatformEvent) : null;
  } catch {
    return null;
  }
}

/**
 * Subscribes to an environment's live event stream. On an error it closes the connection and
 * reconnects with exponential backoff (1 s up to 30 s, reset by a successful open), resuming
 * from the last event's timestamp (clamped to the server's lookback) and dropping the events
 * the server replays at that exact timestamp.
 */
export function openEventStream(options: EventStreamOptions): EventStream {
  const now = options.now ?? (() => Date.now());
  const Ctor =
    options.EventSourceCtor ?? (globalThis as { EventSource?: EventSourceFactory }).EventSource;
  if (!Ctor) throw new Error('EventSource is not available in this browser.');

  let source: EventSourceLike | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let backoff = BACKOFF_INITIAL_MS;
  let sinceMs = options.since.getTime();
  /** Serialized events already delivered at exactly `sinceMs`. */
  let delivered = new Set<string>();
  let closed = false;

  const connect = (): void => {
    const floor = now() - MAX_LOOKBACK_MS;
    if (sinceMs < floor) {
      sinceMs = floor;
      delivered = new Set();
    }
    const current = new Ctor(options.url(new Date(sinceMs)));
    source = current;
    current.onopen = () => {
      backoff = BACKOFF_INITIAL_MS;
    };
    current.addEventListener(PLATFORM_EVENT, (message) => {
      if (closed || source !== current) return;
      const event = parseEvent(message.data);
      if (!event) return;
      const ts = Date.parse(event.ts);
      if (Number.isNaN(ts)) return;
      const key = JSON.stringify(event);
      if (ts === sinceMs && delivered.has(key)) return;
      if (ts > sinceMs) {
        sinceMs = ts;
        delivered = new Set();
      }
      if (ts >= sinceMs) delivered.add(key);
      options.onEvent(event);
    });
    current.onerror = () => {
      if (closed || source !== current) return;
      current.close();
      source = null;
      timer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    };
  };

  connect();

  return {
    close() {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      source?.close();
      source = null;
    },
  };
}
