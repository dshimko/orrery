// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { ResolvedEnvironment } from '@orrery/core';
import { complexityOf } from '../src/discovery/build.js';
import { highestTier, tierOf } from '../src/discovery/medallion.js';
import { objectMatches, schemaMatches, unsupportedClauses } from '../src/discovery/matchers.js';
import { prodEnv, stgEnv, withTopology } from './support/env.js';
import { catalog, discover, inventory, job, pipeline, schema, write } from './support/inventory.js';

const env = prodEnv();
const stg = stgEnv();
/** The staging environment as a peer that lives in prod's workspace and metastores. */
const sharedStg: ResolvedEnvironment = {
  ...stg,
  connection: env.connection,
  federation: env.federation,
} as ResolvedEnvironment;
const spokeOf = (d: ReturnType<typeof discover>, id: string) =>
  d.topology.spokes.find((s) => s.id === id);

describe('environment scope', () => {
  it('claims prefix and suffix catalogs, case-insensitively, and lists the rest', () => {
    const inv = inventory({
      catalogs: [
        catalog('PROD_Sales'),
        catalog('sales_PROD'),
        catalog('stg_sales'),
        catalog('scratch_lab'),
        catalog('system'),
      ],
      schemas: [schema('PROD_Sales', 'retail_sales_gold'), schema('sales_PROD', 'eu_sales_gold')],
    });

    const result = discover(env, [inv], [env, sharedStg]);

    expect([...result.model.scopedCatalogs].sort()).toEqual(['prod_sales', 'sales_prod']);
    expect(result.health.unmatchedCatalogs).toEqual(['scratch_lab']);
    expect(spokeOf(result, 'sales')?.metrics.products).toBe(2);
    expect(result.model.schemas.size).toBe(2);
  });

  it('resolves both catalog forms to the same spoke through the stripped base name', () => {
    const catalogMatcher = withTopology(env, {
      spokes: env.resolvedTopology.spokes.map((s) =>
        s.id === 'sales' ? { ...s, match: { catalog: 'sales' } } : s,
      ),
    });
    const inv = inventory({
      catalogs: [catalog('prod_sales'), catalog('sales_prod')],
      schemas: [schema('prod_sales', 'a'), schema('sales_prod', 'b')],
    });

    const result = discover(catalogMatcher, [inv]);

    expect([...result.model.schemas.values()].map((s) => s.spokeId)).toEqual(['sales', 'sales']);
  });

  it('claims catalogs by tag when the name follows neither form', () => {
    const tagged = { ...env, scope: { tag: { env: 'prod' } } };
    const inv = inventory({
      catalogs: [catalog('ledger', { env: 'PROD' }), catalog('other', { env: 'dev' })],
    });

    const result = discover(tagged, [inv]);

    expect([...result.model.scopedCatalogs]).toEqual(['ledger']);
    expect(result.health.unmatchedCatalogs).toEqual(['other']);
  });

  it('reports a catalog claimed by two environments as an error naming both', () => {
    const wide = { ...sharedStg, scope: { catalogs: ['*_sales'] } };
    const prod = { ...env, scope: { catalogs: ['prod_*'] } };
    const inv = inventory({ catalogs: [catalog('prod_sales')] });

    const result = discover(prod, [inv], [prod, wide]);

    expect(result.health.status).toBe('error');
    expect(result.health.messages.join(' ')).toContain('"prod_sales"');
    expect(result.health.messages.join(' ')).toContain('prod, stg');
  });

  it('owns every catalog no peer claims when the environment has no scope', () => {
    const open: ResolvedEnvironment = { ...env };
    delete (open as { scope?: unknown }).scope;
    const inv = inventory({ catalogs: [catalog('anything'), catalog('stg_sales')] });

    const result = discover(open, [inv], [open, sharedStg]);

    expect([...result.model.scopedCatalogs]).toEqual(['anything']);
    expect(result.health.unmatchedCatalogs).toEqual([]);
  });
});

