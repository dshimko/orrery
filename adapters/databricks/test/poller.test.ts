// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  SqlError,
  type AllowedQuery,
  type QuerySource,
  type Row,
  type SqlClient,
  type SqlParam,
  type Target,
  type TokenProvider,
} from '../src/contracts.js';
import { QueryPoller } from '../src/poller.js';
import { MAX_CONCURRENT_QUERIES } from '../src/queries.js';
import { target } from './support/inventory.js';
import { staticTokens } from './support/fixture-client.js';

const WINDOW = { since: new Date('2026-10-07T00:00:00Z'), until: new Date('2026-10-07T01:00:00Z') };

const queries: QuerySource = {
  names: () => ['catalogs', 'job_runs'],
  get(name: string): AllowedQuery {
    if (name !== 'catalogs' && name !== 'job_runs') throw new Error('not allowlisted');
    return { name, sql: 'SELECT 1', source: 'test' };
  },
};

interface Harness {
  poller: QueryPoller;
  calls: { query: string; params: readonly SqlParam[]; rowLimit: number; timeoutMs: number }[];
  clock: { ms: number };
  release: () => void;
  inFlight: () => number;
  peak: () => number;
}

function harness(
  options: {
    key?: () => string;
    rows?: (query: string) => Row[];
    fail?: () => SqlError | undefined;
    gate?: boolean;
  } = {},
): Harness {
  const calls: Harness['calls'] = [];
  const clock = { ms: Date.parse('2026-10-07T10:00:00Z') };
  const waiting: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  const client: SqlClient = {
    async execute(query, params, opts) {
      calls.push({ query: query.name, params, rowLimit: opts.rowLimit, timeoutMs: opts.timeoutMs });
      active += 1;
      peak = Math.max(peak, active);
      if (options.gate) await new Promise<void>((resolve) => waiting.push(resolve));
      active -= 1;
      const error = options.fail?.();
      if (error) throw error;
      return options.rows?.(query.name) ?? [{ catalog_name: 'a' }];
    },
  };
  const tokens = (): TokenProvider =>
    options.key ? { token: async () => 't', cacheKey: options.key } : staticTokens('sp');
  const poller = new QueryPoller({
    queries,
    clientFor: () => client,
    tokensFor: tokens,
    now: () => new Date(clock.ms),
  });
  return {
    poller,
    calls,
    clock,
    release: () => waiting.splice(0).forEach((resolve) => resolve()),
    inFlight: () => active,
    peak: () => peak,
  };
}

const t: Target = target();

describe('QueryPoller caching', () => {
  it('serves repeated queries from cache until the class interval passes', async () => {
    const h = harness();

    await h.poller.run(t, 'catalogs');
    await h.poller.run(t, 'catalogs');
    h.clock.ms += 59 * 60_000;
    await h.poller.run(t, 'catalogs');
    h.clock.ms += 2 * 60_000;
    await h.poller.run(t, 'catalogs');

    expect(h.calls).toHaveLength(2);
  });

  it('uses a 30 second interval for run timelines', async () => {
    const h = harness();

    await h.poller.run(t, 'job_runs', WINDOW);
    h.clock.ms += 29_000;
    await h.poller.run(t, 'job_runs', WINDOW);
    h.clock.ms += 2_000;
    await h.poller.run(t, 'job_runs', WINDOW);

    expect(h.calls).toHaveLength(2);
  });

  it('keys the cache by the viewer token key, so viewers never share results', async () => {
    let viewer = 'obo:a';
    const h = harness({ key: () => viewer });

    await h.poller.run(t, 'catalogs');
    viewer = 'obo:b';
    await h.poller.run(t, 'catalogs');
    viewer = 'obo:a';
    await h.poller.run(t, 'catalogs');

    expect(h.calls).toHaveLength(2);
    expect(h.poller.size()).toBe(2);
  });

  it('keys the cache by parameters', async () => {
    const h = harness();

    await h.poller.run(t, 'job_runs', WINDOW);
    await h.poller.run(t, 'job_runs', { ...WINDOW, until: new Date('2026-10-07T02:00:00Z') });

    expect(h.calls).toHaveLength(2);
  });

  it('shares one in-flight statement between simultaneous callers', async () => {
    const h = harness({ gate: true });

    const both = Promise.all([h.poller.run(t, 'catalogs'), h.poller.run(t, 'catalogs')]);
    await Promise.resolve();
    h.release();
    await both;

    expect(h.calls).toHaveLength(1);
  });

  it('remembers a failure briefly, then retries', async () => {
    let failing = true;
    const h = harness({ fail: () => (failing ? new SqlError('failed', 'down') : undefined) });

    await expect(h.poller.run(t, 'catalogs')).rejects.toThrow('down');
    await expect(h.poller.run(t, 'catalogs')).rejects.toThrow('down');
    expect(h.calls).toHaveLength(1);
    failing = false;
    h.clock.ms += 16_000;

    await expect(h.poller.run(t, 'catalogs')).resolves.toHaveLength(1);
    expect(h.calls).toHaveLength(2);
  });

  it('evicts old entries beyond its capacity', async () => {
    const h = harness();
    for (let i = 0; i < 300; i += 1) {
      await h.poller.run(t, 'job_runs', {
        since: WINDOW.since,
        until: new Date(WINDOW.until.getTime() + i * 1000),
      });
    }

    expect(h.poller.size()).toBeLessThanOrEqual(256);
    h.poller.clear();
    expect(h.poller.size()).toBe(0);
  });
});

