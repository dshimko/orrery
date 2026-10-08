// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { checkEvents } from '@orrery/testkit';
import type { PlatformEvent } from '@orrery/core';
import type { Row } from '../src/contracts.js';
import {
  NO_EVIDENCE_AGE_MINUTES,
  buildEvents,
  buildSnapshot,
  isPastTarget,
  parseEvidence,
  type RowSets,
} from '../src/convert/index.js';
import { buildDiscovery, type BuildInput } from '../src/discovery/build.js';
import { CONNECTION_ENV, prodEnv, withTopology, at } from './support/env.js';
import {
  catalog,
  discover,
  inventory,
  job,
  pipeline,
  schema,
  target,
  write,
} from './support/inventory.js';

const MIN = 60_000;
const NOW = at('12:00');
const iso = (ms: number): string => new Date(ms).toISOString();
const ago = (minutes: number): string => iso(NOW.getTime() - minutes * MIN);

const env = withTopology(prodEnv(), {
  useCases: [
    { id: 'readers', name: 'Gold readers', match: { schema: '*_gold' } },
    { id: 'exec', name: 'Executive overview', match: { tag: { use_case: 'exec' } } },
  ],
});

const discovery = discover(env, [
  inventory({
    catalogs: [
      catalog('prod_landing', { domain: 'ingest' }),
      catalog('prod_sales'),
      catalog('prod_finance', { domain: 'finance' }),
      catalog('legacy_wh'),
    ],
    schemas: [
      schema('prod_landing', 'landing_bronze'),
      schema('prod_landing', 'landing_silver'),
      schema('prod_sales', 'retail_sales_silver'),
      schema('prod_sales', 'retail_sales_gold'),
      schema('prod_finance', 'finance_gold'),
    ],
    foreign: ['legacy_wh'],
    objects: [
      pipeline('stream', { source_region: 'a' }, { streaming: true }),
      pipeline('batch', { source_region: 'b' }),
      job('xfer'),
      pipeline('silver'),
      pipeline('gold'),
      job('ml', { workload: 'ml' }),
      job('fin', { domain: 'finance' }),
    ],
    writes: [
      write('pipeline', 'stream', 'prod_landing', 'landing_bronze'),
      write('pipeline', 'batch', 'prod_landing', 'landing_bronze'),
      write('job', 'xfer', 'prod_landing', 'landing_silver'),
      write('pipeline', 'silver', 'prod_sales', 'retail_sales_silver'),
      write('pipeline', 'gold', 'prod_sales', 'retail_sales_gold'),
      write('job', 'ml', 'prod_sales', 'retail_sales_silver'),
      write('job', 'fin', 'prod_finance', 'finance_gold'),
    ],
  }),
]);

const jobRun = (
  id: string,
  run: string,
  startMin: number,
  endMin: number,
  state: string | null,
): Row => ({
  workspace_id: '1',
  job_id: id,
  run_id: run,
  started_at: ago(startMin),
  ended_at: ago(endMin),
  result_state: state,
});
const update = (
  id: string,
  run: string,
  startMin: number,
  endMin: number,
  state: string | null,
  trigger?: string,
): Row => ({
  workspace_id: '1',
  pipeline_id: id,
  update_id: run,
  started_at: ago(startMin),
  ended_at: ago(endMin),
  result_state: state,
  trigger_job_id: trigger ?? null,
});

const snapshotOf = (rows: RowSets, when = NOW) =>
  buildSnapshot(discovery, parseEvidence(rows), when);
const eventsOf = (rows: RowSets, from = 120, to = 0): PlatformEvent[] =>
  buildEvents(discovery, parseEvidence(rows), {
    since: new Date(NOW.getTime() - from * MIN),
    until: new Date(NOW.getTime() - to * MIN),
  }).map((item) => item.event);

describe('unavailable parts', () => {
  it('always marks the schedule and nothing else when no query degraded', () => {
    expect(snapshotOf({}).unavailable).toEqual({ schedule: 'No schedule data from this adapter.' });
  });
});

