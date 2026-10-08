// SPDX-License-Identifier: Apache-2.0
import type { PlatformEvent } from '@orrery/core';
import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/build-model.js';
import { buildEvents, buildSnapshot } from '../src/convert/index.js';
import { buildRuns } from '../src/runs.js';
import type { RunEvent } from '../src/types.js';
import { FILE_OPTIONS, MIN, T0, dataset, ev, makeEnv } from './helpers.js';

const env = makeEnv(FILE_OPTIONS);
const at = (minutes: number): Date => new Date(T0 + minutes * MIN);
const window = (from: number, to: number) => ({ since: at(from), until: at(to) });

const raw = (name: string) => dataset(`raw.${name}`);
const mart = (name: string) => dataset(`mart.${name}`);

/** A day of mixed activity covering every rule. */
const EVENTS: RunEvent[] = [
  // External source (group "ext") into the ingest spoke; 12 minutes gives three pods.
  ev({
    type: 'START',
    atMin: 0,
    run: 'a',
    job: 'import_x',
    inputs: [dataset('x', 'ext')],
    outputs: [raw('a')],
  }),
  ev({ type: 'COMPLETE', atMin: 12, run: 'a', job: 'import_x' }),
  // A job that reads nothing: the job is the source (group "loaders").
  ev({ type: 'START', atMin: 1, run: 'b', job: 'load_y', outputs: [raw('b')] }),
  ev({ type: 'COMPLETE', atMin: 3, run: 'b', job: 'load_y' }),
  // Ingest to domain: a copy. Domain from the same domain: a publish.
  ev({
    type: 'START',
    atMin: 13,
    run: 'c',
    job: 'derive',
    inputs: [raw('a')],
    outputs: [mart('c')],
  }),
  ev({ type: 'COMPLETE', atMin: 15, run: 'c', job: 'derive' }),
  ev({
    type: 'START',
    atMin: 16,
    run: 'd',
    job: 'derive_more',
    inputs: [mart('c'), raw('a')],
    outputs: [mart('d')],
  }),
  ev({ type: 'COMPLETE', atMin: 18, run: 'd', job: 'derive_more' }),
  // A sink job matched by a use case.
  ev({ type: 'START', atMin: 19, run: 'e', job: 'report_daily', inputs: [mart('d')] }),
  ev({ type: 'COMPLETE', atMin: 20, run: 'e', job: 'report_daily' }),
  // A hub dataset (unmatched, read by another job): transfer from the ingest spoke.
  ev({
    type: 'START',
    atMin: 21,
    run: 'f',
    job: 'share',
    inputs: [raw('a')],
    outputs: [dataset('shared.z')],
  }),
  ev({ type: 'COMPLETE', atMin: 22, run: 'f', job: 'share' }),
  ev({
    type: 'START',
    atMin: 23,
    run: 'g',
    job: 'use_shared',
    inputs: [dataset('shared.z')],
    outputs: [mart('q')],
  }),
  ev({ type: 'COMPLETE', atMin: 24, run: 'g', job: 'use_shared' }),
  // A streaming job: one pulse per event.
  ev({
    type: 'START',
    atMin: 30,
    run: 's',
    job: 'tail',
    streaming: true,
    inputs: [dataset('feed', 'ext')],
    outputs: [raw('s')],
  }),
  ev({ type: 'RUNNING', atMin: 35, run: 's', job: 'tail', streaming: true }),
  ev({ type: 'RUNNING', atMin: 40, run: 's', job: 'tail', streaming: true }),
  // Failures: an ingest job (incident) and a domain job (warning), each closed by a later success.
  ev({
    type: 'START',
    atMin: 60,
    run: 'f1',
    job: 'import_x',
    inputs: [dataset('x', 'ext')],
    outputs: [raw('a')],
  }),
  ev({ type: 'FAIL', atMin: 61, run: 'f1', job: 'import_x' }),
  ev({
    type: 'START',
    atMin: 62,
    run: 'f2',
    job: 'derive',
    inputs: [raw('a')],
    outputs: [mart('c')],
  }),
  ev({ type: 'ABORT', atMin: 63, run: 'f2', job: 'derive' }),
  ev({
    type: 'START',
    atMin: 120,
    run: 'ok1',
    job: 'import_x',
    inputs: [dataset('x', 'ext')],
    outputs: [raw('a')],
  }),
  ev({ type: 'COMPLETE', atMin: 121, run: 'ok1', job: 'import_x' }),
];

