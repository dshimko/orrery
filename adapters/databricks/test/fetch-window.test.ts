// SPDX-License-Identifier: Apache-2.0
// Event-window query bounds snap outward so polls share cache entries; results stay exact.
import { collect } from '@orrery/testkit';
import { describe, expect, it } from 'vitest';
import { CLASS_INTERVAL_MS } from '../src/queries.js';
import { fetchEventRows } from '../src/fetch.js';
import { snapOutward } from '../src/time.js';
import type { Sources } from '../src/sources.js';
import { FixtureWorld } from './support/fixture-client.js';
import { PROD_SCENARIOS, at, prodEnv, started } from './support/env.js';

const INTERVAL = CLASS_INTERVAL_MS.timeline;
const ms = (iso: string): number => Date.parse(iso);

describe('snapOutward', () => {
  it('floors since and ceils until to the interval, leaving aligned bounds alone', () => {
    const odd = snapOutward(
      {
        since: new Date(ms('2026-10-07T10:00:12.500Z')),
        until: new Date(ms('2026-10-07T10:05:01Z')),
      },
      INTERVAL,
    );
    const aligned = snapOutward(
      { since: new Date(ms('2026-10-07T10:00:30Z')), until: new Date(ms('2026-10-07T10:05:00Z')) },
      INTERVAL,
    );

    expect(odd.since.toISOString()).toBe('2026-10-07T10:00:00.000Z');
    expect(odd.until.toISOString()).toBe('2026-10-07T10:05:30.000Z');
    expect(aligned.since.toISOString()).toBe('2026-10-07T10:00:30.000Z');
    expect(aligned.until.toISOString()).toBe('2026-10-07T10:05:00.000Z');
  });
});

describe('fetchEventRows bounds', () => {
  it('asks every event query for the same snapped window across nearby callers', async () => {
    const seen: { name: string; since: string; until: string; priority?: string }[] = [];
    const sources = {
      everywhere: (
        name: string,
        window?: { since: Date; until: Date },
        _signal?: AbortSignal,
        priority?: string,
      ) => {
        seen.push({
          name,
          since: window?.since.toISOString() ?? '',
          until: window?.until.toISOString() ?? '',
          ...(priority ? { priority } : {}),
        });
        return Promise.resolve([]);
      },
    } as unknown as Sources;

    await fetchEventRows(sources, {
      since: new Date(ms('2026-10-07T10:00:07Z')),
      until: new Date(ms('2026-10-07T10:30:03Z')),
    });
    await fetchEventRows(sources, {
      since: new Date(ms('2026-10-07T10:00:19Z')),
      until: new Date(ms('2026-10-07T10:30:28Z')),
    });

    const half = seen.length / 2;
    expect(seen.slice(0, half)).toEqual(seen.slice(half));
    const writes = seen.find((s) => s.name === 'lineage_writes');
    expect(writes).toMatchObject({
      since: '2026-10-07T10:00:00.000Z',
      until: '2026-10-07T10:30:30.000Z',
      priority: 'events',
    });
  });
});

describe('bounded events over snapped queries', () => {
  it('serves nearby windows from the cache and still returns exactly the requested window', async () => {
    const world = new FixtureWorld(PROD_SCENARIOS);
    const adapter = await started(prodEnv(), world, at('12:00'));
    const exact = await collect(adapter.events(at('10:15'), at('11:05')));
    const callsAfterFirst = world.calls.filter((c) => c.query === 'job_runs').length;

    const nearby = await collect(
      adapter.events(
        new Date(at('10:15').getTime() + 7_000),
        new Date(at('11:05').getTime() - 9_000),
      ),
    );

    expect(world.calls.filter((c) => c.query === 'job_runs')).toHaveLength(callsAfterFirst);
    const from = at('10:15').getTime() + 7_000;
    const to = at('11:05').getTime() - 9_000;
    expect(nearby.every((e) => Date.parse(e.ts) >= from && Date.parse(e.ts) < to)).toBe(true);
    expect(exact.every((e) => Date.parse(e.ts) >= at('10:15').getTime())).toBe(true);
    expect(exact.every((e) => Date.parse(e.ts) < at('11:05').getTime())).toBe(true);
    expect(nearby.length).toBeGreaterThan(0);
  });
});
