// SPDX-License-Identifier: Apache-2.0
// Which catalogs an environment owns: scope globs and tags, conflicts with peers that share its
// workspace, platform catalogs, and the tag-scope fallback when catalog tags cannot be read.
import {
  assignCatalogs,
  conflictMessage,
  type CatalogInfo,
  type ResolvedEnvironment,
  type ScopedCatalog,
} from '@orrery/core';
import type { Target } from '../contracts.js';
import type { EnvMap } from '../env-refs.js';
import { resolveTargets } from '../targets.js';
import type { TargetInventory } from './types.js';

export interface OwnershipInput {
  env: ResolvedEnvironment;
  peers: readonly ResolvedEnvironment[];
  targets: readonly Target[];
  inventories: readonly TargetInventory[];
  /** Environment variables used to resolve peers' connection targets. */
  envVars: EnvMap;
}

/** Catalogs that exist in every metastore and belong to no environment. */
const PLATFORM_CATALOGS: ReadonlySet<string> = new Set([
  'system',
  'samples',
  'hive_metastore',
  '__databricks_internal',
]);
/** Catalogs the platform creates itself (`__` prefix covers internal ones); never owned. */
function isPlatformCatalog(name: string): boolean {
  const lower = name.toLowerCase();
  return PLATFORM_CATALOGS.has(lower) || lower.startsWith('__');
}

export function mergeCatalogs(inventories: readonly TargetInventory[]): Map<string, CatalogInfo> {
  const merged = new Map<string, CatalogInfo>();
  for (const inventory of inventories) {
    for (const catalog of inventory.catalogs) {
      const key = catalog.name.toLowerCase();
      const existing = merged.get(key);
      merged.set(key, { name: catalog.name, tags: { ...existing?.tags, ...catalog.tags } });
    }
  }
  return merged;
}

export interface Ownership {
  owned: Map<string, ScopedCatalog>;
  foreign: CatalogInfo[];
  conflicts: string[];
  unmatched: string[];
  /** Why ownership cannot be decided (catalog tags unreadable while tag scopes are in use). */
  unknown: string[];
}

/** The default metastore id says nothing about which metastore a workspace really uses. */
const PLACEHOLDER_METASTORE = 'primary';

/** Whether two targets reach the same data: same host and warehouse, or the same metastore id. */
function sharesWorkspace(a: readonly Target[], b: readonly Target[]): boolean {
  return a.some((x) =>
    b.some(
      (y) =>
        (x.host === y.host && x.warehouseId === y.warehouseId) ||
        (x.metastore === y.metastore && x.metastore !== PLACEHOLDER_METASTORE),
    ),
  );
}

/** Peers (plus this environment) whose catalogs live where this environment's do. */
function relatedPeers(input: OwnershipInput): ResolvedEnvironment[] {
  const related = input.peers.filter((peer) => {
    if (peer.id === input.env.id) return true;
    try {
      return sharesWorkspace(input.targets, resolveTargets(peer, input.envVars));
    } catch {
      return false;
    }
  });
  return related.some((p) => p.id === input.env.id) ? related : [...related, input.env];
}

function tagFailures(input: OwnershipInput, peers: readonly ResolvedEnvironment[]): string[] {
  const usesTags = peers.some((p) => Object.keys(p.scope?.tag ?? {}).length > 0);
  if (!usesTags) return [];
  return input.inventories
    .filter((i) => i.available && i.tagsUnavailable)
    .map(
      (i) =>
        `Catalog ownership is unknown: source catalog_tags failed on metastore "${i.metastore}" while an environment scopes by tag.`,
    );
}

export function resolveOwnership(input: OwnershipInput): Ownership {
  const catalogs = mergeCatalogs(input.inventories);
  const foreignNames = new Set(
    input.inventories.flatMap((i) => i.foreign.map((n) => n.toLowerCase())),
  );
  const regular = [...catalogs.values()].filter(
    (c) => !foreignNames.has(c.name.toLowerCase()) && !isPlatformCatalog(c.name),
  );
  const foreignInfos = [...catalogs.values()].filter((c) => foreignNames.has(c.name.toLowerCase()));
  const peers = relatedPeers(input);
  const unknown = tagFailures(input, peers);
  const result = assignCatalogs(regular, peers);
  const mine = result.byEnv.get(input.env.id);
  const claimed = new Set([...result.byEnv.values()].flat().map((c) => c.catalog));
  const owned = new Map<string, ScopedCatalog>();
  if (mine) {
    for (const entry of mine) owned.set(entry.catalog.toLowerCase(), entry);
  } else if (unknown.length === 0) {
    for (const catalog of regular.filter((c) => !claimed.has(c.name))) {
      owned.set(catalog.name.toLowerCase(), {
        catalog: catalog.name,
        base: catalog.name.toLowerCase(),
      });
    }
  }
  const foreignScope = assignCatalogs(foreignInfos, peers);
  const mineForeign = new Set((foreignScope.byEnv.get(input.env.id) ?? []).map((c) => c.catalog));
  const unclaimed = new Set(foreignScope.unmatched);
  return {
    owned,
    foreign: foreignInfos.filter((c) => mineForeign.has(c.name) || unclaimed.has(c.name)),
    conflicts: result.conflicts
      .filter((c) => c.envIds.includes(input.env.id))
      .map((c) => conflictMessage(c)),
    unmatched: mine ? result.unmatched.filter((name) => !isPlatformCatalog(name)) : [],
    unknown,
  };
}