const model = buildModel(env, buildRuns(EVENTS));
const runs = buildRuns(EVENTS);
const all = buildEvents(model, runs, window(-60, 400)).map((item) => item.event);
const ofType = <T extends PlatformEvent['type']>(type: T): Extract<PlatformEvent, { type: T }>[] =>
  all.filter((e): e is Extract<PlatformEvent, { type: T }> => e.type === type);

describe('run classification', () => {
  it('draws a batch from the source group that matches the input dataset', () => {
    const batch = ofType('source.batch').find((e) => e.ts === at(12).toISOString());
    expect(batch).toMatchObject({ sourceGroupId: 'ext', spokeId: 'raw', size: 3, tier: 'bronze' });
  });

  it('treats a job that reads nothing as the source and matches the group on the job name', () => {
    const batch = ofType('source.batch').find((e) => e.ts === at(3).toISOString());
    expect(batch).toMatchObject({ sourceGroupId: 'loaders', spokeId: 'raw', size: 1 });
  });

  it('draws a copy for a domain write from elsewhere and a publish when it reads its own spoke', () => {
    expect(ofType('copy').map((e) => [e.ts, e.spokeId])).toContainEqual([
      at(15).toISOString(),
      'mart',
    ]);
    expect(ofType('product.publish').map((e) => [e.ts, e.spokeId])).toEqual([
      [at(18).toISOString(), 'mart'],
    ]);
  });

  it('draws serve.read for a sink job matched by a use case', () => {
    expect(ofType('serve.read')).toMatchObject([
      { ts: at(20).toISOString(), useCaseId: 'board', spokeId: 'mart', tier: 'gold' },
    ]);
  });

  it('sends a hub dataset that others read through a transfer from the ingest spoke it reads', () => {
    const transfer = ofType('transfer').find((e) => e.ts === at(22).toISOString());
    expect(transfer).toMatchObject({ fromSpokeId: 'raw', hubId: 'core' });
  });

  it('draws one source.stream per event of a streaming job', () => {
    const times = ofType('source.stream').map((e) => e.ts);
    expect(times).toEqual([at(30), at(35), at(40)].map((d) => d.toISOString()));
    expect(ofType('source.stream')[0]).toMatchObject({ sourceGroupId: 'ext', spokeId: 'raw' });
  });

  it('adds the default workload of each event type', () => {
    expect(ofType('source.batch')[0]?.workload).toBe('batch');
    expect(ofType('source.stream')[0]?.workload).toBe('streaming');
  });
});

