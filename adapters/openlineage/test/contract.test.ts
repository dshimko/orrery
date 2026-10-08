// SPDX-License-Identifier: Apache-2.0
import {
  FixedClock,
  loadExampleEnvironment,
  runAdapterContract,
  silentLogger,
} from '@orrery/testkit';
import { OpenLineageAdapter } from '../src/adapter.js';

const REPO_ROOT = new URL('../../..', import.meta.url).pathname;
const WINDOW_MINUTES = 120;

runAdapterContract(
  'openlineage (public samples)',
  async () => {
    const at = new Date('2026-10-07T10:03:00.000Z');
    return {
      adapter: new OpenLineageAdapter({ cwd: REPO_ROOT }),
      env: loadExampleEnvironment('openlineage.yaml', 'sample'),
      ctx: { clock: new FixedClock(at), logger: silentLogger, env: {} },
      at,
    };
  },
  { eventWindowMinutes: WINDOW_MINUTES },
);
