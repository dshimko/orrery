// SPDX-License-Identifier: Apache-2.0
import { FixedClock, collect, createMemoryLogger } from '@orrery/testkit';
import { describe, expect, it } from 'vitest';
import { OpenLineageAdapter } from '../src/adapter.js';
import { LIVE_OVERLAP_MS, LIVE_POLL_MS } from '../src/live.js';
import { PAGE_LIMIT } from '../src/marquez.js';
import type { RunEvent } from '../src/types.js';
import { MIN, T0, context, dataset, ev, makeEnv, wire } from './helpers.js';

const clockAt = (minutes: number): FixedClock => new FixedClock(new Date(T0 + minutes * MIN));
const KEY = 'bearer-s3cr3t';
const OPTIONS = `source: { kind: marquez, url: 'https://marquez.example.org', apiKey: '\${env:MARQUEZ_KEY}' }`;

const EVENTS: RunEvent[] = [
  ev({ type: 'START', atMin: 0, run: 'a', job: 'load_a', outputs: [dataset('raw.a')] }),
  ev({ type: 'COMPLETE', atMin: 5, run: 'a', job: 'load_a' }),
  ev({
    type: 'START',
    atMin: 6,
    run: 'b',
    job: 'mart_b',
    inputs: [dataset('raw.a')],
    outputs: [dataset('mart.b')],
  }),
  ev({ type: 'COMPLETE', atMin: 9, run: 'b', job: 'mart_b' }),
  ev({
    type: 'START',
    atMin: 7,
    run: 'x',
    job: 'other_ns',
    namespace: 'elsewhere',
    outputs: [dataset('raw.x')],
  }),
  ev({ type: 'COMPLETE', atMin: 8, run: 'x', job: 'other_ns', namespace: 'elsewhere' }),
];

interface Recorded {
  after: number;
  before: number;
  authorization: string | undefined;
}

/** A Marquez that serves `events` and honors after, before, limit, and offset. */
function marquez(events: () => RunEvent[]) {
  const requests: Recorded[] = [];
  let failing = false;
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = init?.headers as Record<string, string>;
    requests.push({
      after: Date.parse(url.searchParams.get('after') ?? ''),
      before: Date.parse(url.searchParams.get('before') ?? ''),
      authorization: headers['Authorization'],
    });
    if (failing) throw new TypeError(`connect failed ${String(input)} ${headers['Authorization']}`);
    const after = Date.parse(url.searchParams.get('after') ?? '');
    const before = Date.parse(url.searchParams.get('before') ?? '');
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    const hits = events()
      .filter((e) => e.timeMs >= after && e.timeMs < before)
      .sort((a, b) => b.timeMs - a.timeMs);
    return new Response(
      JSON.stringify({
        events: hits.slice(offset, offset + limit).map(wire),
        totalCount: hits.length,
      }),
    );
  }) as typeof fetch;
  return { impl, requests, fail: (value: boolean) => (failing = value) };
}

async function start(
  server: ReturnType<typeof marquez>,
  clock: FixedClock,
  options = OPTIONS,
  logger = createMemoryLogger(),
) {
  const adapter = new OpenLineageAdapter({ fetch: server.impl });
  await adapter.init(makeEnv(options), { clock, logger, env: { MARQUEZ_KEY: KEY } });
  return adapter;
}