describe('failures and alerts', () => {
  it('opens an incident for a failed ingest job and a warning for a domain job', () => {
    const opened = ofType('alert.open').map((e) => e.alert);
    expect(opened.map((a) => [a.severity, a.kind, a.targets])).toEqual([
      ['incident', 'run-failed', ['spoke:raw']],
      ['warning', 'run-aborted', ['spoke:mart']],
    ]);
  });

  it('rejects at the ingest gate when an ingest job fails', () => {
    expect(ofType('ingest.gate')).toMatchObject([
      { ts: at(61).toISOString(), spokeId: 'raw', result: 'reject' },
    ]);
  });

  it('closes an alert when the same job next completes', () => {
    const closes = ofType('alert.close');
    expect(closes.map((e) => e.ts)).toEqual([at(121).toISOString()]);
    const opened = ofType('alert.open').find((e) => e.alert.kind === 'run-failed');
    expect(closes[0]?.alertId).toBe(opened?.alert.id);
  });

  it('keeps an alert open when the job has not completed since', () => {
    const snapshot = buildSnapshot(model, buildRuns(EVENTS, T0 + 100 * MIN), at(100));
    expect(snapshot.alerts.map((a) => a.kind).sort()).toEqual(['run-aborted', 'run-failed']);
    expect(snapshot.counts).toMatchObject({ openIncidents: 2, failedRuns: 2 });
    expect(snapshot.previousDayClean).toBe(true);
  });

  it('drops the alert from the snapshot after the recovery', () => {
    const snapshot = buildSnapshot(model, buildRuns(EVENTS, T0 + 130 * MIN), at(130));
    expect(snapshot.alerts.map((a) => a.kind)).toEqual(['run-aborted']);
  });

  it('expires an unrecovered alert after a day', () => {
    const later = 63 + 24 * 60 + 1;
    const snapshot = buildSnapshot(model, buildRuns(EVENTS, T0 + later * MIN), at(later));
    expect(snapshot.alerts).toEqual([]);
  });

  it('flags yesterday as not clean when an incident opened then', () => {
    const next = 24 * 60 + 5;
    const snapshot = buildSnapshot(model, buildRuns(EVENTS, T0 + next * MIN), at(next));
    expect(snapshot.previousDayClean).toBe(false);
  });
});

describe('freshness', () => {
  it('reports the minutes since the latest completion that wrote the spoke', () => {
    const snapshot = buildSnapshot(model, buildRuns(EVENTS, T0 + 135 * MIN), at(135));
    expect(snapshot.spokes.find((s) => s.id === 'raw')).toMatchObject({
      ageMinutes: 14,
      targetMinutes: 90,
      pastTarget: false,
    });
  });

  it('is past target only beyond the target plus 3%', () => {
    const edge = 121 + 92; // 90 x 1.03 = 92.7 minutes
    const before = buildSnapshot(model, buildRuns(EVENTS, T0 + edge * MIN), at(edge));
    const after = buildSnapshot(model, buildRuns(EVENTS, T0 + (edge + 1) * MIN), at(edge + 1));
    expect(before.spokes.find((s) => s.id === 'raw')?.pastTarget).toBe(false);
    expect(after.spokes.find((s) => s.id === 'raw')?.pastTarget).toBe(true);
    expect(after.counts.spokesPastTarget).toBeGreaterThan(0);
  });

  it('reports seven days for a spoke nothing has written', () => {
    const snapshot = buildSnapshot(model, buildRuns([], T0), at(0));
    expect(snapshot.spokes.every((s) => s.ageMinutes === 7 * 24 * 60 && s.pastTarget)).toBe(true);
  });

  it('emits a refresh event per completion and one crossing when nothing follows', () => {
    const fresh = ofType('freshness.change').filter((e) => e.spokeId === 'raw');
    const crossings = fresh.filter((e) => e.pastTarget);
    expect(fresh.some((e) => e.ageMinutes === 0 && e.ts === at(121).toISOString())).toBe(true);
    // The last refresh (121) is never followed by another, so it crosses after 92.7 minutes.
    expect(crossings.map((e) => e.ts)).toContain(
      new Date(T0 + 121 * MIN + 90 * 1.03 * MIN).toISOString(),
    );
    expect(crossings.every((e) => e.ageMinutes === 92.7 && e.targetMinutes === 90)).toBe(true);
  });

  it('does not emit a crossing when the next refresh arrives within the band', () => {
    const crossings = ofType('freshness.change').filter(
      (e) => e.pastTarget && e.spokeId === 'mart',
    );
    const refreshes = ofType('freshness.change')
      .filter((e) => !e.pastTarget && e.spokeId === 'mart')
      .map((e) => Date.parse(e.ts));
    for (const crossing of crossings) {
      const next = refreshes.find((ms) => ms > Date.parse(crossing.ts) - 92.7 * MIN);
      expect(next === undefined || next > Date.parse(crossing.ts)).toBe(true);
    }
  });
});