const spoke = (s: ReturnType<typeof snapshotOf>, id: string) => s.spokes.find((x) => x.id === id);

describe('snapshot freshness', () => {
  const quality: Row = {
    catalog_name: 'prod_sales',
    schema_name: 'retail_sales_gold',
    last_commit: ago(30),
    event_time: ago(5),
  };

  it('prefers data quality, then run history, then lineage, then reports no evidence', () => {
    const rows: RowSets = {
      table_freshness: [quality],
      pipeline_updates: [
        update('gold', 'u1', 200, 120, 'COMPLETED'),
        update('stream', 's', 100, 60, 'COMPLETED'),
      ],
      lineage_last_writes: [
        {
          target_table_catalog: 'prod_finance',
          target_table_schema: 'finance_gold',
          last_write: ago(300),
        },
      ],
    };

    const snapshot = snapshotOf(rows);

    expect(spoke(snapshot, 'sales')?.ageMinutes).toBe(30);
    expect(spoke(snapshot, 'ingest')?.ageMinutes).toBe(60);
    expect(spoke(snapshot, 'finance')?.ageMinutes).toBe(300);
    expect(spoke(snapshotOf({}), 'finance')?.ageMinutes).toBe(NO_EVIDENCE_AGE_MINUTES);
    expect(spoke(snapshotOf({}), 'finance')?.pastTarget).toBe(true);
  });

  it('ignores evidence from after the requested time', () => {
    const snapshot = snapshotOf({
      pipeline_updates: [update('gold', 'u1', -10, -20, 'COMPLETED')],
    });

    expect(spoke(snapshot, 'sales')?.ageMinutes).toBe(NO_EVIDENCE_AGE_MINUTES);
  });

  it('marks past target only above 103 percent of the target', () => {
    expect(isPastTarget(21.63, 21)).toBe(false);
    expect(isPastTarget(21.7, 21)).toBe(true);
    const fresh = snapshotOf({ pipeline_updates: [update('stream', 'a', 40, 21, 'COMPLETED')] });
    const late = snapshotOf({ pipeline_updates: [update('stream', 'a', 40, 22, 'COMPLETED')] });
    expect(spoke(fresh, 'ingest')?.pastTarget).toBe(false);
    expect(spoke(late, 'ingest')?.pastTarget).toBe(true);
    expect(late.counts.spokesPastTarget).toBeGreaterThanOrEqual(1);
  });
});

