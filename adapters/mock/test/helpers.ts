// SPDX-License-Identifier: Apache-2.0
import type { AdapterContext, ResolvedEnvironment } from '@orrery/core';
import { FixedClock, loadExampleEnvironment, silentLogger } from '@orrery/testkit';
import { MockAdapter } from '../src/index.js';

/** A fixed day used across the mock tests: a Wednesday in the middle of a 31-day month. */
export const DAY = '2026-10-07';
export const at = (hhmm: string, day = DAY): Date => new Date(`${day}T${hhmm}:00.000Z`);

export function demoEnv(envId: 'dev' | 'stg' | 'prod'): ResolvedEnvironment {
  return loadExampleEnvironment('demo.yaml', envId);
}

export function context(
  now: Date,
  env: Record<string, string | undefined> = {},
): AdapterContext & { clock: FixedClock } {
  return { clock: new FixedClock(now), logger: silentLogger, env };
}

export async function started(
  env: ResolvedEnvironment,
  now: Date = at('12:00'),
  vars: Record<string, string | undefined> = {},
): Promise<MockAdapter> {
  const adapter = new MockAdapter();
  await adapter.init(env, context(now, vars));
  return adapter;
}