describe('snapshot', () => {
  it('counts running runs, fills activity from the last hour, and stays within 0..1', () => {
    const snapshot = buildSnapshot(model, buildRuns(EVENTS, T0 + 38 * MIN), at(38));
    expect(snapshot.counts.runningPipelines).toBe(1);
    expect(snapshot.workloads['streaming']).toBeGreaterThan(0);
    const groups = snapshot.sourceGroups.find((g) => g.id === 'ext');
    expect(groups?.activity).toBeGreaterThan(0);
    for (const spoke of snapshot.spokes) {
      expect(spoke.activity).toBeGreaterThanOrEqual(0);
      expect(spoke.activity).toBeLessThanOrEqual(1);
    }
  });

  it('stops counting a run as running when its last event is stale', () => {
    const snapshot = buildSnapshot(model, buildRuns(EVENTS, T0 + 40 * MIN + 91 * MIN), at(131));
    expect(snapshot.counts.runningPipelines).toBe(0);
  });

  it('reports use-case activity from sink runs in the last hour', () => {
    const snapshot = buildSnapshot(model, buildRuns(EVENTS, T0 + 30 * MIN), at(30));
    expect(snapshot.useCases).toEqual([
      { id: 'board', activity: 0.5, status: 'ok', note: '1 run in the last hour' },
    ]);
  });

  it('marks a use case that reads a spoke with an open incident', () => {
    const events = [
      ...EVENTS,
      ev({
        type: 'START',
        atMin: 70,
        run: 'f3',
        job: 'derive_more',
        inputs: [mart('c')],
        outputs: [mart('d')],
      }),
      ev({ type: 'FAIL', atMin: 71, run: 'f3', job: 'derive_more' }),
    ];
    const snapshot = buildSnapshot(model, buildRuns(events, T0 + 80 * MIN), at(80));
    expect(snapshot.useCases[0]?.status).toBe('warning');
  });

  it('reports a calendar of zeros that numbers the days of the month', () => {
    const { calendar } = buildSnapshot(model, runs, at(0));
    expect(calendar).toMatchObject({ year: 2026, month: 3 });
    expect(calendar.days).toHaveLength(31);
    expect(calendar.days.every((d) => d.releases === 0 && !d.promotion)).toBe(true);
    expect(calendar.days[30]?.monthEndClose).toBe(true);
    expect(calendar.days[1]?.isPast).toBe(true);
    expect(calendar.days[2]?.isPast).toBe(false);
  });

  it('has no schedule, spend, or deploys', () => {
    const snapshot = buildSnapshot(model, runs, at(30));
    expect(snapshot).toMatchObject({ schedule: [], spendPerHour: 0 });
    expect(snapshot.counts.deploysToday).toBe(0);
  });
});

describe('determinism', () => {
  it('gives the same events for the same input and for split windows', () => {
    const whole = buildEvents(model, runs, window(0, 200));
    const again = buildEvents(model, buildRuns([...EVENTS].reverse()), window(0, 200));
    expect(again).toEqual(whole);
    const halves = [
      ...buildEvents(model, runs, window(0, 61)),
      ...buildEvents(model, runs, window(61, 200)),
    ];
    expect(halves).toEqual(whole);
  });

  it('orders events by time, then by type', () => {
    const times = all.map((e) => Date.parse(e.ts));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('uses only ids from the topology', () => {
    const { topology } = model;
    const spokes = new Set(topology.spokes.map((s) => s.id));
    const sites = new Set(topology.sourceGroups.flatMap((g) => g.sites.map((s) => s.id)));
    for (const event of all) {
      if ('spokeId' in event) expect(spokes.has(event.spokeId)).toBe(true);
      if ('siteId' in event) expect(sites.has(event.siteId)).toBe(true);
    }
  });
});
