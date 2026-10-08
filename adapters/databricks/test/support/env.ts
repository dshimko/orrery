// SPDX-License-Identifier: Apache-2.0
// Shared builders for tests: example environments, adapter contexts, and a fixed test day.
import type { AdapterContext, ResolvedEnvironment } from '@orrery/core';
import { FixedClock, loadExampleEnvironment, silentLogger } from '@orrery/testkit';
import { DatabricksAdapter, type DatabricksDeps } from '../../src/adapter.js';
import { loadQueryRegistry } from '../../src/registry.js';
import type { FixtureWorld } from './fixture-client.js';

export const DAY = '2026-10-07';
export const at = (hhmm: string, day = DAY): Date => new Date(`${day}T${hhmm}:00.000Z`);

export const CONNECTION_ENV: Record<string, string> = {
  ORRERY_STG_HOST: 'stg.example.invalid',
  ORRERY_STG_WAREHOUSE: 'wh-stg',
  ORRERY_PROD_HOST: 'primary.example.invalid',
  ORRERY_PROD_WAREHOUSE: 'wh-primary',
  ORRERY_PROD2_HOST: 'secondary.example.invalid',
  ORRERY_PROD2_WAREHOUSE: 'wh-secondary',
};

export const PROD_SCENARIOS = { primary: 'prod-primary', secondary: 'prod-secondary' } as const;
export const STG_SCENARIOS = { primary: 'stg' } as const;

export const prodEnv = (): ResolvedEnvironment => loadExampleEnvironment('three-env.yaml', 'prod');
export const stgEnv = (): ResolvedEnvironment => loadExampleEnvironment('three-env.yaml', 'stg');

type Topo = ResolvedEnvironment['resolvedTopology'];

/** A copy of `env` with parts of its resolved topology replaced. */
export function withTopology(env: ResolvedEnvironment, patch: Partial<Topo>): ResolvedEnvironment {
  return { ...env, resolvedTopology: { ...env.resolvedTopology, ...patch } };
}

export function context(
  now: Date,
  extra: Partial<Omit<AdapterContext, 'clock'>> = {},
  env: Record<string, string | undefined> = CONNECTION_ENV,
): AdapterContext & { clock: FixedClock } {
  return { clock: new FixedClock(now), logger: silentLogger, env, ...extra };
}

/** An adapter on the real query registry, so tests also prove every shipped .sql passes the guard. */
export async function adapterFor(
  world: FixtureWorld,
  deps: Partial<DatabricksDeps> = {},
): Promise<DatabricksAdapter> {
  return new DatabricksAdapter({
    queries: await loadQueryRegistry(),
    clientFor: world.clientFor,
    tokensFor: world.tokensFor,
    ...deps,
  });
}

export async function started(
  env: ResolvedEnvironment,
  world: FixtureWorld,
  now: Date = at('10:15'),
  extra: Partial<Omit<AdapterContext, 'clock'>> = {},
  deps: Partial<DatabricksDeps> = {},
): Promise<DatabricksAdapter> {
  const adapter = await adapterFor(world, deps);
  await adapter.init(env, context(now, extra));
  return adapter;
}
