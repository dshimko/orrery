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
