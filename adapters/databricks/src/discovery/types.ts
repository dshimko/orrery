// SPDX-License-Identifier: Apache-2.0
import type { SqlError } from '../contracts.js';
import type { CatalogInfo, Matcher, ObjectRef, Topology } from '@orrery/core';
import type { Tags } from '../rows.js';

export type Tier = 'bronze' | 'silver' | 'gold';
export type ObjectKind = 'pipeline' | 'job';

export interface SchemaInfo {
  catalog: string;
  schema: string;
  metastore: string;
  tags: Tags;
}

export interface PlatformObject {
  kind: ObjectKind;
  workspaceId: string;
  id: string;
  name: string;
  tags: Tags;
  streaming: boolean;
}

export interface EntityWrite {
  kind: ObjectKind;
  workspaceId: string;
  id: string;
  catalog: string;
  schema: string;
}

/** Everything one metastore target reported for topology discovery. */
export interface TargetInventory {
  metastore: string;
  available: boolean;
  /** Safe-to-show failure reason when the target is unavailable. */
  error?: string;
  /** The failure code behind `error`, so callers can tell credential problems from outages. */
  errorCode?: SqlError['code'];
  /** True when catalog tags could not be read (tag-based scope cannot be evaluated). */
  tagsUnavailable?: boolean;
  catalogs: CatalogInfo[];
  schemas: SchemaInfo[];
  tableCounts: ReadonlyMap<string, number>;
  foreign: string[];
  objects: PlatformObject[];
  writes: EntityWrite[];
}

export interface ModelSchema {
  key: string;
  catalog: string;
  schema: string;
  /** Catalog name with the environment tag stripped. */
  base: string;
  metastore: string;
  tags: Tags;
  tier?: Tier;
  spokeId?: string;
  tableCount: number;
}

export interface ModelObject {
  key: string;
  kind: ObjectKind;
  name: string;
  spokeId?: string;
  groupId?: string;
  tier: Tier;
  isMl: boolean;
  streaming: boolean;
}

export interface ModelUseCase {
  id: string;
  matcher: Matcher;
}

/** Resolved lookups the converters use; built together with the topology. */
export interface Model {
  envId: string;
  hubId: string;
  ingestId: string | undefined;
  /** Group that unattributed ingest objects fall back to. */
  defaultGroupId: string | undefined;
  groupSites: ReadonlyMap<string, string>;
  releaseTagKey: string;
  spokes: ReadonlyMap<string, { id: string; role: 'ingest' | 'domain'; targetMinutes: number }>;
  schemas: ReadonlyMap<string, ModelSchema>;
  objects: ReadonlyMap<string, ModelObject>;
  useCases: readonly ModelUseCase[];
  /** Lowercase foreign catalog name to topology id. */
  foreign: ReadonlyMap<string, string>;
  scopedCatalogs: ReadonlySet<string>;
}

export interface DiscoveryHealth {
  status: 'ok' | 'degraded' | 'error';
  messages: string[];
  /** Set on `error` when every metastore failed on credentials. */
  errorCode?: 'auth' | 'permission_denied';
  unmatchedCatalogs: string[];
}

export interface Discovery {
  topology: Topology;
  model: Model;
  health: DiscoveryHealth;
}

export function objectKey(kind: ObjectKind, workspaceId: string, id: string): string {
  return `${kind}:${workspaceId}:${id}`;
}

export function spokeRef(id: string): ObjectRef {
  return `spoke:${id}`;
}
