// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { buildModel } from '../src/build-model.js';
import { buildEvents, buildSnapshot } from '../src/convert/index.js';
import { BYTES_PER_BATCH_POD, ROWS_PER_BATCH_POD } from '../src/convert/events.js';
import { MAX_ERROR_MESSAGE_CHARS, outputStatisticsOf, runFacetsOf } from '../src/facets.js';
import { normalizeEvent } from '../src/parse.js';
import { planReplay, replicaOf } from '../src/replay.js';
import { buildRuns } from '../src/runs.js';
import type { DatasetRef, RunEvent } from '../src/types.js';
import { FILE_OPTIONS, MIN, T0, dataset, ev, makeEnv, wire } from './helpers.js';

const env = makeEnv(FILE_OPTIONS);
const at = (minutes: number): Date => new Date(T0 + minutes * MIN);
const GB = 1024 * 1024 * 1024;

const withStats = (ref: DatasetRef, stats: DatasetRef['stats']): DatasetRef =>
  stats === undefined ? ref : { ...ref, stats };

describe('run facets on the wire', () => {
  const base = wire(ev({ type: 'FAIL', atMin: 1, run: 'r', job: 'j' }));
  const parsed = (run: Record<string, unknown>): RunEvent => {
    const result = normalizeEvent({ ...base, run: { runId: 'r', ...run } });
    if (typeof result === 'string') throw new Error(result);
    return result;
  };

  it('reads the error message as plain text of at most 300 characters', () => {
    const long = `boom\u0000\u001b[31m\n\tin   ${'x'.repeat(1000)}`;
    const event = parsed({ facets: { errorMessage: { message: long, stackTrace: 'ignored' } } });
    expect(event.errorMessage).toHaveLength(MAX_ERROR_MESSAGE_CHARS);
    expect(event.errorMessage?.startsWith('boom [31m in x')).toBe(true);
    expect([...(event.errorMessage ?? '')].every((c) => c.charCodeAt(0) >= 0x20)).toBe(true);
  });

  it('reads the nominal start time', () => {
    const event = parsed({ facets: { nominalTime: { nominalStartTime: '2026-03-02T11:00:00Z' } } });
    expect(event.nominalStartMs).toBe(T0 + 60 * MIN);
  });

  it('ignores facets of an unexpected shape without rejecting the event', () => {
    for (const facets of [
      null,
      [],
      'x',
      { errorMessage: 5 },
      { errorMessage: { message: 7 } },
      { errorMessage: { message: '   ' } },
      { errorMessage: { message: 'y'.repeat(100_000) } },
      { nominalTime: { nominalStartTime: 'not a date' } },
      { nominalTime: { nominalStartTime: 12345 } },
      { nominalTime: { nominalStartTime: '2026-03-02T11:00:00Z'.padEnd(500, '0') } },
    ]) {
      const event = parsed({ facets });
      expect(event.errorMessage).toBeUndefined();
      expect(event.nominalStartMs).toBeUndefined();
    }
  });

  it('accepts the nulls Marquez serves for absent lists and facets', () => {
    const event = normalizeEvent({
      eventType: 'COMPLETE',
      eventTime: '2026-03-02T10:00:00Z',
      run: { runId: 'r', facets: null },
      job: { namespace: 'jobs', name: 'j', facets: null },
      inputs: null,
      outputs: [{ namespace: 'lake', name: 'raw.a', facets: null, outputFacets: null }],
    });
    expect(typeof event).toBe('object');
    expect(event).toMatchObject({ inputs: [], outputs: [{ name: 'raw.a', tags: {} }] });
  });

  it('reads output statistics and ignores bad values', () => {
    const output = (outputStatistics: unknown) => {
      const event = normalizeEvent({
        ...base,
        outputs: [{ namespace: 'lake', name: 'raw.a', outputFacets: { outputStatistics } }],
      });
      return typeof event === 'string' ? event : event.outputs[0]?.stats;
    };
    expect(output({ rowCount: 10, size: 2048, fileCount: 3 })).toEqual({
      rowCount: 10,
      sizeBytes: 2048,
    });
    expect(output({ rowCount: 10, size: -1 })).toEqual({ rowCount: 10 });
    expect(output({ rowCount: '10', size: Number.NaN })).toBeUndefined();
    expect(output({ size: 1e30 })).toBeUndefined();
    expect(output('big')).toBeUndefined();
    expect(outputStatisticsOf(undefined)).toBeUndefined();
    expect(runFacetsOf(undefined)).toEqual({});
  });
});

describe('alert text', () => {
  const failing = (extra: Partial<RunEvent>): RunEvent[] => [
    ev({ type: 'START', atMin: 0, run: 'f', job: 'load_y', outputs: [dataset('raw.b')] }),
    { ...ev({ type: 'FAIL', atMin: 2, run: 'f', job: 'load_y' }), ...extra },
  ];

  it('adds the error message of a failed run', () => {
    const runs = buildRuns(failing({ errorMessage: 'connection reset by peer' }));
    const snapshot = buildSnapshot(buildModel(env, runs), runs, at(5));
    expect(snapshot.alerts[0]?.text).toBe('The run ended as failed. connection reset by peer');
  });

  it('uses the message of an aborted run and the plain text when there is none', () => {
    const aborted = buildRuns(failing({ eventType: 'ABORT', errorMessage: 'killed by operator' }));
    const plain = buildRuns(failing({}));
    const text = (runs: ReturnType<typeof buildRuns>): string | undefined =>
      buildSnapshot(buildModel(env, runs), runs, at(5)).alerts[0]?.text;
    expect(text(aborted)).toBe('The run ended as aborted. killed by operator');
    expect(text(plain)).toBe('The run ended as failed.');
  });

  it('carries the message into the alert.open event', () => {
    const runs = buildRuns(failing({ errorMessage: 'disk full' }));
    const opened = buildEvents(buildModel(env, runs), runs, { since: at(0), until: at(10) })
      .map((item) => item.event)
      .find((event) => event.type === 'alert.open');
    expect(opened).toMatchObject({ alert: { text: 'The run ended as failed. disk full' } });
  });
});

