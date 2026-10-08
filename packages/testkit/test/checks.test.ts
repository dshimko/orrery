// SPDX-License-Identifier: Apache-2.0
import type { PlatformEvent, Snapshot, Topology } from '@orrery/core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkDeepEqual,
  checkEvents,
  checkHealth,
  checkJsonRoundTrip,
  checkSnapshot,
  checkTopology,
  loadExampleEnvironment,
} from '../src/index.js';
import { FakeAdapter } from './fake-adapter.js';
import { FixedClock, silentLogger } from '../src/index.js';

const AT = new Date('2026-03-10T12:00:00.000Z');
const WINDOW = { since: AT, until: new Date(AT.getTime() + 3_600_000) };
const env = loadExampleEnvironment('three-env.yaml', 'dev');

let topology: Topology;
let snapshot: Snapshot;

beforeAll(async () => {
  const adapter = new FakeAdapter();
  await adapter.init(env, { clock: new FixedClock(AT), logger: silentLogger, env: {} });
  topology = await adapter.topology();
  snapshot = await adapter.snapshot(AT);
});

const spokeId = (): string => topology.spokes[0]?.id ?? '';
const stream = (overrides: Partial<PlatformEvent> = {}): PlatformEvent =>
  ({
    envId: env.id,
    ts: '2026-03-10T12:10:00.000Z',
    type: 'ingest.gate',
    spokeId: spokeId(),
    result: 'pass',
    ...overrides,
  }) as PlatformEvent;

describe('contract checks accept valid data', () => {
  it('passes topology, snapshot, and events from a good adapter', () => {
    expect(() => checkTopology(topology, env)).not.toThrow();
    expect(() => checkSnapshot(snapshot, topology, AT)).not.toThrow();
    expect(() => checkEvents([stream()], topology, WINDOW)).not.toThrow();
  });
});

