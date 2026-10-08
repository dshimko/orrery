// SPDX-License-Identifier: Apache-2.0
// Builders for hand-written inventories, so discovery rules can be tested without SQL rows.
import type { CatalogInfo, ResolvedEnvironment } from '@orrery/core';
import type {
  EntityWrite,
  PlatformObject,
  SchemaInfo,
  TargetInventory,
} from '../../src/discovery/types.js';
import { buildDiscovery } from '../../src/discovery/build.js';
import type { Target } from '../../src/contracts.js';
import { CONNECTION_ENV } from './env.js';

export const target = (metastore = 'primary'): Target => ({
  metastore,
  host: `https://${metastore}.example.invalid`,
  warehouseId: `wh-${metastore}`,
});

export const catalog = (name: string, tags: Record<string, string> = {}): CatalogInfo => ({
  name,
  tags,
});

export const schema = (
  catalogName: string,
  schemaName: string,
  tags: Record<string, string> = {},
  metastore = 'primary',
): SchemaInfo => ({ catalog: catalogName, schema: schemaName, metastore, tags });

export const pipeline = (
  id: string,
  tags: Record<string, string> = {},
  extra: Partial<PlatformObject> = {},
): PlatformObject => ({
  kind: 'pipeline',
  workspaceId: '1',
  id,
  name: `Pipeline ${id}`,
  tags,
  streaming: false,
  ...extra,
});

export const job = (id: string, tags: Record<string, string> = {}): PlatformObject => ({
  kind: 'job',
  workspaceId: '1',
  id,
  name: `Job ${id}`,
  tags,
  streaming: false,
});

export const write = (
  kind: 'pipeline' | 'job',
  id: string,
  catalogName: string,
  schemaName: string,
): EntityWrite => ({ kind, workspaceId: '1', id, catalog: catalogName, schema: schemaName });

export function inventory(partial: Partial<TargetInventory> = {}): TargetInventory {
  return {
    metastore: 'primary',
    available: true,
    catalogs: [],
    schemas: [],
    tableCounts: new Map(),
    foreign: [],
    objects: [],
    writes: [],
    ...partial,
  };
}

export function discover(
  env: ResolvedEnvironment,
  inventories: readonly TargetInventory[],
  peers: readonly ResolvedEnvironment[] = [env],
  targets: readonly Target[] = inventories.map((i) => target(i.metastore)),
) {
  return buildDiscovery({ env, peers, targets, inventories, envVars: CONNECTION_ENV });
}
