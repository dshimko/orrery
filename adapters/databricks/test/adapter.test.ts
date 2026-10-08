// SPDX-License-Identifier: Apache-2.0
import { SqlError } from '../src/contracts.js';
import { DatabricksAdapter } from '../src/adapter.js';
import { collect } from '@orrery/testkit';
import { describe, expect, it } from 'vitest';
import { FixtureWorld, staticTokens } from './support/fixture-client.js';
import {
  PROD_SCENARIOS,
  STG_SCENARIOS,
  adapterFor,
  at,
  context,
  prodEnv,
  started,
  stgEnv,
} from './support/env.js';

const denied = new SqlError('permission_denied', 'No access.');
const gone = new SqlError('not_found', 'Table does not exist.');

describe('multi-metastore federation', () => {
  it('queries every metastore and merges the results by id', async () => {
    const world = new FixtureWorld(PROD_SCENARIOS);
    const adapter = await started(prodEnv(), world);

    const topology = await adapter.topology();

    expect(new Set(world.callsTo('catalogs').map((c) => c.metastore))).toEqual(
      new Set(['primary', 'secondary']),
    );
    expect(topology.metastores).toEqual([
      { id: 'primary', name: 'primary', status: 'ok' },
      { id: 'secondary', name: 'secondary', status: 'ok' },
    ]);
    const bySpoke = Object.fromEntries(topology.spokes.map((s) => [s.id, s]));
    expect(bySpoke['sales']?.metastore).toBe('primary');
    expect(bySpoke['finance']?.metastore).toBe('secondary');
    expect(bySpoke['finance']?.isShared).toBe(true);
    expect(bySpoke['finance']?.metrics.products).toBe(7);
    expect(topology.hub.metastore).toBe('primary');
  });

  it('keeps the environment up when one metastore fails, dimming its region', async () => {
    const world = new FixtureWorld(PROD_SCENARIOS);
    world.failQuery('secondary', '*', new SqlError('failed', 'Warehouse is not reachable.'));
    const adapter = await started(prodEnv(), world);

    const topology = await adapter.topology();
    const snapshot = await adapter.snapshot(at('10:15'));
    const health = await adapter.health();

    expect(topology.metastores.map((m) => [m.id, m.status])).toEqual([
      ['primary', 'ok'],
      ['secondary', 'unavailable'],
    ]);
    expect(topology.spokes.map((s) => s.id)).toEqual(['ingest', 'sales', 'finance']);
    expect(topology.spokes.find((s) => s.id === 'finance')?.metrics.pipelines).toBe(0);
    expect(snapshot.spokes).toHaveLength(3);
    expect(health.status).toBe('degraded');
    expect(health.message).toContain('Metastore "secondary" is unavailable');
  });

  it('fails the topology and reports an error when every metastore is down', async () => {
    const world = new FixtureWorld(PROD_SCENARIOS);
    world.failQuery('*', 'catalogs', new SqlError('auth', 'Sign-in failed.'));
    const adapter = await started(prodEnv(), world);

    await expect(adapter.topology()).rejects.toThrow('unavailable');
    await expect(adapter.snapshot(at('10:15'))).rejects.toThrow('unavailable');
    expect((await adapter.health()).status).toBe('error');
  });
});

describe('multi-workspace and single targets', () => {
  it('uses one connection and labels nothing but the primary metastore', async () => {
    const world = new FixtureWorld(STG_SCENARIOS);
    const adapter = await started(stgEnv(), world);

    const topology = await adapter.topology();

    expect(topology.metastores.map((m) => m.id)).toEqual(['primary']);
    expect(new Set(world.calls.map((c) => c.metastore))).toEqual(new Set(['primary']));
  });

  it('fails init with a clear message when the connection is not configured', async () => {
    const adapter = await adapterFor(new FixtureWorld(STG_SCENARIOS));

    await expect(adapter.init(stgEnv(), context(at('10:15'), {}, {}))).rejects.toThrow(/host/);
  });

  it('rejects an incomplete query allowlist', async () => {
    const adapter = new DatabricksAdapter({
      queries: {
        names: () => ['catalogs'],
        get: () => ({ name: 'catalogs', sql: '', source: '' }),
      },
    });

    await expect(adapter.init(stgEnv(), context(at('10:15')))).rejects.toThrow(/missing/);
  });
});

describe('scope conflicts and health', () => {
  it('reports a catalog claimed by another environment as an error naming both', async () => {
    const prod = prodEnv();
    const rival = {
      ...stgEnv(),
      connection: prod.connection,
      federation: prod.federation,
      scope: { catalogs: ['prod_*'] },
    };
    const world = new FixtureWorld(PROD_SCENARIOS);
    const adapter = await started(prod, world, at('10:15'), { peers: [prod, rival] });

    const health = await adapter.health();

    expect(health.status).toBe('error');
    expect(health.message).toContain('prod, stg');
    await expect(adapter.topology()).rejects.toThrow('matches more than one environment');
  });

  it('lists unmatched catalogs and unsupported matchers in health', async () => {
    const adapter = await started(prodEnv(), new FixtureWorld(PROD_SCENARIOS));

    const health = await adapter.health();

    expect(health.status).toBe('ok');
    expect(health.unmatchedCatalogs).toEqual(['stg_sales', 'scratch_lab']);
    expect(health.message).toContain('dashboardTag');
  });
});

