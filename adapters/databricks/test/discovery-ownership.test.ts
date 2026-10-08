// SPDX-License-Identifier: Apache-2.0
// Catalog ownership across environments: tag-scope fallback, workspace-aware conflicts, and
// platform catalogs.
import { describe, expect, it } from 'vitest';
import type { ResolvedEnvironment } from '@orrery/core';
import { SqlError } from '../src/contracts.js';
import { FixtureWorld } from './support/fixture-client.js';
import { PROD_SCENARIOS, at, prodEnv, started, stgEnv } from './support/env.js';
import { catalog, discover, inventory } from './support/inventory.js';

const env = prodEnv();
const stg = stgEnv();
const sharing = (id: string, extra: Record<string, unknown>): ResolvedEnvironment =>
  ({
    ...stg,
    id,
    connection: env.connection,
    federation: env.federation,
    ...extra,
  }) as ResolvedEnvironment;
const unscoped = (): ResolvedEnvironment => {
  const open: ResolvedEnvironment = { ...env };
  delete (open as { scope?: unknown }).scope;
  return open;
};

describe('tag scope fallback', () => {
  const tagPeer = sharing('tagged', { scope: { tag: { env: 'tagged' } } });

  it('does not let an unscoped environment claim catalogs when tags could not be read', () => {
    const open = unscoped();
    const inv = inventory({
      catalogs: [catalog('ledger'), catalog('other')],
      tagsUnavailable: true,
    });

    const result = discover(open, [inv], [open, tagPeer]);

    expect([...result.model.scopedCatalogs]).toEqual([]);
    expect(result.health.status).toBe('error');
    expect(result.health.messages.join(' ')).toContain('catalog_tags');
  });

  it('still claims unclaimed catalogs when tags are readable or no environment uses tags', () => {
    const open = unscoped();
    const failed = inventory({ catalogs: [catalog('other')], tagsUnavailable: true });
    const fine = inventory({ catalogs: [catalog('other')] });

    expect([...discover(open, [fine], [open, tagPeer]).model.scopedCatalogs]).toEqual(['other']);
    const noTags = discover(
      open,
      [failed],
      [open, sharing('globbed', { scope: { catalogs: ['g_*'] } })],
    );
    expect([...noTags.model.scopedCatalogs]).toEqual(['other']);
    expect(noTags.health.status).toBe('ok');
  });

  it('reports an error naming catalog_tags when the query fails in a real adapter', async () => {
    const world = new FixtureWorld(PROD_SCENARIOS);
    world.failQuery('*', 'catalog_tags', new SqlError('permission_denied', 'No access.'));
    const adapter = await started(env, world, at('10:15'), { peers: [env, tagPeer] });

    const health = await adapter.health();

    expect(health.status).toBe('error');
    expect(health.message).toContain('catalog_tags');
  });
});

describe('cross-workspace peers', () => {
  const rival = (extra: Record<string, unknown>): ResolvedEnvironment =>
    ({ ...stg, id: 'rival', scope: { catalogs: ['prod_*'] }, ...extra }) as ResolvedEnvironment;

  it('ignores peers in another workspace when checking conflicts', () => {
    const prod = { ...env, scope: { catalogs: ['prod_*'] } };
    const inv = inventory({ catalogs: [catalog('prod_sales')] });

    const result = discover(prod, [inv], [prod, rival({})]);

    expect(result.health.status).toBe('ok');
    expect([...result.model.scopedCatalogs]).toEqual(['prod_sales']);
  });

  it('ignores peers whose targets cannot resolve', () => {
    const prod = { ...env, scope: { catalogs: ['prod_*'] } };
    const broken = rival({ connection: { host: '${env:NOT_SET}', warehouseId: 'w' } });
    const inv = inventory({ catalogs: [catalog('prod_sales')] });

    expect(discover(prod, [inv], [prod, broken]).health.status).toBe('ok');
  });

  it('still reports conflicts with a peer in the same workspace', () => {
    const prod = { ...env, scope: { catalogs: ['prod_*'] } };
    const inv = inventory({ catalogs: [catalog('prod_sales')] });

    const result = discover(
      prod,
      [inv],
      [prod, rival({ connection: env.connection, federation: env.federation })],
    );

    expect(result.health.status).toBe('error');
  });

  it('lets an unscoped environment own what only another workspace claims', () => {
    const open = unscoped();
    const inv = inventory({ catalogs: [catalog('prod_sales')] });

    const result = discover(open, [inv], [open, rival({})]);

    expect([...result.model.scopedCatalogs]).toEqual(['prod_sales']);
  });
});

describe('platform catalogs', () => {
  it('never owns system, samples, hive_metastore, or double-underscore catalogs', () => {
    const open = unscoped();
    const inv = inventory({
      catalogs: [
        catalog('system'),
        catalog('SAMPLES'),
        catalog('hive_metastore'),
        catalog('__databricks_internal'),
        catalog('__other_hidden'),
        catalog('real'),
      ],
    });

    const result = discover(open, [inv]);

    expect([...result.model.scopedCatalogs]).toEqual(['real']);
  });

  it('keeps double-underscore catalogs out of the unmatched list', () => {
    const inv = inventory({
      catalogs: [catalog('prod_sales'), catalog('__other_hidden'), catalog('lab')],
    });

    expect(discover(env, [inv]).health.unmatchedCatalogs).toEqual(['lab']);
  });
});
