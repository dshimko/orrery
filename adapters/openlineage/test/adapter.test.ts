// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PlatformEvent } from '@orrery/core';
import { FixedClock, collect, createMemoryLogger, loadExampleEnvironment } from '@orrery/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenLineageAdapter } from '../src/adapter.js';
import { MS_PER_DAY } from '../src/time.js';
import { MIN, REPO_ROOT, T0, context, dataset, ev, makeEnv, wire } from './helpers.js';

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'orrery-ol-adapter-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const iso = (ms: number): string => new Date(ms).toISOString();

async function writeEvents(name: string, lines: unknown[]): Promise<void> {
  await writeFile(path.join(dir, name), lines.map((line) => JSON.stringify(line)).join('\n'));
}

const SAMPLE = [
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
].map(wire);

const CLEAN_TOPOLOGY = `hub: { id: core, name: Core }
spokes:
  - id: raw
    name: Raw
    role: ingest
    match: { catalog: lake, schema: 'raw.*' }
    freshness: { cadenceMinutes: 60, targetMinutes: 90 }
  - id: mart
    name: Mart
    role: domain
    match: { catalog: lake, schema: 'mart.*' }
    freshness: { cadenceMinutes: 60, targetMinutes: 90 }
sourceGroups:
  - id: loaders
    name: Loaders
    utcOffset: 0
    match: { schema: 'load_*' }
useCases: []`;

function fileOptions(name: string, replay = 'replay: false'): string {
  return `source: { kind: file, path: ${name} }\n${replay}`;
}

async function started(
  options: string,
  at: Date | string = iso(T0),
  topology?: string,
): Promise<OpenLineageAdapter> {
  const adapter = new OpenLineageAdapter({ cwd: dir });
  await adapter.init(makeEnv(options, topology), context(at));
  return adapter;
}

describe('init', () => {
  it('rejects invalid options with a message that names the problem', async () => {
    const adapter = new OpenLineageAdapter({ cwd: dir });
    await expect(adapter.init(makeEnv('foo: 1'), context(T0))).rejects.toThrow(
      /Invalid openlineage options/,
    );
  });

  it('names a missing file without leaking more', async () => {
    const adapter = new OpenLineageAdapter({ cwd: dir });
    await expect(adapter.init(makeEnv(fileOptions('nope.json')), context(T0))).rejects.toThrow(
      'Cannot read the OpenLineage events file "nope.json": the file does not exist.',
    );
  });

  it('fails clearly when the API key variable is not set, and never prints a value', async () => {
    const adapter = new OpenLineageAdapter({ cwd: dir });
    const options = `source: { kind: marquez, url: 'https://m.example.org', apiKey: '\${env:MARQUEZ_KEY}' }`;
    await expect(adapter.init(makeEnv(options), context(T0))).rejects.toThrow(
      'The environment variable MARQUEZ_KEY is not set.',
    );
  });

  it('is unusable before init and after dispose', async () => {
    const adapter = new OpenLineageAdapter({ cwd: dir });
    await expect(adapter.topology()).rejects.toThrow('before init() or after dispose()');
    const ready = await (async () => {
      await writeEvents('ok.ndjson', SAMPLE);
      return started(fileOptions('ok.ndjson'));
    })();
    await ready.dispose();
    await expect(ready.snapshot(new Date(T0))).rejects.toThrow('before init() or after dispose()');
  });
});