describe('spoke matching', () => {
  const inv = inventory({
    catalogs: [catalog('prod_landing', { domain: 'ingest' }), catalog('prod_sales')],
    schemas: [
      schema('prod_landing', 'landing_bronze'),
      schema('prod_sales', 'retail_sales_gold', { audience: 'finance' }),
      schema('prod_sales', 'misc'),
    ],
  });

  it('matches by catalog tag, schema glob, and schema tag', () => {
    const custom = withTopology(env, {
      spokes: [
        ...env.resolvedTopology.spokes,
        {
          id: 'audit',
          name: 'Audit',
          role: 'domain',
          match: { tag: { audience: 'finance' } },
          freshness: { cadenceMinutes: 60, targetMinutes: 90, offsetMinutes: 0 },
        },
      ],
    });

    const result = discover(custom, [inv]);
    const owner = (key: string) => result.model.schemas.get(key)?.spokeId;

    expect(owner('prod_landing.landing_bronze')).toBe('ingest');
    expect(owner('prod_sales.retail_sales_gold')).toBe('sales');
    expect(owner('prod_sales.misc')).toBeUndefined();
    expect(spokeOf(result, 'audit')?.metrics.pipelines).toBe(0);
  });

  it('assigns pipelines and jobs by their tags, and by the schemas they write', () => {
    const withObjects = inventory({
      ...inv,
      objects: [
        pipeline('tagged', { source_region: 'a' }),
        pipeline('by-write'),
        job('job-by-write'),
        pipeline('nowhere'),
      ],
      writes: [
        write('pipeline', 'by-write', 'prod_sales', 'retail_sales_gold'),
        write('job', 'job-by-write', 'prod_sales', 'retail_sales_gold'),
      ],
    });

    const result = discover(env, [withObjects]);
    const objects = result.model.objects;

    expect(objects.get('pipeline:1:tagged')?.groupId).toBe('region-a');
    expect(objects.get('pipeline:1:tagged')?.spokeId).toBe('ingest');
    expect(objects.get('pipeline:1:by-write')?.spokeId).toBe('sales');
    expect(objects.get('job:1:job-by-write')?.spokeId).toBe('sales');
    expect(objects.has('pipeline:1:nowhere')).toBe(false);
    expect(spokeOf(result, 'sales')?.metrics.pipelines).toBe(2);
  });

  it('drops objects that only write to catalogs of another environment', () => {
    const other = inventory({
      ...inv,
      catalogs: [...inv.catalogs, catalog('stg_sales')],
      objects: [pipeline('elsewhere', { source_region: 'a' })],
      writes: [write('pipeline', 'elsewhere', 'stg_sales', 'retail_sales_gold')],
    });

    const result = discover(env, [other], [env, stg]);

    expect(result.model.objects.size).toBe(0);
  });

  it('counts products as tables in gold schemas, falling back to gold schema count', () => {
    const counts = inventory({
      ...inv,
      tableCounts: new Map([['prod_sales.retail_sales_gold', 9]]),
    });

    expect(spokeOf(discover(env, [counts]), 'sales')?.metrics.products).toBe(9);
    expect(spokeOf(discover(env, [inv]), 'sales')?.metrics.products).toBe(1);
  });

  it('flags ML objects by tag or name and marks cross-metastore spokes as shared', () => {
    const ml = inventory({
      ...inv,
      objects: [job('forecast', { workload: 'ml' }), pipeline('x', {}, { name: 'Churn scoring' })],
      writes: [
        write('job', 'forecast', 'prod_sales', 'retail_sales_gold'),
        write('pipeline', 'x', 'prod_sales', 'retail_sales_gold'),
      ],
    });

    const result = discover(env, [ml]);

    expect(spokeOf(result, 'sales')?.hasMl).toBe(true);
    expect(spokeOf(result, 'ingest')?.hasMl).toBe(false);
    expect(spokeOf(result, 'sales')?.isShared).toBe(false);
  });
});

