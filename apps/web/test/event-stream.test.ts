// SPDX-License-Identifier: Apache-2.0
import type { PlatformEvent } from '@orrery/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  BACKOFF_INITIAL_MS,
  BACKOFF_MAX_MS,
  type EventSourceLike,
  MAX_LOOKBACK_MS,
  openEventStream,
} from '../src/lib/event-stream.js';

const START = new Date('2026-03-04T10:00:00Z');

class FakeSource implements EventSourceLike {
  static instances: FakeSource[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();
  constructor(readonly url: string) {
    FakeSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
  fail(): void {
    this.onerror?.({});
  }
}

const event = (ts: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: 'source.stream', envId: 'prod', ts, ...extra });
const sinceOf = (source: FakeSource): string =>
  new URL(source.url, 'http://x').searchParams.get('since') ?? '';
const last = (): FakeSource => {
  const source = FakeSource.instances[FakeSource.instances.length - 1];
  if (!source) throw new Error('no connection was made');
  return source;
};

function start(nowMs: () => number = () => START.getTime()) {
  const events: PlatformEvent[] = [];
  const stream = openEventStream({
    url: (since) => `/stream?since=${encodeURIComponent(since.toISOString())}`,
    since: START,
    onEvent: (item) => events.push(item),
    now: nowMs,
    EventSourceCtor: FakeSource,
  });
  return { stream, events };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSource.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('openEventStream', () => {
  test('connects with the starting since and delivers platform events', () => {
    const { events } = start();
    expect(FakeSource.instances).toHaveLength(1);
    expect(sinceOf(last())).toBe(START.toISOString());
    last().emit('platform', event('2026-03-04T10:00:01Z'));
    expect(events).toHaveLength(1);
  });

  test('ignores malformed payloads', () => {
    const { events } = start();
    last().emit('platform', 'not json');
    last().emit('platform', '{"type":"x"}');
    last().emit('platform', undefined);
    expect(events).toEqual([]);
  });

  test('reconnects with exponential backoff, capped at 30 s', () => {
    start();
    const delays: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const before = FakeSource.instances.length;
      last().fail();
      expect(last().closed).toBe(true);
      let waited = 0;
      while (FakeSource.instances.length === before) {
        vi.advanceTimersByTime(500);
        waited += 500;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16_000, BACKOFF_MAX_MS, BACKOFF_MAX_MS]);
  });

  test('a successful open resets the backoff', () => {
    start();
    last().fail();
    vi.advanceTimersByTime(BACKOFF_INITIAL_MS);
    last().fail();
    vi.advanceTimersByTime(2000);
    last().onopen?.({});
    last().fail();
    const before = FakeSource.instances.length;
    vi.advanceTimersByTime(BACKOFF_INITIAL_MS);
    expect(FakeSource.instances).toHaveLength(before + 1);
  });

  test('resumes since from the last event and drops the replayed duplicate', () => {
    const { events } = start(() => START.getTime() + 60_000);
    const first = event('2026-03-04T10:00:30Z', { spokeId: 'a' });
    last().emit('platform', first);
    last().fail();
    vi.advanceTimersByTime(BACKOFF_INITIAL_MS);
    const resumed = last();
    expect(sinceOf(resumed)).toBe('2026-03-04T10:00:30.000Z');
    resumed.emit('platform', first);
    resumed.emit('platform', event('2026-03-04T10:00:30Z', { spokeId: 'b' }));
    resumed.emit('platform', event('2026-03-04T10:00:40Z'));
    expect(events.map((item) => item.ts)).toEqual([
      '2026-03-04T10:00:30Z',
      '2026-03-04T10:00:30Z',
      '2026-03-04T10:00:40Z',
    ]);
  });

  test('clamps since to the server lookback after a long outage', () => {
    let nowMs = START.getTime();
    start(() => nowMs);
    last().emit('platform', event('2026-03-04T10:00:05Z'));
    last().fail();
    nowMs = START.getTime() + 60 * 60_000;
    vi.advanceTimersByTime(BACKOFF_INITIAL_MS);
    expect(Date.parse(sinceOf(last()))).toBe(nowMs - MAX_LOOKBACK_MS);
  });

  test('close stops delivery and cancels a pending reconnect', () => {
    const { stream, events } = start();
    const source = last();
    source.fail();
    stream.close();
    vi.advanceTimersByTime(BACKOFF_MAX_MS * 2);
    expect(FakeSource.instances).toHaveLength(1);
    source.emit('platform', event('2026-03-04T10:00:01Z'));
    expect(events).toEqual([]);
  });

  test('close closes the open connection', () => {
    const { stream } = start();
    stream.close();
    expect(last().closed).toBe(true);
  });

  test('throws when no EventSource is available', () => {
    expect(() =>
      openEventStream({ url: () => '/x', since: START, onEvent: () => undefined }),
    ).toThrow(/EventSource/);
  });
});
