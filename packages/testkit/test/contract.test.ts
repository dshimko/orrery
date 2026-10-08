// SPDX-License-Identifier: Apache-2.0
import {
  FixedClock,
  loadExampleEnvironment,
  runAdapterContract,
  silentLogger,
  type ContractSubject,
} from '../src/index.js';
import { FakeAdapter } from './fake-adapter.js';

const AT = new Date('2026-03-10T12:00:00.000Z');

runAdapterContract('fake', (): Promise<ContractSubject> =>
  Promise.resolve({
    adapter: new FakeAdapter(),
    env: loadExampleEnvironment('three-env.yaml', 'dev'),
    ctx: { clock: new FixedClock(AT), logger: silentLogger, env: {} },
    at: AT,
  }),
);