describe('matcher semantics', () => {
  const facts = { base: 'sales', schema: 'retail_sales_gold', tags: { domain: 'Sales' } };

  it('requires every schema clause and ignores case in tag values', () => {
    expect(
      schemaMatches({ catalog: 's*', schema: '*_gold', tag: { domain: 'sales' } }, facts),
    ).toBe(true);
    expect(schemaMatches({ catalog: 'fin*', schema: '*_gold' }, facts)).toBe(false);
    expect(schemaMatches({ tag: { domain: 'finance' } }, facts)).toBe(false);
  });

  it('never matches a matcher without schema clauses or with unsupported ones', () => {
    expect(schemaMatches({ pipelineTag: { a: 'b' } }, facts)).toBe(false);
    expect(schemaMatches({ schema: '*', sqlPredicate: 'x = 1' }, facts)).toBe(false);
    expect(objectMatches({ dashboardTag: { a: 'b' } }, 'job', { a: 'b' }, [])).toBe(false);
    expect(unsupportedClauses({ sqlPredicate: 'x', dashboardTag: { a: 'b' } })).toEqual([
      'sqlPredicate',
      'dashboardTag',
    ]);
  });

  it('applies pipelineTag to pipelines only and jobTag to jobs only', () => {
    const pipelineOnly = { pipelineTag: { team: 'x' } };
    expect(objectMatches(pipelineOnly, 'pipeline', { team: 'x' }, [])).toBe(true);
    expect(objectMatches(pipelineOnly, 'job', { team: 'x' }, [])).toBe(false);
    expect(objectMatches({ jobTag: { team: 'x' } }, 'job', { team: 'x' }, [])).toBe(true);
  });

  it('checks schema clauses against written schemas when workload tags also match', () => {
    const both = { pipelineTag: { team: 'x' }, schema: '*_gold' };
    expect(objectMatches(both, 'pipeline', { team: 'x' }, [facts])).toBe(true);
    expect(objectMatches(both, 'pipeline', { team: 'x' }, [{ ...facts, schema: 'raw' }])).toBe(
      false,
    );
  });
});

describe('medallion tiers', () => {
  const subject = { catalog: 'prod_core', base: 'core', schema: 'x_silver', tags: {} };

  it('classifies by schema suffix, catalog prefix, or tag', () => {
    const globs = { bronze: ['b*'], silver: ['*_silver', 's*'], gold: ['g*'] };
    expect(tierOf({ strategy: 'schema-suffix', ...globs }, subject)).toBe('silver');
    expect(
      tierOf({ strategy: 'catalog-prefix', ...globs }, { ...subject, base: 'gold_core' }),
    ).toBe('gold');
    const tagged = { ...subject, tags: { Medallion: 'bronze_zone' } };
    expect(tierOf({ strategy: 'tag', ...globs }, tagged)).toBe('bronze');
    expect(
      tierOf({ strategy: 'schema-suffix', ...globs }, { ...subject, schema: 'plain' }),
    ).toBeUndefined();
    expect(tierOf(undefined, subject)).toBeUndefined();
  });

  it('picks the highest tier of several', () => {
    expect(highestTier(['bronze', undefined, 'gold', 'silver'])).toBe('gold');
    expect(highestTier([])).toBeUndefined();
  });
});

describe('complexity heuristic', () => {
  it('stays within 0 to 5 and grows with size', () => {
    expect(complexityOf(0, 0)).toBe(0);
    expect(complexityOf(3, 3)).toBeLessThan(complexityOf(30, 30));
    expect(complexityOf(10_000_000, 10_000_000)).toBe(5);
  });
});

describe('foreign catalogs', () => {
  const foreign = inventory({
    catalogs: [
      catalog('prod_sales'),
      catalog('legacy_wh'),
      catalog('stg_erp'),
      catalog('prod_erp'),
    ],
    schemas: [schema('legacy_wh', 'erp')],
    foreign: ['legacy_wh', 'stg_erp', 'prod_erp'],
  });

  it('draws unclaimed and in-scope foreign catalogs as comets, never as spokes', () => {
    const result = discover(env, [foreign], [env, sharedStg]);

    expect(result.topology.foreignCatalogs.map((c) => c.name).sort()).toEqual([
      'legacy_wh',
      'prod_erp',
    ]);
    expect(result.model.schemas.size).toBe(0);
    expect(result.health.unmatchedCatalogs).toEqual([]);
  });

  it('hides comets when foreignCatalogs.show is false', () => {
    const hidden = {
      ...env,
      federation: {
        mode: 'multi-metastore' as const,
        ...env.federation,
        foreignCatalogs: { show: false },
      },
    } as ResolvedEnvironment;

    expect(discover(hidden, [foreign]).topology.foreignCatalogs).toEqual([]);
  });
});