describe('batch size from output statistics', () => {
  const batch = (stats: DatasetRef['stats'], minutes = 2): number | undefined => {
    const output = stats ? withStats(dataset('raw.b'), stats) : dataset('raw.b');
    const runs = buildRuns([
      ev({ type: 'START', atMin: 0, run: 'b', job: 'load_y', outputs: [output] }),
      ev({ type: 'COMPLETE', atMin: minutes, run: 'b', job: 'load_y' }),
    ]);
    const events = buildEvents(buildModel(env, runs), runs, { since: at(-1), until: at(100) });
    const found = events.map((item) => item.event).find((event) => event.type === 'source.batch');
    return found?.type === 'source.batch' ? found.size : undefined;
  };

  it('uses bytes written, one more pod per 256 MiB, bounded to 4', () => {
    expect(batch({ sizeBytes: 1000 })).toBe(1);
    expect(batch({ sizeBytes: BYTES_PER_BATCH_POD * 2.5 })).toBe(3);
    expect(batch({ sizeBytes: 500 * GB })).toBe(4);
  });

  it('uses rows when bytes are missing, and prefers bytes when both exist', () => {
    expect(batch({ rowCount: ROWS_PER_BATCH_POD * 2 })).toBe(3);
    expect(batch({ rowCount: ROWS_PER_BATCH_POD * 3, sizeBytes: 10 })).toBe(1);
  });

  it('falls back to the run duration without statistics', () => {
    expect(batch(undefined, 12)).toBe(3);
  });
});

describe('spoke volume from output statistics', () => {
  it('sums the latest bytes written per dataset, in terabytes', () => {
    const runs = buildRuns([
      ev({
        type: 'COMPLETE',
        atMin: 1,
        run: 'old',
        job: 'load_a',
        outputs: [withStats(dataset('raw.a'), { sizeBytes: 9e12 })],
      }),
      ev({
        type: 'COMPLETE',
        atMin: 5,
        run: 'new',
        job: 'load_a',
        outputs: [withStats(dataset('raw.a'), { sizeBytes: 2e12 })],
      }),
      ev({
        type: 'COMPLETE',
        atMin: 6,
        run: 'other',
        job: 'load_b',
        outputs: [withStats(dataset('raw.b'), { sizeBytes: 5e11 })],
      }),
      ev({ type: 'COMPLETE', atMin: 7, run: 'mart', job: 'mart_c', outputs: [dataset('mart.c')] }),
    ]);
    const { spokes } = buildModel(env, runs).topology;
    expect(spokes.find((s) => s.id === 'raw')?.metrics.volume).toBe(2.5);
    expect(spokes.find((s) => s.id === 'mart')?.metrics.volume).toBe(0);
  });
});

describe('schedule from nominal times', () => {
  const scheduled = (nominalMin: number): RunEvent[] => [
    {
      ...ev({ type: 'START', atMin: 0, run: 's', job: 'nightly', outputs: [dataset('raw.s')] }),
      nominalStartMs: T0 + nominalMin * MIN,
    },
  ];
  const schedule = (events: RunEvent[], atMin: number) => {
    const runs = buildRuns(events, T0 + atMin * MIN);
    return buildSnapshot(buildModel(env, runs), runs, at(atMin)).schedule;
  };

  it('lists runs whose nominal start is still ahead today', () => {
    expect(schedule(scheduled(90), 5)).toEqual([
      {
        id: 't:nominal:s',
        title: 'nightly scheduled',
        kind: 'transfer',
        severity: 'info',
        start: at(90).toISOString(),
        end: at(105).toISOString(),
      },
    ]);
  });

  it('calls the window scripted when the run is not a transfer', () => {
    const copy: RunEvent = {
      ...ev({
        type: 'START',
        atMin: 0,
        run: 'c',
        job: 'derive',
        inputs: [dataset('raw.a')],
        outputs: [dataset('mart.c')],
      }),
      nominalStartMs: T0 + 90 * MIN,
    };
    expect(schedule([copy], 5)[0]?.kind).toBe('scripted');
  });

  it('leaves the schedule empty without upcoming nominal runs', () => {
    expect(schedule(scheduled(-30), 5)).toEqual([]);
    expect(schedule(scheduled(24 * 60), 5)).toEqual([]);
    expect(schedule([ev({ type: 'START', atMin: 0, run: 'x', job: 'j' })], 5)).toEqual([]);
  });
});

describe('replay keeps nominal times in step', () => {
  it('shifts the nominal start with the event', () => {
    const [event] = scheduledOne();
    const plan = planReplay({ anchorMs: undefined, periodMs: 24 * 60 * MIN }, T0);
    const copy = replicaOf([event as RunEvent], 2, plan)[0] as RunEvent;
    expect(copy.nominalStartMs).toBe(((event as RunEvent).nominalStartMs ?? 0) + 2 * 24 * 60 * MIN);
  });
});

function scheduledOne(): RunEvent[] {
  return [{ ...ev({ type: 'START', atMin: 0, run: 'a', job: 'j' }), nominalStartMs: T0 + MIN }];
}
