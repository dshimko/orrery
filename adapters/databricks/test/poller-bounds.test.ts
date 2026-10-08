// SPDX-License-Identifier: Apache-2.0
// Cache churn, memory bounds, queue waits, and priorities of the query poller.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SqlError,
  type AllowedQuery,
  type QuerySource,
  type Row,
  type SqlClient,
  type Target,
} from '../src/contracts.js';
import { QueryPoller } from '../src/poller.js';
import { MAX_CONCURRENT_QUERIES } from '../src/queries.js';
import { Degradations } from '../src/sources.js';
import { ViewerMap } from '../src/viewers.js';
import { staticTokens } from './support/fixture-client.js';
import { target } from './support/inventory.js';

const BASE = Date.parse('2026-10-07T00:00:00Z');
const win = (i: number): { since: Date; until: Date } => ({
  since: new Date(BASE),
  until: new Date(BASE + (i + 1) * 60_000),
});

const queries: QuerySource = {
  names: () => ['catalogs', 'job_runs', 'station_reads'],
  get: (name: string): AllowedQuery => ({ name, sql: 'SELECT 1', source: 'test' }),
};

interface Rig {
  poller: QueryPoller;
  clock: { ms: number };
  started: string[];
  release: () => void;
}

function rig(options: {
  rowsOf?: (target: Target, query: string) => number;
  gate?: boolean;
  queueTimeoutMs?: number;
}): Rig {
  const clock = { ms: BASE };
  const started: string[] = [];
  const waiting: (() => void)[] = [];
  const client = (forTarget: Target): SqlClient => ({
    async execute(query): Promise<Row[]> {
      started.push(query.name);
      if (options.gate) await new Promise<void>((resolve) => waiting.push(resolve));
      const count = options.rowsOf?.(forTarget, query.name) ?? 1;
      return Array.from({ length: count }, () => ({ a: '1' }));
    },
  });
  const poller = new QueryPoller({
    queries,
    clientFor: (t) => client(t),
    tokensFor: () => staticTokens('sp'),
    now: () => new Date(clock.ms),
    ...(options.queueTimeoutMs !== undefined ? { queueTimeoutMs: options.queueTimeoutMs } : {}),
  });
  return { poller, clock, started, release: () => waiting.splice(0, 1).forEach((r) => r()) };
}

const t = target();

describe('poller cache bounds', () => {
  it('sweeps expired entries on every store, not only past the entry cap', async () => {
    const r = rig({});
    for (let i = 0; i < 5; i += 1) await r.poller.run(t, 'job_runs', win(i));
    expect(r.poller.size()).toBe(5);

    r.clock.ms += 31_000;
    await r.poller.run(t, 'job_runs', win(99));

    expect(r.poller.size()).toBe(1);
  });

  it('bounds the cache by an estimated total row count, evicting the oldest first', async () => {
    const r = rig({ rowsOf: () => 40_000 });
    for (let i = 0; i < 8; i += 1) await r.poller.run(t, 'job_runs', win(i));
    await Promise.resolve();

    expect(r.poller.size()).toBeLessThanOrEqual(5);
    r.started.length = 0;
    await r.poller.run(t, 'job_runs', win(7));
    await r.poller.run(t, 'job_runs', win(0));
    expect(r.started).toEqual(['job_runs']);
  });
});

describe('poller queueing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fails a task that waits too long for a statement slot with a timeout', async () => {
    const r = rig({ gate: true, queueTimeoutMs: 1_000 });
    const busy = Array.from({ length: MAX_CONCURRENT_QUERIES }, (_, i) =>
      r.poller.run(t, 'job_runs', win(i)),
    );
    busy.forEach((p) => p.catch(() => undefined));
    const late = r.poller.run(t, 'job_runs', win(50));
    const outcome = late.then(
      () => undefined,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(1_001);

    const error = await outcome;
    expect(error).toBeInstanceOf(SqlError);
    expect((error as SqlError).code).toBe('timeout');
  });

  it('lets snapshot queries jump ahead of queued event-window queries', async () => {
    const r = rig({ gate: true });
    const all: Promise<Row[]>[] = [];
    for (let i = 0; i < MAX_CONCURRENT_QUERIES; i += 1) {
      all.push(r.poller.run(t, 'job_runs', win(i), undefined, 'events'));
    }
    all.push(r.poller.run(t, 'station_reads', win(10), undefined, 'events'));
    all.push(r.poller.run(t, 'catalogs', undefined, undefined, 'snapshot'));
    await vi.advanceTimersByTimeAsync(0);
    expect(r.started).toHaveLength(MAX_CONCURRENT_QUERIES);

    r.release();
    await vi.advanceTimersByTimeAsync(0);

    expect(r.started.at(-1)).toBe('catalogs');
    while (r.started.length < all.length) {
      r.release();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(r.started.at(-1)).toBe('station_reads');
    for (let i = 0; i < all.length; i += 1) r.release();
    await Promise.all(all);
  });
});

describe('truncation flags', () => {
  it('keys the flag by query and metastore, so one metastore cannot clear another', async () => {
    const full = target('a');
    const small = target('b');
    const r = rig({ rowsOf: (forTarget) => (forTarget.metastore === 'a' ? 5000 : 1) });

    await r.poller.run(full, 'catalogs');
    await r.poller.run(small, 'catalogs');

    expect(r.poller.truncated('sp')).toEqual(['catalogs@a']);
  });

  it("keeps flags per viewer, so one viewer's full result never flags another", async () => {
    let viewer = 'obo:alice';
    const clock = { ms: BASE };
    const poller = new QueryPoller({
      queries,
      clientFor: () => ({
        execute: async (): Promise<Row[]> =>
          Array.from({ length: viewer === 'obo:alice' ? 5000 : 1 }, () => ({ a: '1' })),
      }),
      tokensFor: () => ({ token: async () => 't', cacheKey: () => viewer }),
      now: () => new Date(clock.ms),
    });
    const t = target('a');

    await poller.run(t, 'catalogs');
    viewer = 'obo:bob';
    await poller.run(t, 'catalogs');

    expect(poller.truncated('obo:alice')).toEqual(['catalogs@a']);
    expect(poller.truncated('obo:bob')).toEqual([]);
  });
});

describe('viewer maps', () => {
  it('evicts the least recently used viewer beyond the cap', () => {
    const map = new ViewerMap<number>(2);
    map.getOrCreate('a', () => 1);
    map.getOrCreate('b', () => 2);
    map.get('a');
    map.getOrCreate('c', () => 3);

    expect(map.get('b')).toBeUndefined();
    expect(map.get('a')).toBe(1);
    expect(map.size).toBe(2);
  });

  it('bounds degradation notes by viewer', () => {
    const notes = new Degradations(2);
    notes.record('v1', 'q', 'primary', 'denied');
    notes.record('v2', 'q', 'primary', 'denied');
    notes.record('v3', 'q', 'primary', 'denied');

    expect(notes.messages('v1')).toEqual([]);
    expect(notes.messages('v3')).toHaveLength(1);
  });
});