describe('snapshot activity, alerts, and counts', () => {
  it('counts running runs, but not stale ones, and fills activity and backlog', () => {
    const snapshot = snapshotOf({
      job_runs: [jobRun('xfer', 'a', 20, 1, null), jobRun('ml', 'b', 400, 300, null)],
      pipeline_updates: [update('stream', 'c', 30, 2, null)],
    });

    expect(snapshot.counts.runningPipelines).toBe(2);
    expect(spoke(snapshot, 'ingest')?.activity).toBeCloseTo(2 / 3);
    expect(snapshot.sourceGroups.find((g) => g.id === 'region-a')?.activity).toBeCloseTo(1 / 3);
    expect(snapshot.backlog).toBeCloseTo(2 / 8);
    expect(snapshot.hub.activity).toBeGreaterThan(0);
  });

  it('opens an alert per failed run and closes it on the next success of that object', () => {
    const failed = snapshotOf({
      job_runs: [jobRun('xfer', 'f1', 100, 90, 'FAILED'), jobRun('ml', 'f2', 50, 40, 'BLOCKED')],
    });
    const recovered = snapshotOf({
      job_runs: [
        jobRun('xfer', 'f1', 100, 90, 'FAILED'),
        jobRun('xfer', 'ok', 30, 20, 'SUCCEEDED'),
        jobRun('ml', 'f2', 50, 40, 'BLOCKED'),
      ],
    });

    expect(failed.alerts.map((a) => [a.kind, a.severity, a.targets])).toEqual([
      ['run-failed', 'incident', ['spoke:ingest']],
      ['run-blocked', 'warning', ['spoke:sales']],
    ]);
    expect(failed.counts).toMatchObject({ failedRuns: 1, openIncidents: 2 });
    expect(recovered.alerts.map((a) => a.kind)).toEqual(['run-blocked']);
  });

  it('keeps unrecovered failures for 24 hours and ignores cancelled and unlisted runs', () => {
    const snapshot = snapshotOf({
      job_runs: [
        jobRun('xfer', 'old', 25 * 60, 24 * 60 + 5, 'FAILED'),
        jobRun('ml', 'x', 10, 5, 'CANCELLED'),
        jobRun('unlisted', 'y', 10, 5, 'FAILED'),
      ],
    });

    expect(snapshot.alerts).toEqual([]);
    expect(snapshot.counts.failedRuns).toBe(0);
  });

  it('is clean for the previous day unless an incident opened then', () => {
    const dayStart = Date.parse('2026-10-07T00:00:00Z');
    const minutesBeforeNow = (ms: number): number => (NOW.getTime() - ms) / MIN;
    const yesterday = snapshotOf({
      job_runs: [
        jobRun(
          'xfer',
          'y',
          minutesBeforeNow(dayStart) + 60,
          minutesBeforeNow(dayStart) + 30,
          'FAILED',
        ),
      ],
    });

    expect(yesterday.previousDayClean).toBe(false);
    expect(snapshotOf({}).previousDayClean).toBe(true);
  });

  it('derives use case activity, status, and spend', () => {
    const snapshot = snapshotOf({
      station_reads: [
        {
          read_minute: ago(10),
          source_table_catalog: 'prod_sales',
          source_table_schema: 'retail_sales_gold',
          statements: '10',
        },
        {
          read_minute: ago(200),
          source_table_catalog: 'prod_sales',
          source_table_schema: 'retail_sales_gold',
          statements: '10',
        },
      ],
      job_runs: [jobRun('ml', 'b', 50, 40, 'BLOCKED')],
      billing_usage: [{ est_cost: '48' }, { est_cost: '24' }],
    });

    expect(snapshot.useCases.find((u) => u.id === 'readers')).toMatchObject({
      activity: 0.5,
      status: 'warning',
      note: '10 statements in the last hour',
    });
    expect(snapshot.useCases.find((u) => u.id === 'exec')?.activity).toBe(0);
    expect(snapshot.spendPerHour).toBe(3);
    expect(snapshot.consumerActivity).toBe(0.25);
    expect(snapshot.workloads['serving']).toBe(0.25);
  });
});

describe('snapshot calendar and deploys', () => {
  const change = (
    name: string,
    daysAgo: number,
    tags: Record<string, string>,
    deleted = false,
  ): Row => ({
    workspace_id: '1',
    job_id: 'ml',
    name,
    tags_json: JSON.stringify(tags),
    change_time: iso(NOW.getTime() - daysAgo * 86_400_000),
    delete_time: deleted ? iso(NOW.getTime()) : null,
  });

  it('counts release-tagged job changes per UTC day of the month', () => {
    const snapshot = snapshotOf({
      job_changes: [
        change('a', 0, { release: 'r-1' }),
        change('b', 2, { Release: 'r-2' }),
        change('c', 2, { release: 'r-3' }),
        change('d', 3, { team: 'x' }),
        change('e', 4, { release: 'r-4' }, true),
      ],
    });

    const days = snapshot.calendar.days;
    expect(days).toHaveLength(31);
    expect(days[6]?.releases).toBe(1);
    expect(days[4]?.releases).toBe(2);
    expect(days[3]?.releases).toBe(0);
    expect(days[2]?.releases).toBe(0);
    expect(days[6]).toMatchObject({ isPast: true, promotion: false });
    expect(days[7]?.isPast).toBe(false);
    expect(days[30]?.monthEndClose).toBe(true);
    expect(snapshot.counts.deploysToday).toBe(1);
    expect(snapshot.schedule).toEqual([]);
  });

  it('reads the release tag key from the environment options', () => {
    const custom = discover({ ...env, options: { releaseTagKey: 'version' } }, []);
    const rows: RowSets = { job_changes: [change('a', 0, { version: 'v9', release: 'r-1' })] };

    const snapshot = buildSnapshot(custom, parseEvidence(rows), NOW);

    expect(snapshot.counts.deploysToday).toBe(1);
  });
});

