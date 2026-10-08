// SPDX-License-Identifier: Apache-2.0
// Shared mock-adapter fixture for render tests.
import { MockAdapter } from '@orrery/adapter-mock';
import { Visuals, type PlatformEvent, type Snapshot, type Topology } from '@orrery/core';
import { FixedClock, collect, loadExampleEnvironment, silentLogger } from '@orrery/testkit';
import { createModel, type SceneModel } from '../src/index.js';

export const visuals = Visuals.parse({});
export const AT = new Date('2026-10-07T10:40:00Z');

export interface Fixture {
  topology: Topology;
  snapshot: Snapshot;
  events: PlatformEvent[];
}

export async function loadFixture(): Promise<Fixture> {
  const adapter = new MockAdapter();
  await adapter.init(loadExampleEnvironment('demo.yaml', 'prod'), {
    clock: new FixedClock(AT),
    logger: silentLogger,
    env: {},
  });
  const topology = await adapter.topology();
  const snapshot = await adapter.snapshot(AT);
  const events = await collect(adapter.events(AT, new Date(AT.getTime() + 30 * 60_000)));
  return { topology, snapshot, events };
}

export const freshModel = (f: Fixture, seed = 33): SceneModel =>
  createModel(f.topology, visuals, seed, f.snapshot);
