// SPDX-License-Identifier: Apache-2.0
// Opt-in: reads a real Marquez seeded with its sample data (`docker/up.sh --seed`). Set
// ORRERY_MARQUEZ_URL (for example http://localhost:5000) to run it; it is skipped otherwise.
// Optional: ORRERY_MARQUEZ_NAMESPACE limits the read to one job namespace.
import { FixedClock, collect, createMemoryLogger } from '@orrery/testkit';
import { describe, expect, it } from 'vitest';
import { OpenLineageAdapter } from '../src/adapter.js';
import { MarquezSource } from '../src/marquez.js';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../src/time.js';
import { makeEnv } from './helpers.js';

const url = process.env['ORRERY_MARQUEZ_URL'];
const namespace = process.env['ORRERY_MARQUEZ_NAMESPACE'];
/** Seeded events are stamped "now" and up to 10 minutes ahead, so look slightly past the clock. */
const AHEAD_MS = 30 * MS_PER_MINUTE;

/** Matches the names in Marquez's own seed data (food_delivery, public.*, etl_*). */
const SEED_TOPOLOGY = `
hub: { id: core, name: Core }
spokes:
  - id: ingest
    name: Raw tables
    role: ingest
    match: { catalog: food_delivery }
    freshness: { cadenceMinutes: 60, targetMinutes: 75 }
  - id: mart
    name: Mart
    role: domain
    match: { catalog: food_delivery, schema: 'public.*_7_days' }
    freshness: { cadenceMinutes: 60, targetMinutes: 80 }
sourceGroups:
  - id: extracts
    name: Extract jobs
    utcOffset: 0
    match: { catalog: food_delivery, schema: 'etl_*' }
useCases:
  - id: planning
    name: Planning
    match: { schema: 'orders_popular_*' }
`;

const toJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe.skipIf(!url)('a real Marquez', () => {
  const nowMs = Date.now() + AHEAD_MS;

  it('serves events the source can read', async () => {
    const source = new MarquezSource(
      { url: url as string, namespace },
      { fetch: globalThis.fetch, nowMs: () => nowMs },
    );
    await source.check();
    const loaded = await source.load({
      since: new Date(nowMs - MS_PER_DAY),
      until: new Date(nowMs),
    });
    source.dispose();
    expect(loaded.events.length).toBeGreaterThan(0);
    // Slicing the day into hours must neither lose nor repeat events at slice edges.
    const whole = new URL('/api/v1/events/lineage', url);
    whole.searchParams.set('after', new Date(nowMs - MS_PER_DAY).toISOString());
    whole.searchParams.set('before', new Date(nowMs).toISOString());
    whole.searchParams.set('limit', '1');
    const { totalCount } = (await (await fetch(whole)).json()) as { totalCount: number };
    const isUnfiltered = namespace === undefined;
    if (isUnfiltered) expect(loaded.events).toHaveLength(totalCount);
    expect(source.skipped).toBe(0);
    expect(loaded.truncated).toBe(false);
    expect(toJson(loaded)).toEqual(loaded);
  }, 60_000);

  it('builds a topology, a snapshot, and events that survive JSON', async () => {
    const options = `source: { kind: marquez, url: '${url}'${namespace ? `, namespace: ${namespace}` : ''} }`;
    const adapter = new OpenLineageAdapter();
    await adapter.init(makeEnv(options, SEED_TOPOLOGY), {
      clock: new FixedClock(new Date(nowMs)),
      logger: createMemoryLogger(),
      env: {},
    });
    try {
      const topology = await adapter.topology();
      const snapshot = await adapter.snapshot(new Date(nowMs));
      const events = await collect(adapter.events(new Date(nowMs - MS_PER_HOUR), new Date(nowMs)));
      expect(topology.spokes.length).toBeGreaterThan(0);
      expect(snapshot.envId).toBe('t');
      expect(events.length).toBeGreaterThan(0);
      expect(toJson(topology)).toEqual(topology);
      expect(toJson(snapshot)).toEqual(snapshot);
      expect(toJson(events)).toEqual(events);
      expect((await adapter.health()).status).not.toBe('error');
    } finally {
      await adapter.dispose();
    }
  }, 120_000);
});
