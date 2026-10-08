// SPDX-License-Identifier: Apache-2.0
import { collect, FixedClock, loadExampleEnvironment, silentLogger } from '@orrery/testkit';
import { describe, expect, it } from 'vitest';
import { MockAdapter, parseSpeed, resolveSeed } from '../src/index.js';
import { at, demoEnv, started } from './helpers.js';

describe('mock topology', () => {
  it('builds the reference prod world', async () => {
    const topology = await (await started(demoEnv('prod'))).topology();
    expect(topology.spokes.map((s) => s.id)).toEqual([
      'ingest',
      'supply',
      'operations',
      'quality',
      'customer',
      'sales',
      'finance',
    ]);
    expect(topology.spokes.find((s) => s.id === 'operations')).toMatchObject({
      metrics: { pipelines: 150, products: 62, complexity: 4.5, volume: 2200 },
      hasMl: true,
      metastore: 'primary',
    });
    expect(topology.spokes.find((s) => s.id === 'customer')?.metastore).toBe('secondary');
    const sites = topology.sourceGroups.flatMap((g) => g.sites);
    expect(sites).toHaveLength(10);
    expect(sites[0]).toEqual({ id: 'region-a-1', name: 'Site 01' });
    expect(sites.at(-1)).toEqual({ id: 'region-e-2', name: 'Site 10' });
    expect(topology.foreignCatalogs.map((f) => f.id)).toEqual([
      'legacy-warehouse',
      'operational-db',
    ]);
    expect(topology.useCases.find((u) => u.id === 'models')).toMatchObject({
      site: 'Engineering studio',
      utcOffset: 5.5,
    });
  });

  it('scales dev down and drops what dev excludes', async () => {
    const topology = await (await started(demoEnv('dev'))).topology();
    expect(topology.spokes.map((s) => s.id)).not.toContain('finance');
    expect(topology.spokes.find((s) => s.id === 'operations')?.metrics.pipelines).toBe(45);
    expect(topology.sourceGroups.map((g) => g.id)).toEqual(['region-a', 'region-b']);
    expect(topology.useCases.find((u) => u.id === 'exec')?.reads).toEqual(['operations', 'supply']);
    expect(topology.metastores).toEqual([
      { id: 'primary', name: 'Primary metastore', status: 'ok' },
    ]);
    expect(topology.foreignCatalogs).toEqual([]);
  });

  it('gives unknown ids seeded, stable defaults', async () => {
    const base = loadExampleEnvironment('single-workspace.yaml', 'prod');
    const [spoke] = base.resolvedTopology.spokes;
    const [group] = base.resolvedTopology.sourceGroups;
    if (!spoke || !group) throw new Error('example changed');
    const env = {
      ...base,
      resolvedTopology: {
        ...base.resolvedTopology,
        spokes: [
          ...base.resolvedTopology.spokes,
          { ...spoke, id: 'widgets', name: 'Widgets', role: 'domain' as const },
        ],
        sourceGroups: [{ ...group, id: 'region-z', name: 'Region Z' }],
      },
    };
    const [a, b] = [await started(env), await started(env)];
    expect(await a.topology()).toEqual(await b.topology());
    const topology = await a.topology();
    expect(topology.sourceGroups[0]?.sites).toHaveLength(2);
    const widgets = topology.spokes.find((s) => s.id === 'widgets');
    expect(widgets?.metrics.pipelines).toBeGreaterThanOrEqual(20);
    expect(widgets?.metrics.pipelines).toBeLessThan(100);
    expect(topology.shipyard).toEqual({ name: 'Engineering studio', utcOffset: 5.5 });
  });

  it('returns copies so callers cannot mutate the world', async () => {
    const adapter = await started(demoEnv('prod'));
    const first = await adapter.topology();
    first.spokes.pop();
    expect((await adapter.topology()).spokes).toHaveLength(7);
  });
});

describe('mock settings and lifecycle', () => {
  it('validates MOCK_SPEED and MOCK_SEED', () => {
    expect(parseSpeed(undefined)).toBe(1);
    expect(parseSpeed(' ')).toBe(1);
    expect(parseSpeed('4')).toBe(4);
    expect(() => parseSpeed('0')).toThrow(/MOCK_SPEED must be a positive number/);
    expect(() => parseSpeed('fast')).toThrow(/MOCK_SPEED/);
    expect(() => resolveSeed(demoEnv('prod'), '1.5')).toThrow(/MOCK_SEED must be an integer/);
    expect(resolveSeed(demoEnv('prod'), undefined)).toBe(33);
    expect(resolveSeed(demoEnv('prod'), '7')).toBe(resolveSeed(demoEnv('prod'), '7'));
  });

  it('throws a clear error when used before init', async () => {
    await expect(new MockAdapter().snapshot()).rejects.toThrow(/before init/);
  });

  it('runs simulated time at MOCK_SPEED in snapshot()', async () => {
    const clock = new FixedClock(at('12:00'));
    const adapter = new MockAdapter();
    await adapter.init(demoEnv('prod'), { clock, logger: silentLogger, env: { MOCK_SPEED: '60' } });
    clock.advance(60_000);
    expect((await adapter.snapshot()).at).toBe(at('13:00').toISOString());
  });

  it('streams live events until disposed', async () => {
    const clock = new FixedClock(at('12:00'));
    const adapter = new MockAdapter();
    await adapter.init(demoEnv('prod'), {
      clock,
      logger: silentLogger,
      env: { MOCK_SPEED: '600' },
    });
    const events = await collect(adapter.events(at('12:00')), 50);
    expect(events).toHaveLength(50);
    expect(Date.parse(events.at(-1)?.ts ?? '')).toBeGreaterThan(Date.parse(events[0]?.ts ?? ''));
    const stream = adapter.events(clock.now())[Symbol.asyncIterator]();
    await adapter.dispose();
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it('stops the live stream when the context signal aborts', async () => {
    const controller = new AbortController();
    const clock = new FixedClock(at('12:00'));
    const adapter = new MockAdapter();
    await adapter.init(demoEnv('prod'), {
      clock,
      logger: silentLogger,
      env: {},
      signal: controller.signal,
    });
    controller.abort();
    expect(await collect(adapter.events(at('12:00')))).toEqual([]);
  });

  it('reports workload mix, backlog, spend, and the calendar', async () => {
    const snapshot = await (await started(demoEnv('prod'))).snapshot(at('03:05'));
    expect(Object.keys(snapshot.workloads)).toEqual([
      'streaming',
      'batch',
      'transfer',
      'transform',
      'ml',
      'serving',
      'build',
    ]);
    expect(snapshot.workloads.transfer).toBeGreaterThan(0.45);
    expect(snapshot.backlog).toBeGreaterThan(0);
    expect(snapshot.spendPerHour).toBeGreaterThan(0);
    expect(snapshot.calendar).toMatchObject({ year: 2026, month: 10 });
    expect(snapshot.calendar.days).toHaveLength(31);
    expect(snapshot.calendar.days.filter((d) => d.isPast)).toHaveLength(7);
    expect(snapshot.calendar.days.at(-1)?.monthEndClose).toBe(true);
    expect(snapshot.schedule.filter((w) => w.kind === 'transfer')).toHaveLength(5);
    expect(snapshot.previousDayClean).toBe(false);
    const stg = await (await started(demoEnv('stg'))).snapshot(at('00:05'));
    expect(stg.previousDayClean).toBe(true);
  });
});