describe('release tag key precedence', () => {
  type Promotion = BuildInput['promotion'];
  const jobTag: NonNullable<Promotion> = {
    order: ['stg', 'prod'],
    source: 'job-tag',
    tagKey: 'train',
  };
  /** Deploys counted today for a job change carrying only the `tagKey` tag. */
  const deploysTagged = (
    tagKey: string,
    options: Record<string, unknown> | undefined,
    promotion: Promotion,
  ): number => {
    const found = buildDiscovery({
      env: { ...env, ...(options ? { options } : {}) },
      peers: [env],
      targets: [target()],
      inventories: [inventory()],
      envVars: CONNECTION_ENV,
      ...(promotion ? { promotion } : {}),
    });
    const rows: RowSets = {
      job_changes: [
        {
          workspace_id: '1',
          job_id: 'ml',
          name: 'ml',
          tags_json: JSON.stringify({ [tagKey]: 'r-1' }),
          change_time: NOW.toISOString(),
          delete_time: null,
        },
      ],
    };
    return buildSnapshot(found, parseEvidence(rows), NOW).counts.deploysToday;
  };

  it('uses promotion.tagKey for the job-tag source, over options.releaseTagKey', () => {
    const options = { releaseTagKey: 'version' };

    expect(deploysTagged('train', options, jobTag)).toBe(1);
    expect(deploysTagged('version', options, jobTag)).toBe(0);
    expect(deploysTagged('release', options, jobTag)).toBe(0);
  });

  it('ignores promotion.tagKey for other sources', () => {
    const gitTag = { ...jobTag, source: 'git-tag' as const };

    expect(deploysTagged('train', undefined, gitTag)).toBe(0);
    expect(deploysTagged('release', undefined, gitTag)).toBe(1);
  });

  it('falls back to options.releaseTagKey, then release', () => {
    expect(deploysTagged('version', { releaseTagKey: 'version' }, undefined)).toBe(1);
    expect(deploysTagged('release', undefined, undefined)).toBe(1);
  });
});