describe('file source', () => {
  it('reads a JSON array as well as NDJSON', async () => {
    await writeFile(path.join(dir, 'array.json'), JSON.stringify(SAMPLE));
    const adapter = await started(fileOptions('array.json'));
    const events = await collect(adapter.events(new Date(T0), new Date(T0 + 60 * MIN)));
    expect(events.map((e) => e.type)).toContain('source.batch');
  });

  it('builds the topology from the data and the matchers', async () => {
    await writeEvents('topo.ndjson', SAMPLE);
    const adapter = await started(fileOptions('topo.ndjson'));
    const topology = await adapter.topology();
    expect(topology.spokes.map((s) => [s.id, s.metrics.pipelines, s.metrics.products])).toEqual([
      ['raw', 1, 1],
      ['mart', 1, 1],
    ]);
    expect(topology.sourceGroups.find((g) => g.id === 'loaders')?.sites.map((s) => s.name)).toEqual(
      ['load_a'],
    );
    // Callers cannot change the adapter's own copy.
    topology.spokes.length = 0;
    expect((await adapter.topology()).spokes).toHaveLength(2);
  });

  it('is healthy for a clean file and degraded when lines were skipped, naming the line', async () => {
    await writeEvents('clean.ndjson', SAMPLE);
    const clean = await started(fileOptions('clean.ndjson'), iso(T0), CLEAN_TOPOLOGY);
    expect(await clean.health()).toEqual({
      status: 'ok',
      message: '4 run events from a file.',
      checkedAt: iso(T0),
    });
    await writeFile(path.join(dir, 'dirty.ndjson'), `${JSON.stringify(SAMPLE[0])}\n{broken\n`);
    const dirty = await started(fileOptions('dirty.ndjson'), iso(T0), CLEAN_TOPOLOGY);
    const health = await dirty.health();
    expect(health.status).toBe('degraded');
    expect(health.message).toContain('Skipped 1 entries');
    expect(health.message).toContain('line 2: not valid JSON');
  });

  it('reports configuration gaps in health', async () => {
    await writeEvents('gaps.ndjson', SAMPLE);
    const topology = `hub: { id: core, name: Core }
spokes:
  - id: raw
    name: Raw
    role: ingest
    match: { catalog: lake, schema: 'raw.*' }
    freshness: { cadenceMinutes: 60, targetMinutes: 90 }
  - id: empty
    name: Empty
    role: domain
    match: { catalog: nowhere }
    freshness: { cadenceMinutes: 60, targetMinutes: 90 }
  - id: void
    name: Void
    role: domain
    match: { catalog: nowhere }
    freshness: { cadenceMinutes: 60, targetMinutes: 90 }
  - id: vacant
    name: Vacant
    role: domain
    match: { catalog: nowhere }
    freshness: { cadenceMinutes: 60, targetMinutes: 90 }
  - id: blank
    name: Blank
    role: domain
    match: { catalog: nowhere }
    freshness: { cadenceMinutes: 60, targetMinutes: 90 }
sourceGroups:
  - id: lonely
    name: Lonely
    utcOffset: 0
    match: { catalog: nowhere }
useCases:
  - id: dash
    name: Dash
    match: { catalog: nowhere }`;
    const adapter = await started(fileOptions('gaps.ndjson'), iso(T0), topology);
    const health = await adapter.health();
    expect(health.status).toBe('degraded');
    expect(health.message).toContain('Spoke "empty" matches no dataset.');
    expect(health.message).toContain('Source group "lonely" matches no source.');
    expect(health.message).not.toContain('Use case "dash"');
    expect(health.message).toContain('(1 more)');
    const topo = await adapter.topology();
    expect(topo.useCases[0]?.reads).toEqual([]);
  });

  it('keeps every id in events valid when the topology has no source group sites', async () => {
    await writeEvents('nosites.ndjson', SAMPLE);
    const adapter = await started(fileOptions('nosites.ndjson'));
    const events = await collect(adapter.events(new Date(T0), new Date(T0 + 60 * MIN)));
    const sites = new Set(
      (await adapter.topology()).sourceGroups.flatMap((g) => g.sites.map((s) => s.id)),
    );
    for (const event of events) if ('siteId' in event) expect(sites.has(event.siteId)).toBe(true);
  });

  it('describes a replayed file in health', async () => {
    await writeEvents('desc.ndjson', SAMPLE);
    const adapter = await started(
      fileOptions('desc.ndjson', 'replay: { period: hour }'),
      iso(T0),
      CLEAN_TOPOLOGY,
    );
    expect(await adapter.health()).toMatchObject({
      status: 'ok',
      message: '4 run events from a file replayed every hour.',
    });
  });
});

describe('time windows', () => {
  it('rejects event windows over 24 hours', async () => {
    await writeEvents('win.ndjson', SAMPLE);
    const adapter = await started(fileOptions('win.ndjson'));
    expect(() => adapter.events(new Date(T0), new Date(T0 + MS_PER_DAY + 1))).toThrow(
      'Event windows are limited to 24 hours.',
    );
  });

  it('rejects an invalid snapshot time', async () => {
    await writeEvents('bad-time.ndjson', SAMPLE);
    const adapter = await started(fileOptions('bad-time.ndjson'));
    await expect(adapter.snapshot(new Date('nope'))).rejects.toThrow('Invalid snapshot time.');
  });

  it('stops yielding when the caller aborts', async () => {
    await writeEvents('abort.ndjson', SAMPLE);
    const adapter = await started(fileOptions('abort.ndjson'));
    const controller = new AbortController();
    const seen: PlatformEvent[] = [];
    for await (const event of adapter.events(
      new Date(T0),
      new Date(T0 + 60 * MIN),
      controller.signal,
    )) {
      seen.push(event);
      controller.abort();
    }
    expect(seen).toHaveLength(1);
  });

  it('stops yielding after dispose', async () => {
    await writeEvents('disp.ndjson', SAMPLE);
    const adapter = await started(fileOptions('disp.ndjson'));
    const stream = adapter.events(new Date(T0), new Date(T0 + 60 * MIN))[Symbol.asyncIterator]();
    await stream.next();
    await adapter.dispose();
    expect((await stream.next()).done).toBe(true);
  });
});