describe('contract checks reject violations', () => {
  it('rejects an event outside the window', () => {
    const late = stream({ ts: '2026-03-10T13:00:00.000Z' });
    expect(() => checkEvents([late], topology, WINDOW)).toThrow(/outside \[/);
  });

  it('rejects events that go backwards in time', () => {
    const events = [stream(), stream({ ts: '2026-03-10T12:05:00.000Z' })];
    expect(() => checkEvents(events, topology, WINDOW)).toThrow(/earlier than the previous/);
  });

  it('rejects an unknown spoke id', () => {
    const bad = stream({ spokeId: 'ghost' } as Partial<PlatformEvent>);
    expect(() => checkEvents([bad], topology, WINDOW)).toThrow(/"ghost" is not in the topology/);
  });

  it('rejects a wrong envId and an unknown event type', () => {
    expect(() => checkEvents([stream({ envId: 'prod' })], topology, WINDOW)).toThrow(/envId/);
    const odd = stream({ type: 'nope' } as unknown as Partial<PlatformEvent>);
    expect(() => checkEvents([odd], topology, WINDOW)).toThrow(/unknown event type/);
  });

  it('rejects a wrong hub id', () => {
    const bad: PlatformEvent = {
      envId: env.id,
      ts: '2026-03-10T12:10:00.000Z',
      type: 'transfer',
      fromSpokeId: spokeId(),
      hubId: 'elsewhere',
    };
    expect(() => checkEvents([bad], topology, WINDOW)).toThrow(/hubId/);
  });

  it('rejects an alert.close for an alert that was never opened', () => {
    const close: PlatformEvent = {
      envId: env.id,
      ts: '2026-03-10T12:10:00.000Z',
      type: 'alert.close',
      alertId: 'a1',
    };
    expect(() => checkEvents([close], topology, WINDOW)).toThrow(/never opened/);
    expect(() => checkEvents([close], topology, WINDOW, new Set(['a1']))).not.toThrow();
  });

  it('rejects a topology with a spoke missing from the config', () => {
    const first = topology.spokes[0];
    if (!first) throw new Error('fixture has no spokes');
    const bad = { ...topology, spokes: [{ ...first, id: 'ghost' }] };
    expect(() => checkTopology(bad, env)).toThrow(/ghost/);
  });

  it('rejects duplicate site ids and unknown metastores', () => {
    const group = topology.sourceGroups[0];
    const first = topology.spokes[0];
    if (!group || !first) throw new Error('fixture is incomplete');
    const dup = { ...topology, sourceGroups: [group, { ...group, id: 'again' }] };
    expect(() => checkTopology(dup, env)).toThrow(/site ids must be unique/);
    const orphan = {
      ...topology,
      spokes: [{ ...first, metastore: 'zzz' }, ...topology.spokes.slice(1)],
    };
    expect(() => checkTopology(orphan, env)).toThrow(/metastore/);
  });

  it('rejects out-of-range activity, bad counts, and a wrong at', () => {
    const hot = { ...snapshot, hub: { activity: 1.5 } };
    expect(() => checkSnapshot(hot, topology, AT)).toThrow(/hub.activity/);
    const fractional = { ...snapshot, counts: { ...snapshot.counts, failedRuns: 1.5 } };
    expect(() => checkSnapshot(fractional, topology, AT)).toThrow(/failedRuns/);
    expect(() => checkSnapshot(snapshot, topology, new Date(0))).toThrow(/snapshot.at/);
  });

  it('accepts valid unavailable parts and rejects bad keys and reasons', () => {
    const ok = { ...snapshot, unavailable: { spend: 'No cost data.', schedule: 'None.' } };
    expect(() => checkSnapshot(ok, topology, AT)).not.toThrow();
    const badKey = { ...snapshot, unavailable: { weather: 'Cloudy.' } } as unknown as Snapshot;
    expect(() => checkSnapshot(badKey, topology, AT)).toThrow(/unknown snapshot part "weather"/);
    const empty = { ...snapshot, unavailable: { spend: '  ' } };
    expect(() => checkSnapshot(empty, topology, AT)).toThrow(/unavailable.spend/);
    const long = { ...snapshot, unavailable: { spend: 'x'.repeat(201) } };
    expect(() => checkSnapshot(long, topology, AT)).toThrow(/at most 200/);
    const boundary = { ...snapshot, unavailable: { spend: 'x'.repeat(200) } };
    expect(() => checkSnapshot(boundary, topology, AT)).not.toThrow();
  });

  it('rejects unknown snapshot ids and non-consecutive calendar days', () => {
    const ghost = {
      ...snapshot,
      spokes: [{ ...(snapshot.spokes[0] as object), id: 'ghost' }],
    } as Snapshot;
    expect(() => checkSnapshot(ghost, topology, AT)).toThrow(/ghost/);
    const days = snapshot.calendar.days.map((d, i) => ({ ...d, day: i + 2 }));
    const skewed = { ...snapshot, calendar: { ...snapshot.calendar, days } };
    expect(() => checkSnapshot(skewed, topology, AT)).toThrow(/numbered 1..n/);
  });

  it('rejects duplicate alert ids and invalid severities', () => {
    const alert = {
      id: 'x',
      severity: 'info' as const,
      kind: 'k',
      title: 't',
      text: 't',
      openedAt: AT.toISOString(),
      targets: [],
    };
    const dup = { ...snapshot, alerts: [alert, alert] };
    expect(() => checkSnapshot(dup, topology, AT)).toThrow(/alert ids must be unique/);
    const odd = { ...snapshot, alerts: [{ ...alert, severity: 'loud' as never }] };
    expect(() => checkSnapshot(odd, topology, AT)).toThrow(/severity/);
  });

  it('rejects bad health, unequal values, and values lost in JSON', () => {
    expect(() => checkHealth({ status: 'meh' as never, checkedAt: AT.toISOString() })).toThrow(
      /status/,
    );
    expect(() => checkHealth({ status: 'ok', checkedAt: 'yesterday' })).toThrow(/checkedAt/);
    expect(() => checkDeepEqual({ a: 1 }, { a: 2 }, 'things')).toThrow(/things differ/);
    expect(() => checkJsonRoundTrip({ when: new Date(0) }, 'value')).toThrow(/JSON round trip/);
    expect(() => checkJsonRoundTrip({ n: undefined }, 'value')).toThrow(/JSON round trip/);
  });
});