describe('events', () => {
  const rows: RowSets = {
    pipeline_updates: [
      update('stream', 'a', 90, 80, 'COMPLETED'),
      update('batch', 'b', 100, 60, 'COMPLETED'),
      update('silver', 'c', 70, 65, 'COMPLETED', 'fin'),
      update('gold', 'd', 55, 50, 'COMPLETED'),
      update('gold', 'e', 150, 140, 'FAILED'),
    ],
    job_runs: [
      jobRun('xfer', 'f', 45, 40, 'SUCCEEDED'),
      jobRun('ml', 'g', 35, 30, 'SUCCEEDED'),
      jobRun('fin', 'h', 30, 25, 'SUCCEEDED'),
      jobRun('unlisted', 'i', 30, 25, 'SUCCEEDED'),
    ],
    lineage_writes: [
      {
        event_minute: ago(20),
        entity_type: 'NOTEBOOK',
        target_table_catalog: 'prod_sales',
        target_table_schema: 'retail_sales_silver',
      },
      {
        event_minute: ago(19),
        entity_type: 'NOTEBOOK',
        target_table_catalog: 'prod_landing',
        target_table_schema: 'landing_bronze',
      },
      {
        event_minute: ago(18),
        entity_type: 'NOTEBOOK',
        target_table_catalog: 'prod_landing',
        target_table_schema: 'landing_silver',
      },
      {
        event_minute: ago(17),
        entity_type: 'NOTEBOOK',
        target_table_catalog: 'unscoped',
        target_table_schema: 'tmp',
      },
    ],
    station_reads: [
      {
        read_minute: ago(15),
        source_table_catalog: 'prod_sales',
        source_table_schema: 'retail_sales_gold',
        statements: '4',
      },
      {
        read_minute: ago(14),
        source_table_catalog: 'legacy_wh',
        source_table_schema: 'erp',
        statements: '2',
      },
      {
        read_minute: ago(13),
        source_table_catalog: 'prod_sales',
        source_table_schema: 'retail_sales_silver',
        statements: '2',
      },
    ],
    pipeline_expectations: [
      {
        workspace_id: '1',
        pipeline_id: 'stream',
        event_minute: ago(12),
        passed: '10',
        failed: '0',
      },
      {
        workspace_id: '1',
        pipeline_id: 'stream',
        event_minute: ago(11),
        passed: '10',
        failed: '3',
      },
    ],
    job_changes: [
      {
        workspace_id: '1',
        job_id: 'ml',
        name: 'ml',
        tags_json: '{"release":"r-7"}',
        change_time: ago(10),
      },
      { workspace_id: '1', job_id: 'ml', name: 'ml', tags_json: '{}', change_time: ago(9) },
    ],
  };
  const all = eventsOf(rows, 160);
  const typed = <T extends PlatformEvent['type']>(type: T) =>
    all.filter((e): e is Extract<PlatformEvent, { type: T }> => e.type === type);

  it('maps runs to vehicles by spoke role, tier, and tags', () => {
    expect(typed('source.stream').map((e) => [e.sourceGroupId, e.siteId, e.spokeId])).toEqual([
      ['region-a', 'region-a-1', 'ingest'],
    ]);
    expect(typed('source.batch').map((e) => [e.sourceGroupId, e.size])).toEqual([['region-b', 4]]);
    expect(typed('transfer').map((e) => [e.fromSpokeId, e.hubId, e.tier])).toContainEqual([
      'ingest',
      'core',
      'silver',
    ]);
    expect(typed('ml.run').map((e) => e.spokeId)).toEqual(['sales']);
    const published = typed('product.publish').map((e) => [e.spokeId, e.tier, e.workload]);
    expect(published).toContainEqual(['sales', 'gold', 'transform']);
    expect(published).toContainEqual(['finance', 'gold', 'transform']);
  });

  it('skips pipeline updates triggered by an attributed job, and runs of unknown objects', () => {
    expect(typed('copy').filter((e) => e.spokeId === 'sales')).toHaveLength(1);
    expect(all.some((e) => e.type === 'source.batch' && e.siteId === 'nope')).toBe(false);
  });

  it('turns lineage writes of other entities into copies and products, ignoring unscoped schemas', () => {
    const fromLineage = all.filter(
      (e) => e.ts === ago(20) || e.ts === ago(18) || e.ts === ago(19) || e.ts === ago(17),
    );

    expect(fromLineage.map((e) => e.type)).toEqual(['copy', 'transfer']);
  });

  it('maps reads to use cases by schema and foreign reads to comets', () => {
    expect(typed('serve.read').map((e) => [e.useCaseId, e.spokeId, e.tier])).toEqual([
      ['readers', 'sales', 'gold'],
    ]);
    expect(typed('federation.query').map((e) => e.foreignCatalogId)).toEqual(['legacy_wh']);
  });

  it('maps expectations to gate passes and rejects, and tagged job changes to deploys', () => {
    expect(typed('ingest.gate').map((e) => [e.spokeId, e.result])).toEqual([
      ['ingest', 'pass'],
      ['ingest', 'reject'],
    ]);
    expect(typed('deploy').map((e) => [e.release, e.spokeId])).toEqual([['r-7', 'sales']]);
  });

  it('emits freshness transitions on refresh and when a spoke crosses its target', () => {
    const fresh = typed('freshness.change');
    const refresh = fresh.find((e) => e.spokeId === 'ingest' && !e.pastTarget);
    const crossing = fresh.find((e) => e.spokeId === 'ingest' && e.pastTarget);

    expect(refresh).toMatchObject({ ageMinutes: 0, targetMinutes: 21 });
    expect(crossing?.ageMinutes).toBe(21.6);
    expect(Date.parse(crossing?.ts ?? '')).toBe(Date.parse(ago(40)) + 21 * 1.03 * MIN);
  });

  it('opens and closes alerts around failures and recoveries', () => {
    const open = typed('alert.open');
    const close = typed('alert.close');

    expect(open.map((e) => e.alert.targets)).toEqual([['spoke:sales']]);
    expect(close.map((e) => e.alertId)).toEqual([open[0]?.alert.id]);
    expect(Date.parse(close[0]?.ts ?? '')).toBeGreaterThan(Date.parse(open[0]?.ts ?? ''));
  });

  it('references only topology objects and stays inside the window, sorted', () => {
    expect(() =>
      checkEvents(
        all,
        discovery.topology,
        { since: new Date(NOW.getTime() - 160 * MIN), until: NOW },
        new Set(),
      ),
    ).not.toThrow();
    expect(all.length).toBeGreaterThan(10);
  });

  it('is deterministic and splits cleanly across windows', () => {
    const whole = eventsOf(rows, 120, 0);
    const first = eventsOf(rows, 120, 60);
    const second = eventsOf(rows, 60, 0);

    expect(eventsOf(rows, 120, 0)).toEqual(whole);
    expect([...first, ...second]).toEqual(whole);
  });

  it('gives every event a stable identity', () => {
    const items = buildEvents(discovery, parseEvidence(rows), {
      since: new Date(NOW.getTime() - 120 * MIN),
      until: NOW,
    });

    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('skips rows it cannot understand instead of guessing', () => {
    const noisy: RowSets = {
      job_runs: [
        { workspace_id: '1', job_id: 'xfer' },
        {
          workspace_id: '1',
          job_id: 'xfer',
          run_id: 'z',
          ended_at: 'not a time',
          result_state: 'SUCCEEDED',
        },
      ],
      station_reads: [{ read_minute: 'bad' }],
      lineage_writes: [{}],
    };

    expect(() => eventsOf(noisy)).not.toThrow();
  });
});

describe('late system-table data', () => {
  // One refresh finished 80 minutes ago; the ingest spoke crosses its target 21.63 minutes later,
  // that is 58.4 minutes ago: newer than the 60 minute ingestion lag.
  const rows: RowSets = { pipeline_updates: [update('stream', 'a', 90, 80, 'COMPLETED')] };
  const crossings = (liveNowMs: number | undefined, extra: RowSets = {}): PlatformEvent[] =>
    buildEvents(
      discovery,
      parseEvidence({ ...rows, ...extra }),
      { since: new Date(NOW.getTime() - 180 * MIN), until: new Date(NOW.getTime() + 60 * MIN) },
      liveNowMs === undefined ? {} : { liveNowMs },
    )
      .map((item) => item.event)
      .filter((e) => e.type === 'freshness.change' && e.pastTarget);

  it('holds back a crossing newer than the ingestion lag in live mode', () => {
    expect(crossings(NOW.getTime())).toEqual([]);
  });

  it('emits the held crossing once the lag has passed and no refresh arrived', () => {
    expect(crossings(NOW.getTime() + 5 * MIN)).toHaveLength(1);
  });

  it('never emits it when a late refresh landed inside the window', () => {
    const refreshed: RowSets = { pipeline_updates: [update('stream', 'b', 70, 65, 'COMPLETED')] };
    const events = crossings(NOW.getTime() + 5 * MIN, {
      pipeline_updates: [...(rows.pipeline_updates ?? []), ...(refreshed.pipeline_updates ?? [])],
    });

    expect(events.map((e) => e.ts)).not.toContain(iso(NOW.getTime() - 80 * MIN + 21.63 * MIN));
  });

  it('leaves bounded replays unchanged', () => {
    expect(crossings(undefined)).toHaveLength(1);
  });
});