describe('replay (public sample)', () => {
  const env = loadExampleEnvironment('openlineage.yaml', 'sample');

  async function sample(at: string): Promise<OpenLineageAdapter> {
    const adapter = new OpenLineageAdapter({ cwd: REPO_ROOT });
    await adapter.init(env, context(at));
    return adapter;
  }

  it('shows the same scene on any day, by repeating the sample every hour', async () => {
    const adapter = await sample('2031-07-19T00:00:00Z');
    const day = async (date: string): Promise<string[]> =>
      (
        await collect(adapter.events(new Date(`${date}T10:00:00Z`), new Date(`${date}T11:00:00Z`)))
      ).map((e) => e.type + e.ts.slice(10));
    const first = await day('2031-07-19');
    expect(first.length).toBeGreaterThan(20);
    expect(await day('2044-02-03')).toEqual(first.map((entry) => entry));
  });

  it('is alive in a snapshot at any time of day', async () => {
    const adapter = await sample('2031-07-19T03:07:00Z');
    const snapshot = await adapter.snapshot(new Date('2031-07-19T03:07:00Z'));
    expect(snapshot.counts.runningPipelines).toBeGreaterThan(0);
    expect(snapshot.spokes.every((s) => !s.pastTarget)).toBe(true);
  });

  it('moves the sample to the anchor and repeats it daily when configured', async () => {
    await writeFile(path.join(dir, 'anchored.json'), JSON.stringify(SAMPLE));
    const adapter = await started(
      fileOptions('anchored.json', "replay: { anchor: '2030-01-01T09:00:00Z' }"),
      '2030-01-05T09:00:00Z',
    );
    const events = await collect(
      adapter.events(new Date('2030-01-05T09:00:00Z'), new Date('2030-01-05T10:00:00Z')),
    );
    expect(events.find((e) => e.type === 'source.batch')?.ts).toBe('2030-01-05T09:05:00.000Z');
    const none = await collect(
      adapter.events(new Date('2030-01-05T10:00:00Z'), new Date('2030-01-05T11:00:00Z')),
    );
    expect(none.filter((e) => e.type === 'source.batch')).toEqual([]);
  });

  it('reads the shipped sample: 26 events, 13 runs, no problems', async () => {
    const adapter = await sample('2020-02-22T22:03:00Z');
    expect(await adapter.health()).toEqual({
      status: 'ok',
      message: '26 run events from a file replayed every hour.',
      checkedAt: '2020-02-22T22:03:00.000Z',
    });
    const topology = await adapter.topology();
    expect(topology.sourceGroups[0]?.sites).toHaveLength(8);
    expect(topology.useCases.map((u) => u.reads)).toEqual([['ingest'], ['ingest', 'insights']]);
  });
});

describe('live stream', () => {
  it('yields what a window read yields, once each, then ends after 15 minutes', async () => {
    const env = loadExampleEnvironment('openlineage.yaml', 'sample');
    const start = new Date('2026-05-05T10:00:00Z');
    const clock = new FixedClock(start);
    const adapter = new OpenLineageAdapter({ cwd: REPO_ROOT });
    await adapter.init(env, { clock, logger: createMemoryLogger(), env: {} });
    const live = await collect(adapter.events(start));
    const ids = live.map((event) => JSON.stringify(event));
    expect(new Set(ids).size).toBe(ids.length);
    expect(live.length).toBeGreaterThan(10);
    const windowed = await collect(adapter.events(start, new Date(start.getTime() + 15 * MIN)));
    const within = windowed.filter((e) => Date.parse(e.ts) < clock.now().getTime());
    expect(live.map((e) => JSON.stringify(e)).sort()).toEqual(
      within.map((e) => JSON.stringify(e)).sort(),
    );
  });

  it('ends at once when the signal is already aborted', async () => {
    await writeEvents('live-abort.ndjson', SAMPLE);
    const adapter = await started(fileOptions('live-abort.ndjson'));
    const controller = new AbortController();
    controller.abort();
    expect(await collect(adapter.events(new Date(T0), undefined, controller.signal))).toEqual([]);
  });
});
