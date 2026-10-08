// SPDX-License-Identifier: Apache-2.0
import { runAdapterContract } from '@orrery/testkit';
import { FixtureWorld } from './support/fixture-client.js';
import {
  PROD_SCENARIOS,
  STG_SCENARIOS,
  adapterFor,
  at,
  context,
  prodEnv,
  stgEnv,
} from './support/env.js';

const WINDOW_MINUTES = 60;

runAdapterContract(
  'databricks (recorded fixtures, prod: two metastores)',
  async () => {
    const when = at('10:15');
    const world = new FixtureWorld(PROD_SCENARIOS);
    return { adapter: await adapterFor(world), env: prodEnv(), ctx: context(when), at: when };
  },
  { eventWindowMinutes: WINDOW_MINUTES },
);

runAdapterContract(
  'databricks (recorded fixtures, stg: lineage-only freshness)',
  async () => {
    const when = at('10:15');
    const world = new FixtureWorld(STG_SCENARIOS);
    return { adapter: await adapterFor(world), env: stgEnv(), ctx: context(when), at: when };
  },
  { eventWindowMinutes: WINDOW_MINUTES },
);