describe('optional queries degrade instead of failing', () => {
  it('treats a missing Beta table and a denied preview table as degraded health', async () => {
    const world = new FixtureWorld(PROD_SCENARIOS);
    world.failQuery('*', 'pipeline_expectations', gone);
    world.failQuery('*', 'table_freshness', denied);
    world.failQuery('*', 'catalog_tags', gone);
    const adapter = await started(prodEnv(), world);

    const snapshot = await adapter.snapshot(at('10:15'));
    const events = await collect(adapter.events(at('10:15'), at('11:15')));
    const health = await adapter.health();

    expect(snapshot.spokes.find((s) => s.id === 'ingest')?.ageMinutes).not.toBe(5);
    expect(events.some((e) => e.type === 'ingest.gate')).toBe(false);
    expect(events.length).toBeGreaterThan(0);
    expect(health.status).toBe('degraded');
    expect(health.message).toContain('pipeline_expectations@primary');
    expect(health.message).toContain('table_freshness@primary');
  });

  it('recovers to ok once the optional query works again', async () => {
    const world = new FixtureWorld(STG_SCENARIOS);
    const ctx = context(at('10:15'));
    const adapter = await adapterFor(world);
    await adapter.init(stgEnv(), ctx);
    world.failQuery('*', 'billing_usage', gone);
    await adapter.snapshot(at('10:15'));
    expect((await adapter.health()).status).toBe('degraded');

    world.clearFailures();
    ctx.clock.advance(10 * 60_000);
    await adapter.snapshot(at('10:25'));

    expect((await adapter.health()).status).toBe('ok');
  });

  it('flags a result that hit its row limit', async () => {
    const world = new FixtureWorld(STG_SCENARIOS);
    const adapter = await started(stgEnv(), world);
    const rows = Array.from({ length: 5000 }, (_, i) => ({ catalog_name: `stg_c${i}` }));
    const original = world.rowsFor.bind(world);
    world.rowsFor = (metastore, query) =>
      query === 'catalogs' ? rows : original(metastore, query);

    await adapter.topology();

    expect((await adapter.health()).message).toContain('Query catalogs@primary hit its row limit');
  });
});

describe('on-behalf-of-user isolation', () => {
  it('never serves one viewer the cached results of another', async () => {
    const world = new FixtureWorld(STG_SCENARIOS);
    let viewer = 'obo:alice';
    const adapter = await started(
      stgEnv(),
      world,
      at('10:15'),
      {},
      {
        tokensFor: () => ({ token: async () => 't', cacheKey: () => viewer }),
      },
    );

    await adapter.topology();
    await adapter.topology();
    const aliceCalls = world.callsTo('catalogs').length;
    viewer = 'obo:bob';
    await adapter.topology();
    const afterBob = world.callsTo('catalogs').length;
    viewer = 'obo:alice';
    await adapter.topology();

    expect(aliceCalls).toBe(1);
    expect(afterBob).toBe(2);
    expect(world.callsTo('catalogs').length).toBe(2);
  });

  it('reports degraded optional queries and row limits only to the viewer who hit them', async () => {
    const world = new FixtureWorld(STG_SCENARIOS);
    let viewer = 'obo:alice';
    const adapter = await started(
      stgEnv(),
      world,
      at('10:15'),
      {},
      { tokensFor: () => ({ token: async () => 't', cacheKey: () => viewer }) },
    );
    world.failQuery('*', 'billing_usage', denied);
    await adapter.snapshot(at('10:15'));
    world.clearFailures();
    viewer = 'obo:bob';
    await adapter.snapshot(at('10:15'));

    const bob = await adapter.health();
    viewer = 'obo:alice';
    const alice = await adapter.health();

    expect(bob.status).toBe('ok');
    expect(bob.message ?? '').not.toContain('billing_usage');
    expect(alice.status).toBe('degraded');
    expect(alice.message).toContain('billing_usage@primary');
  });

  it('shares results between calls of the same service principal', async () => {
    const world = new FixtureWorld(STG_SCENARIOS);
    const adapter = await started(
      stgEnv(),
      world,
      at('10:15'),
      {},
      {
        tokensFor: () => staticTokens('sp'),
      },
    );

    await adapter.snapshot(at('10:15'));
    await adapter.snapshot(at('10:15'));

    expect(world.callsTo('job_runs')).toHaveLength(1);
  });
});

describe('promotion tag key', () => {
  it('reads releases from the context promotion.tagKey when the source is job-tag', async () => {
    const promotion = { order: ['stg', 'prod'], source: 'job-tag' as const, tagKey: 'train' };
    const plain = await started(prodEnv(), new FixtureWorld(PROD_SCENARIOS));
    const keyed = await started(prodEnv(), new FixtureWorld(PROD_SCENARIOS), at('10:15'), {
      promotion,
    });

    const before = await plain.snapshot(at('10:15'));
    const after = await keyed.snapshot(at('10:15'));

    expect(before.counts.deploysToday).toBeGreaterThan(0);
    expect(after.counts.deploysToday).toBe(0);
  });
});

describe('lifecycle', () => {
  it('refuses use before init and after dispose', async () => {
    const adapter = await adapterFor(new FixtureWorld(STG_SCENARIOS));
    await expect(adapter.topology()).rejects.toThrow('before init');

    await adapter.init(stgEnv(), context(at('10:15')));
    await adapter.dispose();

    await expect(adapter.snapshot()).rejects.toThrow('after dispose');
  });
});
