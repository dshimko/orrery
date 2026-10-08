// SPDX-License-Identifier: Apache-2.0
// Live stream lifecycle: credential failures and the maximum lifetime end the iteration.
import { FixedClock, silentLogger } from '@orrery/testkit';
import { describe, expect, it } from 'vitest';
import type { PlatformEvent } from '@orrery/core';
import { SqlError } from '../src/contracts.js';
import { MAX_LIVE_STREAM_MS, liveEvents } from '../src/live.js';
import type { TimeWindow } from '../src/time.js';
import { FixtureWorld } from './support/fixture-client.js';
import { PROD_SCENARIOS, at, prodEnv, started } from './support/env.js';

async function drain(stream: AsyncIterable<PlatformEvent>): Promise<PlatformEvent[]> {
  const out: PlatformEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

describe('liveEvents lifecycle', () => {
  it.each(['auth', 'permission_denied'] as const)(
    'ends cleanly when a poll fails with %s so the client reconnects',
    async (code) => {
      const clock = new FixedClock(at('10:16'));
      const windows: TimeWindow[] = [];

      const events = await drain(
        liveEvents({
          since: at('10:15'),
          signal: new AbortController().signal,
          clock,
          logger: silentLogger,
          poll: (window) => {
            windows.push(window);
            return Promise.reject(new SqlError(code, 'token expired'));
          },
        }),
      );

      expect(events).toEqual([]);
      expect(windows).toHaveLength(1);
    },
  );

  it('keeps retrying after other failures', async () => {
    const clock = new FixedClock(at('10:16'));
    let polls = 0;

    await drain(
      liveEvents({
        since: at('10:15'),
        signal: new AbortController().signal,
        clock,
        logger: silentLogger,
        poll: () => {
          polls += 1;
          return Promise.reject(new SqlError('failed', 'warehouse down'));
        },
      }),
    );

    expect(polls).toBeGreaterThan(1);
  });

  it('ends after the maximum stream lifetime', async () => {
    const clock = new FixedClock(at('10:16'));
    let polls = 0;

    await drain(
      liveEvents({
        since: at('10:15'),
        signal: new AbortController().signal,
        clock,
        logger: silentLogger,
        poll: () => {
          polls += 1;
          return Promise.resolve([]);
        },
      }),
    );

    expect(clock.now().getTime() - at('10:16').getTime()).toBe(MAX_LIVE_STREAM_MS);
    expect(polls).toBe(MAX_LIVE_STREAM_MS / 30_000);
  });

  it('ends a real adapter stream when the token is rejected after discovery is cached', async () => {
    const world = new FixtureWorld(PROD_SCENARIOS);
    const adapter = await started(prodEnv(), world, at('10:16'));
    await adapter.topology();
    world.failQuery('*', 'job_runs', new SqlError('auth', 'Token expired.'));

    const events = await drain(adapter.events(at('10:15')));

    expect(events).toEqual([]);
  });
});

describe('live mode and late data', () => {
  const CROSSING_TS = new Date(at('09:00').getTime() + 21 * 1.03 * 60_000).toISOString();
  const lateRun = {
    workspace_id: '1001',
    pipeline_id: 'p-ingest-a',
    update_id: 'u-late',
    started_at: at('08:50').toISOString(),
    ended_at: at('09:00').toISOString(),
    result_state: 'COMPLETED',
    trigger_type: 'API_CALL',
    trigger_job_id: null,
  };
  const crossing = (events: PlatformEvent[]): PlatformEvent | undefined =>
    events.find((e) => e.type === 'freshness.change' && e.pastTarget && e.ts === CROSSING_TS);

  it('holds a crossing newer than the ingestion lag that a bounded replay reports', async () => {
    const world = new FixtureWorld(PROD_SCENARIOS);
    const original = world.rowsFor.bind(world);
    world.rowsFor = (metastore, query) =>
      query === 'pipeline_updates' && metastore === 'primary'
        ? [...original(metastore, query), lateRun]
        : original(metastore, query);
    // The stream runs from 10:00 to 10:15, so the lag cutoff stays at or before 09:15.
    const adapter = await started(prodEnv(), world, at('10:00'));

    const bounded = await drain(adapter.events(at('08:00'), at('10:16')));
    const live = await drain(adapter.events(at('08:00')));

    expect(crossing(bounded)).toBeDefined();
    expect(crossing(live)).toBeUndefined();
  });
});
