// SPDX-License-Identifier: Apache-2.0
import { loadExampleEnvironment, runAdapterContract } from '@orrery/testkit';
import { MockAdapter } from '../src/index.js';
import { at, context, demoEnv } from './helpers.js';

for (const envId of ['dev', 'stg', 'prod'] as const) {
  runAdapterContract(
    `mock (demo ${envId})`,
    async () => {
      const when = at('10:15');
      return { adapter: new MockAdapter(), env: demoEnv(envId), ctx: context(when), at: when };
    },
    { eventWindowMinutes: 180 },
  );
}

runAdapterContract('mock (three-env dev, unknown ids get seeded defaults)', async () => {
  const when = at('19:50');
  return {
    adapter: new MockAdapter(),
    env: loadExampleEnvironment('three-env.yaml', 'dev'),
    ctx: context(when),
    at: when,
  };
});