describe('Marquez source through the adapter', () => {
  it('discovers the topology, sends the bearer key, and reads nothing at init', async () => {
    const server = marquez(() => EVENTS);
    const adapter = await start(server, clockAt(30));
    expect(server.requests).toHaveLength(0);
    const topology = await adapter.topology();
    expect(topology.spokes.map((s) => [s.id, s.metrics.products])).toEqual([
      ['raw', 2],
      ['mart', 1],
    ]);
    expect(server.requests.every((r) => r.authorization === `Bearer ${KEY}`)).toBe(true);
    const discoveryReads = server.requests.length;
    expect(discoveryReads).toBeGreaterThan(0);
    await adapter.topology();
    expect(server.requests).toHaveLength(discoveryReads);
  });

  it('answers snapshots and event windows from the events in the window', async () => {
    const server = marquez(() => EVENTS);
    const adapter = await start(server, clockAt(30));
    const snapshot = await adapter.snapshot(new Date(T0 + 20 * MIN));
    expect(snapshot.spokes.find((s) => s.id === 'raw')).toMatchObject({ ageMinutes: 12 });
    const events = await collect(adapter.events(new Date(T0), new Date(T0 + 60 * MIN)));
    expect(events.filter((e) => e.type === 'source.batch')).toHaveLength(1);
  });

  it('keeps only the configured namespace', async () => {
    const server = marquez(() => EVENTS);
    const adapter = await start(
      server,
      clockAt(30),
      `source: { kind: marquez, url: 'https://marquez.example.org', namespace: jobs }`,
    );
    const events = await collect(adapter.events(new Date(T0), new Date(T0 + 60 * MIN)));
    expect(events.some((e) => e.type === 'source.batch' && e.spokeId === 'raw')).toBe(true);
    expect((await adapter.topology()).spokes[0]?.metrics.products).toBe(1);
  });

  it('reports health from a live read, and an error that carries neither the key nor the URL', async () => {
    const server = marquez(() => EVENTS);
    const adapter = await start(server, clockAt(30));
    expect(await adapter.health()).toMatchObject({ status: 'degraded' });
    server.fail(true);
    const health = await adapter.health();
    expect(health.status).toBe('error');
    expect(health.message).toBe('Marquez could not be reached.');
    expect(JSON.stringify(health)).not.toContain(KEY);
  });

  it('is ok when every matcher finds something', async () => {
    const server = marquez(() => EVENTS);
    const options = `source: { kind: marquez, url: 'http://localhost:5000' }`;
    const clock = clockAt(30);
    const adapter = new OpenLineageAdapter({ fetch: server.impl });
    const topology = `hub: { id: core, name: Core }
spokes:
  - id: raw
    name: Raw
    role: ingest
    match: { catalog: lake, schema: 'raw.*' }
    freshness: { cadenceMinutes: 60, targetMinutes: 90 }
sourceGroups:
  - id: loaders
    name: Loaders
    utcOffset: 0
    match: { schema: 'load_*' }`;
    await adapter.init(makeEnv(options, topology), {
      clock,
      logger: createMemoryLogger(),
      env: {},
    });
    expect(await adapter.health()).toMatchObject({
      status: 'ok',
      message: 'Reading run events from Marquez.',
    });
    expect(server.requests.every((r) => r.authorization === undefined)).toBe(true);
  });

  it('flags a truncated read in health', async () => {
    // A small page budget keeps this fast; the default (MAX_PAGES_PER_LOAD) is covered by
    // the source tests.
    const budget = 3;
    const many: RunEvent[] = Array.from({ length: budget * PAGE_LIMIT + 5 }, (_, i) =>
      ev({
        type: 'COMPLETE',
        atMin: 1 + (i % 20),
        run: `r${i}`,
        job: `load_${i}`,
        outputs: [dataset(`raw.t${i}`)],
      }),
    );
    const server = marquez(() => many);
    const adapter = new OpenLineageAdapter({ fetch: server.impl, marquezMaxPages: budget });
    await adapter.init(makeEnv(OPTIONS), {
      clock: clockAt(30),
      logger: createMemoryLogger(),
      env: { MARQUEZ_KEY: KEY },
    });
    await adapter.topology();
    const health = await adapter.health();
    expect(health.status).toBe('degraded');
    expect(health.message).toContain('older ones were left out');
  });
});

describe('Marquez live stream', () => {
  it('reads the lookback once, then only the part it has not seen', async () => {
    const server = marquez(() => EVENTS);
    const adapter = await start(server, clockAt(10));
    const live = await collect(adapter.events(new Date(T0 + 3 * MIN)));
    expect(live.length).toBeGreaterThan(0);
    const spans = server.requests.map((r) => r.before - r.after);
    // Discovery covers 7 days in slices of at most 6 hours, then the lookback in 1-hour
    // slices, then short overlapping reads.
    expect(Math.min(...server.requests.map((r) => r.after))).toBeLessThanOrEqual(
      T0 + 10 * MIN - 7 * 24 * 60 * MIN,
    );
    expect(Math.max(...spans)).toBeLessThanOrEqual(6 * 60 * MIN);
    expect(spans.length).toBeGreaterThan(5);
    for (const span of spans.slice(-3)) expect(span).toBeLessThanOrEqual(LIVE_OVERLAP_MS + 2 * MIN);
  });

  it('picks up events that arrive between polls', async () => {
    const clock = clockAt(10);
    let visible = EVENTS.slice(0, 2);
    const server = marquez(() => visible);
    const adapter = await start(server, clock);
    await adapter.topology();
    const stream = adapter.events(new Date(T0 + 5 * MIN))[Symbol.asyncIterator]();
    const types: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const next = await stream.next();
      if (next.done) break;
      types.push(next.value.type);
      if (i === 0) visible = EVENTS;
    }
    await stream.return?.(undefined);
    expect(types[0]).toBe('source.batch');
    expect(types.length).toBeGreaterThan(1);
    expect(LIVE_POLL_MS).toBe(30_000);
  });

  it('ends the stream when credentials are refused', async () => {
    const logger = createMemoryLogger();
    const refusing = (async () => new Response('no', { status: 401 })) as typeof fetch;
    const adapter = new OpenLineageAdapter({ fetch: refusing });
    const clock = clockAt(10);
    await adapter.init(makeEnv(OPTIONS), { clock, logger, env: { MARQUEZ_KEY: KEY } });
    expect(await collect(adapter.events(new Date(T0 + 9 * MIN)))).toEqual([]);
    expect(logger.entries.some((e) => e.message.includes('refused for credentials'))).toBe(true);
    expect(JSON.stringify(logger.entries)).not.toContain(KEY);
  });

  it('retries after other failures and logs them without secrets', async () => {
    const logger = createMemoryLogger();
    const server = marquez(() => EVENTS);
    server.fail(true);
    const clock = clockAt(10);
    const adapter = await start(server, clock, OPTIONS, logger);
    expect(await collect(adapter.events(new Date(T0 + 9 * MIN)))).toEqual([]);
    const warnings = logger.entries.filter((e) => e.level === 'warn');
    expect(warnings.length).toBeGreaterThan(1);
    expect(JSON.stringify(warnings)).not.toContain(KEY);
  });
});

describe('context', () => {
  it('builds a context for tests', () => {
    expect(context(T0, { A: 'b' }).env).toEqual({ A: 'b' });
  });
});
