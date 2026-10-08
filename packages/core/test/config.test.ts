// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  configJsonSchema,
  envRefName,
  parseConfig,
  parseConfigOrThrow,
  validateConfig,
  type ConfigResult,
} from '../src/index.js';

const SPOKE = {
  id: 'sales',
  name: 'Sales',
  role: 'domain',
  match: { schema: '*_sales_*' },
  freshness: { cadenceMinutes: 240, targetMinutes: 280 },
};

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    topologies: { base: { hub: { id: 'core', name: 'Core' }, spokes: [SPOKE] } },
    environments: [{ id: 'dev', name: 'Dev', tier: 'dev', topology: 'base', adapter: 'mock' }],
    ...overrides,
  };
}

function issuesOf(result: ConfigResult): string[] {
  if (result.ok) throw new Error('expected validation to fail');
  return result.issues.map((issue) => `${issue.path}: ${issue.message}`);
}

describe('unknown keys', () => {
  it('rejects a misspelled key with its path and a suggested fix', () => {
    const config = baseConfig({
      environments: [
        { id: 'dev', name: 'Dev', tier: 'dev', topology: 'base', adapter: 'mock', mokc: {} },
      ],
    });
    expect(issuesOf(validateConfig(config))).toEqual([
      expect.stringMatching(/^environments\[0\]: Unknown key "mokc"\. Did you mean "mock"\?/),
    ]);
  });

  it('lists the allowed keys when nothing is close', () => {
    const [issue] = issuesOf(validateConfig(baseConfig({ zzzzzzzz: true })));
    expect(issue).toContain('Unknown key "zzzzzzzz".');
    expect(issue).not.toContain('Did you mean');
    expect(issue).toContain('Allowed keys: version, product, adapters, topologies');
  });

  it('rejects unknown keys deep inside visuals', () => {
    const [issue] = issuesOf(validateConfig(baseConfig({ visuals: { camera: { fov: 40 } } })));
    expect(issue).toMatch(/^visuals\.camera: Unknown key "fov"\. Did you mean "fovDeg"\?/);
  });

  it('reports the error with the file name when thrown', () => {
    expect(() => parseConfigOrThrow('version: 1\nbogus: 1\n', 'orrery.config.yaml')).toThrow(
      /^orrery\.config\.yaml: \d+ config problems?\n {2}- /,
    );
    try {
      parseConfigOrThrow('version: 2\n', 'x.yaml');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues.length).toBeGreaterThan(0);
    }
  });
});

describe('secrets', () => {
  const withConnection = (connection: Record<string, unknown>) =>
    baseConfig({
      environments: [
        {
          id: 'prod',
          name: 'Prod',
          tier: 'prod',
          topology: 'base',
          adapter: 'databricks',
          connection: { host: 'h', warehouseId: 'w', ...connection },
        },
      ],
    });

  it('accepts only ${env:NAME} in secret fields', () => {
    expect(validateConfig(withConnection({ token: '${env:ORRERY_TOKEN}' })).ok).toBe(true);
    const [issue] = issuesOf(validateConfig(withConnection({ token: 'dapi-literal' })));
    expect(issue).toMatch(/^environments\[0\]\.connection\.token: Secret fields accept only/);
  });

  it('extracts the variable name from a reference', () => {
    expect(envRefName('${env:ORRERY_TOKEN}')).toBe('ORRERY_TOKEN');
    expect(envRefName('literal')).toBeUndefined();
  });

  it('requires host and warehouse for a non-federated databricks environment', () => {
    const config = baseConfig({
      environments: [
        { id: 'prod', name: 'P', tier: 'prod', topology: 'base', adapter: 'databricks' },
      ],
    });
    expect(issuesOf(validateConfig(config))).toEqual([
      expect.stringContaining('environments[0].connection: The databricks adapter needs'),
    ]);
  });

  it('requires metastores in multi-metastore mode', () => {
    const config = baseConfig({
      environments: [
        {
          id: 'prod',
          name: 'P',
          tier: 'prod',
          topology: 'base',
          adapter: ['databricks'],
          federation: { mode: 'multi-metastore' },
        },
      ],
    });
    expect(issuesOf(validateConfig(config))).toEqual([
      expect.stringContaining('environments[0].federation.metastores: multi-metastore mode'),
    ]);
  });
});

describe('cross references', () => {
  it('flags unknown topology, unknown adapter, and duplicate ids', () => {
    const env = { id: 'dev', name: 'Dev', tier: 'dev', topology: 'bsae', adapter: 'mokc' };
    const issues = issuesOf(validateConfig(baseConfig({ environments: [env, env] })));
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Duplicate environment id "dev"'),
        expect.stringContaining('Unknown topology "bsae". Did you mean "base"?'),
        expect.stringContaining('Unknown adapter "mokc". Did you mean "mock"?'),
      ]),
    );
  });

  it('accepts fork-registered adapters', () => {
    const config = baseConfig({
      adapters: { orchestrator: { package: '@example/orrery-adapter' } },
      environments: [
        { id: 'dev', name: 'D', tier: 'dev', topology: 'base', adapter: ['mock', 'orchestrator'] },
      ],
    });
    expect(validateConfig(config).ok).toBe(true);
  });

  it('checks promotion order against environments', () => {
    const issues = issuesOf(
      validateConfig(
        baseConfig({ promotion: { order: ['dev', 'dve', 'dev'], source: 'job-tag' } }),
      ),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'promotion.order[1]: Unknown environment "dve". Did you mean "dev"?',
        ),
        expect.stringContaining('promotion.order[2]: Environment "dev" appears twice'),
        expect.stringContaining('promotion.tagKey: promotion.source "job-tag" needs a tagKey'),
      ]),
    );
  });

  it('flags extends pointing at a missing topology', () => {
    const topologies = { base: { extends: 'nope', hub: { id: 'c', name: 'C' }, spokes: [SPOKE] } };
    expect(issuesOf(validateConfig(baseConfig({ topologies })))).toEqual([
      expect.stringContaining('topologies.base.extends: Topology "base" extends unknown'),
    ]);
  });
});

