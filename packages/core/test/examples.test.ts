// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/index.js';

const EXAMPLES = resolve(import.meta.dirname, '../../../config/examples');
const files = readdirSync(EXAMPLES).filter((f) => /\.ya?ml$/.test(f));

describe('config/examples', () => {
  it('ships the examples named in the spec', () => {
    expect(files).toEqual(
      expect.arrayContaining(['three-env.yaml', 'single-workspace.yaml', 'multi-metastore.yaml']),
    );
  });

  it.each(files)('%s validates and resolves every environment', (file) => {
    const result = parseConfig(readFileSync(join(EXAMPLES, file), 'utf8'));
    if (!result.ok) expect.fail(result.issues.map((i) => `${i.path}: ${i.message}`).join('\n'));
    for (const env of result.config.environments) {
      expect(env.resolvedTopology.spokes.length).toBeGreaterThan(0);
    }
  });

  it('three-env.yaml mirrors the sample: dev, stg, prod in promotion order', () => {
    const result = parseConfig(readFileSync(join(EXAMPLES, 'three-env.yaml'), 'utf8'));
    if (!result.ok) throw new Error('three-env.yaml must validate');
    const { environments, promotion } = result.config;
    expect(environments.map((e) => [e.id, e.tier, e.adapter])).toEqual([
      ['dev', 'dev', 'mock'],
      ['stg', 'stg', 'databricks'],
      ['prod', 'prod', 'databricks'],
    ]);
    expect(promotion?.order).toEqual(['dev', 'stg', 'prod']);
    expect(environments[0]?.resolvedTopology.spokes.map((s) => s.id)).toEqual([
      'ingest',
      'sales',
      'finance',
    ]);
    expect(environments[1]?.connection?.host).toBe('${env:ORRERY_STG_HOST}');
    expect(environments[2]?.federation?.metastores?.map((m) => m.host)).toEqual([
      '${env:ORRERY_PROD_HOST}',
      '${env:ORRERY_PROD2_HOST}',
    ]);
  });

  it('multi-metastore.yaml dev inherits prod minus the excluded spoke', () => {
    const result = parseConfig(readFileSync(join(EXAMPLES, 'multi-metastore.yaml'), 'utf8'));
    if (!result.ok) throw new Error('multi-metastore.yaml must validate');
    const [dev, prod] = result.config.environments;
    expect(dev?.resolvedTopology.spokes.map((s) => s.id)).toEqual(['ingest', 'finance']);
    expect(prod?.resolvedTopology.spokes.map((s) => s.id)).toEqual([
      'ingest',
      'finance',
      'operations',
    ]);
  });
});
