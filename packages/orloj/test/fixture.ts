// SPDX-License-Identifier: Apache-2.0
// Shared mock-adapter fixture: real snapshots and topologies for the demo environments.
import { MockAdapter } from '@orrery/adapter-mock';
import { Visuals } from '@orrery/core';
import { FixedClock, loadExampleEnvironment, silentLogger } from '@orrery/testkit';
import type { OrlojFace, OrlojTime } from '../src/index.js';

export const visuals = Visuals.parse({});
export const AT = new Date('2026-10-07T10:45:00Z');
export const ENV_IDS = ['dev', 'stg', 'prod'] as const;
const TIER_COLORS = visuals.colors.tiers;

export async function loadFace(envId: string, at: Date = AT, seed = 7): Promise<OrlojFace> {
  const adapter = new MockAdapter();
  await adapter.init(loadExampleEnvironment('demo.yaml', envId), {
    clock: new FixedClock(at),
    logger: silentLogger,
    env: {},
  });
  const [topology, snapshot] = [await adapter.topology(), await adapter.snapshot(at)];
  return {
    env: { id: envId, name: envId.toUpperCase(), tier: envId },
    tierColor: TIER_COLORS[envId] ?? '#FFFFFF',
    seed,
    topology,
    snapshot,
  };
}

export async function loadFaces(at: Date = AT): Promise<OrlojFace[]> {
  return Promise.all(ENV_IDS.map((id, i) => loadFace(id, at, i + 1)));
}

export const timeAt = (iso: string, paused = true): OrlojTime => ({ at: new Date(iso), paused });