describe('topology resolution', () => {
  const topologies = {
    prod: {
      hub: { id: 'core', name: 'Core' },
      spokes: [SPOKE, { ...SPOKE, id: 'finance', name: 'Finance' }],
    },
    stg: { extends: 'prod', spokes: [{ id: 'sales', name: 'Sales (stg)' }] },
  };

  it('merges list entries by id and keeps base fields', () => {
    const result = validateConfig(
      baseConfig({
        topologies,
        environments: [{ id: 'stg', name: 'S', tier: 'stg', topology: 'stg', adapter: 'mock' }],
      }),
    );
    if (!result.ok) throw new Error(issuesOf(result).join('\n'));
    const [sales, finance] = result.config.environments[0]?.resolvedTopology.spokes ?? [];
    expect(sales).toMatchObject({ id: 'sales', name: 'Sales (stg)', role: 'domain' });
    expect(finance?.id).toBe('finance');
  });

  it('applies environment overrides and exclusions', () => {
    const env = {
      id: 'dev',
      name: 'D',
      tier: 'dev',
      topology: 'stg',
      adapter: 'mock',
      overrides: { exclude: ['finance'], hub: { name: 'Core (dev)' } },
    };
    const result = validateConfig(baseConfig({ topologies, environments: [env] }));
    if (!result.ok) throw new Error(issuesOf(result).join('\n'));
    const topology = result.config.environments[0]?.resolvedTopology;
    expect(topology?.hub).toEqual({ id: 'core', name: 'Core (dev)' });
    expect(topology?.spokes.map((s) => s.id)).toEqual(['sales']);
  });

  it('reports incomplete entries after resolution with a path', () => {
    const env = {
      id: 'dev',
      name: 'D',
      tier: 'dev',
      topology: 'prod',
      adapter: 'mock',
      overrides: { spokes: [{ id: 'new', name: 'New' }] },
    };
    const issues = issuesOf(validateConfig(baseConfig({ topologies, environments: [env] })));
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^environments\[0\]\.topology\.spokes\[2\]\.role: .*resolving topology "prod"/,
        ),
      ]),
    );
  });

  it('detects inheritance cycles', () => {
    const cyclic = {
      a: { extends: 'b', hub: { id: 'c', name: 'C' }, spokes: [SPOKE] },
      b: { extends: 'a' },
    };
    const env = { id: 'dev', name: 'D', tier: 'dev', topology: 'a', adapter: 'mock' };
    expect(
      issuesOf(validateConfig(baseConfig({ topologies: cyclic, environments: [env] }))),
    ).toEqual([expect.stringContaining('Topology inheritance cycle: a -> b -> a')]);
  });
});

describe('defaults and YAML', () => {
  it('fills visual defaults from the spec', () => {
    const result = validateConfig(baseConfig());
    if (!result.ok) throw new Error('base config must validate');
    const { visuals } = result.config;
    expect(visuals.world.hubRadius).toBe(5);
    expect(visuals.freshnessOrbit).toEqual({ base: 24, scale: 22, min: 24, max: 104 });
    expect(visuals.camera).toEqual({ fovDeg: 38, tweenRate: 4.5, inertiaDecay: 2.8 });
    expect(visuals.colors.tiers).toEqual({ dev: '#3FC1CF', stg: '#FFB020', prod: '#6EA8FF' });
    expect(visuals.workloads.map((w) => w.id)).toEqual([
      'streaming',
      'batch',
      'transfer',
      'transform',
      'ml',
      'serving',
      'build',
    ]);
    expect(visuals.orloj.dial.center).toEqual([220, 345]);
  });

  it('reports YAML syntax errors and duplicate keys as issues', () => {
    expect(issuesOf(parseConfig('version: 1\nversion: 1\n'))[0]).toMatch(/^\(yaml\): /);
    expect(issuesOf(parseConfig('a: [\n'))[0]).toMatch(/^\(yaml\): /);
  });

  it('rejects sqlPredicate, which was removed from matchers (decision 81)', () => {
    const topologies = {
      base: {
        hub: { id: 'c', name: 'C' },
        spokes: [{ ...SPOKE, match: { schema: '*_sales_*', sqlPredicate: 'x = 1' } }],
      },
    };
    expect(issuesOf(validateConfig(baseConfig({ topologies })))).toEqual([
      expect.stringContaining('Unknown key "sqlPredicate".'),
    ]);
  });

  it('rejects an empty matcher', () => {
    const topologies = {
      base: { hub: { id: 'c', name: 'C' }, spokes: [{ ...SPOKE, match: {} }] },
    };
    expect(issuesOf(validateConfig(baseConfig({ topologies })))).toEqual([
      expect.stringContaining('A matcher needs at least one of'),
    ]);
  });
});

describe('JSON Schema', () => {
  it('is generated from zod and rejects additional properties', () => {
    const schema = configJsonSchema();
    expect(schema.$id).toMatch(/orrery\.config\.schema\.json$/);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties as object)).toEqual(
      expect.arrayContaining(['version', 'topologies', 'environments', 'visuals']),
    );
  });

  it('matches the committed schema file (run `pnpm build` to refresh)', () => {
    const committed = readFileSync(
      resolve(import.meta.dirname, '../schema/orrery.config.schema.json'),
      'utf8',
    );
    expect(JSON.parse(committed)).toEqual(configJsonSchema());
  });
});