describe('QueryPoller limits', () => {
  it('passes a row limit and a timeout of at most 30 seconds on every query', async () => {
    const h = harness();

    await h.poller.run(t, 'catalogs');
    await h.poller.run(t, 'job_runs', WINDOW);

    expect(h.calls.map((c) => c.rowLimit)).toEqual([5000, 50000]);
    expect(h.calls.every((c) => c.timeoutMs <= 30_000)).toBe(true);
  });

  it('sends window parameters as UTC timestamps, and none for list queries', async () => {
    const h = harness();

    await h.poller.run(t, 'job_runs', WINDOW);
    await h.poller.run(t, 'catalogs');

    expect(h.calls[0]?.params).toEqual([
      { name: 'since', value: '2026-10-07T00:00:00.000Z', type: 'TIMESTAMP' },
      { name: 'until', value: '2026-10-07T01:00:00.000Z', type: 'TIMESTAMP' },
    ]);
    expect(h.calls[1]?.params).toEqual([]);
  });

  it('refuses a windowed query without a window', () => {
    expect(() => harness().poller.run(t, 'job_runs')).toThrow('needs a since parameter');
  });

  it('caps in-flight statements per environment', async () => {
    const h = harness({ gate: true });
    const runs = Array.from({ length: 10 }, (_, i) =>
      h.poller.run(t, 'job_runs', { ...WINDOW, until: new Date(WINDOW.until.getTime() + i) }),
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(h.inFlight()).toBe(MAX_CONCURRENT_QUERIES);
    for (let i = 0; i < 10; i += 1) {
      h.release();
      await new Promise((resolve) => setImmediate(resolve));
    }
    await Promise.all(runs);

    expect(h.peak()).toBe(MAX_CONCURRENT_QUERIES);
    expect(h.calls).toHaveLength(10);
  });

  it('records queries that hit their row limit', async () => {
    const h = harness({ rows: () => Array.from({ length: 5000 }, () => ({ a: '1' })) });

    await h.poller.run(t, 'catalogs');

    expect(h.poller.truncated('sp')).toEqual(['catalogs@primary']);
  });

  it('lets a caller stop waiting without cancelling the shared statement', async () => {
    const h = harness({ gate: true });
    const controller = new AbortController();

    const waiting = h.poller.run(t, 'catalogs', undefined, controller.signal);
    controller.abort(new Error('client left'));

    await expect(waiting).rejects.toThrow('client left');
    h.release();
    await expect(h.poller.run(t, 'catalogs')).resolves.toHaveLength(1);
    expect(h.calls).toHaveLength(1);
    await expect(
      h.poller.run(t, 'catalogs', undefined, AbortSignal.abort(new Error('already gone'))),
    ).rejects.toThrow('already gone');
  });
});
