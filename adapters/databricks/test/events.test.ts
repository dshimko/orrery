// SPDX-License-Identifier: Apache-2.0
import { collect, silentLogger } from '@orrery/testkit';
import { describe, expect, it } from 'vitest';
import type { Logger, PlatformEvent } from '@orrery/core';
import { SqlError } from '../src/contracts.js';
import { MAX_LIVE_STREAM_MS } from '../src/live.js';
import { FixtureWorld } from './support/fixture-client.js';
import { PROD_SCENARIOS, at, prodEnv, started } from './support/env.js';

const MIN = 60_000;

/** Drains a live stream until an event at or after `stopAt`, then stops it by breaking out. */
async function liveUntil(
  stream: AsyncIterable<PlatformEvent>,
  stopAt: Date,
): Promise<PlatformEvent[]> {
  const events: PlatformEvent[] = [];
  for await (const event of stream) {
    events.push(event);
    if (Date.parse(event.ts) >= stopAt.getTime()) break;
  }
  return events;
}

const key = (event: PlatformEvent): string => JSON.stringify(event);

describe('bounded events', () => {
  it('rejects windows longer than 24 hours and yields nothing for empty ones', async () => {
    const adapter = await started(prodEnv(), new FixtureWorld(PROD_SCENARIOS));

    await expect(
      collect(adapter.events(at('00:00'), at('00:00', '2026-10-08'))),
    ).resolves.toBeDefined();
    await expect(
      collect(adapter.events(at('00:00'), new Date(at('00:00', '2026-10-08').getTime() + 1))),
    ).rejects.toThrow('24 hours');
    await expect(collect(adapter.events(at('11:00'), at('10:00')))).resolves.toEqual([]);
  });

  it('stops promptly when the caller aborts', async () => {
    const adapter = await started(prodEnv(), new FixtureWorld(PROD_SCENARIOS));
    const controller = new AbortController();
    controller.abort();

    await expect(
      collect(adapter.events(at('10:00'), at('12:00'), controller.signal)),
    ).resolves.toEqual([]);
  });

  it('yields large windows in batches without losing events', async () => {
    const world = new FixtureWorld(PROD_SCENARIOS);
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      event_minute: new Date(at('00:00').getTime() + i * MIN).toISOString(),
      entity_type: 'NOTEBOOK',
      target_table_catalog: 'prod_sales',
      target_table_schema: 'retail_sales_silver',
    }));
    const original = world.rowsFor.bind(world);
    world.rowsFor = (metastore, query) =>
      query === 'lineage_writes' && metastore === 'primary' ? rows : original(metastore, query);
    const adapter = await started(prodEnv(), world);

    const events = await collect(adapter.events(at('00:00'), at('21:00')));

    expect(events.filter((e) => e.type === 'copy').length).toBeGreaterThanOrEqual(1200);
    expect(events.length).toBeGreaterThan(1200);
  });
});

describe('live events', () => {
  it('delivers each event once across overlapping polls', async () => {
    const adapter = await started(prodEnv(), new FixtureWorld(PROD_SCENARIOS), at('10:16'));
    const lastPoll = new Date(at('10:16').getTime() + MAX_LIVE_STREAM_MS - 30_000);
    const bounded = await collect(adapter.events(at('10:15'), lastPoll));

    const live = await collect(adapter.events(at('10:15')));

    const liveKeys = live.filter((e) => e.ts < lastPoll.toISOString()).map(key);
    expect(liveKeys.length).toBeGreaterThan(0);
    expect(new Set(liveKeys).size).toBe(liveKeys.length);
    expect(new Set(liveKeys)).toEqual(new Set(bounded.map(key)));
  });

  it('keeps going after a failed poll and says so in the log', async () => {
    const world = new FixtureWorld(PROD_SCENARIOS);
    world.failQuery('*', 'catalogs', new SqlError('failed', 'Warehouse is not reachable.'));
    const warnings: string[] = [];
    const logger: Logger = {
      ...silentLogger,
      warn: (message) => {
        warnings.push(message);
        world.clearFailures();
      },
    };
    const adapter = await started(prodEnv(), world, at('10:16'), { logger });

    const events = await liveUntil(adapter.events(at('10:15')), at('10:25'));

    expect(warnings).toEqual(['Live poll failed; retrying on the next tick.']);
    expect(events.length).toBeGreaterThan(0);
  });

  it('ends when the context or the caller aborts', async () => {
    const shutdown = new AbortController();
    const caller = new AbortController();
    const adapter = await started(prodEnv(), new FixtureWorld(PROD_SCENARIOS), at('10:16'), {
      signal: shutdown.signal,
    });
    let seen = 0;
    for await (const _event of adapter.events(at('10:15'), undefined, caller.signal)) {
      seen += 1;
      caller.abort();
    }
    for await (const _event of adapter.events(at('10:15'))) {
      seen += 1;
      shutdown.abort();
    }

    expect(seen).toBe(2);
    await expect(collect(adapter.events(at('10:15')))).resolves.toEqual([]);
  });
});
