// SPDX-License-Identifier: Apache-2.0
// Builds the topology and the internal model from per-metastore inventories: environment scope,
// spoke/source-group/use-case matching, medallion tiers, metrics, metastores, and comets.
import {
  type AdapterContext,
  type ResolvedEnvironment,
  type ScopedCatalog,
  type Spoke,
  type Topology,
} from '@orrery/core';
import type { Target } from '../contracts.js';
import { schemaKey, type Tags } from '../rows.js';
import { foreignId } from './inventory.js';
import { objectMatches, schemaMatches, type SchemaFacts } from './matchers.js';
import { highestTier, tierOf } from './medallion.js';
import {
  mergeCatalogs,
  resolveOwnership,
  type Ownership,
  type OwnershipInput,
} from './ownership.js';
import {
  objectKey,
  type Discovery,
  type Model,
  type ModelObject,
  type ModelSchema,
  type PlatformObject,
  type Tier,
} from './types.js';

type Topo = ResolvedEnvironment['resolvedTopology'];
type SpokeConfig = Topo['spokes'][number];

const ML_NAME = /\b(ml|train(ing)?|scor(e|ing)|predict(ion|ive)?|model(s)?)\b/i;
const MAX_COMPLEXITY = 5;
const PIPELINE_WEIGHT = 0.8;
const SCHEMA_WEIGHT = 0.4;
const DEFAULT_RELEASE_KEY = 'release';
const DEFAULT_SHIPYARD = { name: 'Release shipyard', utcOffset: 0 };

export interface BuildInput extends OwnershipInput {
  /** The config's `promotion` block, when set. */
  promotion?: AdapterContext['promotion'];
}

/**
 * The job tag that marks a release: `promotion.tagKey` when `promotion.source` is `job-tag`,
 * else `options.releaseTagKey`, else `release`.
 */
export function releaseTagKeyOf(input: BuildInput): string {
  const { promotion, env } = input;
  if (promotion?.source === 'job-tag' && promotion.tagKey) return promotion.tagKey;
  const option = env.options?.['releaseTagKey'];
  return typeof option === 'string' && option !== '' ? option : DEFAULT_RELEASE_KEY;
}

/** Complexity on a 0 to 5 scale: logarithmic in pipelines and schemas, so it grows slowly. */
export function complexityOf(pipelines: number, schemas: number): number {
  const raw = PIPELINE_WEIGHT * Math.log2(1 + pipelines) + SCHEMA_WEIGHT * Math.log2(1 + schemas);
  return Math.round(Math.min(MAX_COMPLEXITY, raw) * 10) / 10;
}

function isMlObject(object: PlatformObject): boolean {
  const tags = new Map(Object.entries(object.tags).map(([k, v]) => [k.toLowerCase(), v]));
  return tags.get('workload')?.toLowerCase() === 'ml' || ML_NAME.test(object.name);
}

function buildSchemas(
  input: BuildInput,
  owned: ReadonlyMap<string, ScopedCatalog>,
): Map<string, ModelSchema> {
  const catalogTags = mergeCatalogs(input.inventories);
  const topo = input.env.resolvedTopology;
  const schemas = new Map<string, ModelSchema>();
  for (const inventory of input.inventories) {
    for (const info of inventory.schemas) {
      const scoped = owned.get(info.catalog.toLowerCase());
      if (!scoped) continue;
      const tags: Tags = { ...catalogTags.get(info.catalog.toLowerCase())?.tags, ...info.tags };
      const facts: SchemaFacts = { base: scoped.base, schema: info.schema, tags };
      const key = schemaKey(info.catalog, info.schema);
      const tier = tierOf(topo.medallion, { catalog: info.catalog, ...facts });
      const spoke = topo.spokes.find((s) => schemaMatches(s.match, facts));
      schemas.set(key, {
        key,
        catalog: info.catalog,
        schema: info.schema,
        base: scoped.base,
        metastore: info.metastore,
        tags,
        ...(tier ? { tier } : {}),
        ...(spoke ? { spokeId: spoke.id } : {}),
        tableCount: inventory.tableCounts.get(key) ?? 0,
      });
    }
  }
  return schemas;
}

function buildObjects(
  input: BuildInput,
  schemas: ReadonlyMap<string, ModelSchema>,
  ingestId: string | undefined,
): Map<string, ModelObject> {
  const topo = input.env.resolvedTopology;
  const scoped = input.env.scope !== undefined;
  const written = new Map<string, Set<string>>();
  for (const inventory of input.inventories) {
    for (const w of inventory.writes) {
      const key = objectKey(w.kind, w.workspaceId, w.id);
      const set = written.get(key) ?? new Set<string>();
      set.add(schemaKey(w.catalog, w.schema));
      written.set(key, set);
    }
  }
  const objects = new Map<string, ModelObject>();
  for (const inventory of input.inventories) {
    for (const object of inventory.objects) {
      const key = objectKey(object.kind, object.workspaceId, object.id);
      const targets = written.get(key) ?? new Set<string>();
      const mine = [...targets].flatMap((k) => schemas.get(k) ?? []);
      if (scoped && targets.size > 0 && mine.length === 0) continue;
      const facts = mine.map((s) => ({ base: s.base, schema: s.schema, tags: s.tags }));
      const spoke = topo.spokes.find((s) =>
        objectMatches(s.match, object.kind, object.tags, facts),
      );
      const group = topo.sourceGroups.find((g) =>
        objectMatches(g.match, object.kind, object.tags, facts),
      );
      const spokeId = spoke?.id ?? (group ? ingestId : undefined);
      if (spokeId === undefined && !group) continue;
      const role = topo.spokes.find((s) => s.id === spokeId)?.role;
      const tier: Tier =
        highestTier(mine.map((s) => s.tier)) ?? (role === 'ingest' ? 'bronze' : 'silver');
      objects.set(key, {
        key,
        kind: object.kind,
        name: object.name,
        ...(spokeId ? { spokeId } : {}),
        ...(group ? { groupId: group.id } : {}),
        tier,
        isMl: isMlObject(object),
        streaming: object.streaming,
      });
    }
  }
  return objects;
}

function pickMetastore(
  config: SpokeConfig,
  spokeSchemas: readonly ModelSchema[],
  targets: readonly Target[],
  fallback: string,
): string {
  const ids = targets.map((t) => t.metastore);
  if (config.metastore !== undefined && ids.includes(config.metastore)) return config.metastore;
  const counts = new Map<string, number>();
  for (const s of spokeSchemas) counts.set(s.metastore, (counts.get(s.metastore) ?? 0) + 1);
  let best = fallback;
  let bestCount = 0;
  for (const id of ids) {
    const count = counts.get(id) ?? 0;
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

function buildSpoke(
  config: SpokeConfig,
  schemas: readonly ModelSchema[],
  objects: readonly ModelObject[],
  input: BuildInput,
  hubMetastore: string,
): Spoke {
  const mine = schemas.filter((s) => s.spokeId === config.id);
  const gold = mine.filter((s) => s.tier === 'gold');
  const tables = gold.reduce((sum, s) => sum + s.tableCount, 0);
  const own = objects.filter((o) => o.spokeId === config.id);
  const metastore = pickMetastore(config, mine, input.targets, hubMetastore);
  return {
    id: config.id,
    name: config.name,
    role: config.role,
    metastore,
    freshness: { ...config.freshness },
    metrics: {
      pipelines: own.length,
      products: tables > 0 ? tables : gold.length,
      complexity: complexityOf(own.length, mine.length),
      volume: 0,
    },
    hasMl: own.some((o) => o.isMl),
    isShared: metastore !== hubMetastore,
  };
}

function healthOf(
  input: BuildInput,
  ownership: Ownership,
): { status: 'ok' | 'degraded' | 'error'; messages: string[] } {
  const messages: string[] = [...ownership.conflicts, ...ownership.unknown];
  for (const inv of input.inventories.filter((i) => !i.available)) {
    messages.push(`Metastore "${inv.metastore}" is unavailable (${inv.error ?? 'unknown error'}).`);
  }
  const allDown = input.inventories.length > 0 && input.inventories.every((i) => !i.available);
  const someDown = input.inventories.some((i) => !i.available);
  const broken = ownership.conflicts.length > 0 || ownership.unknown.length > 0 || allDown;
  const status = broken ? 'error' : someDown ? 'degraded' : 'ok';
  const codes = input.inventories.map((i) => i.errorCode);
  const credential = allDown
    ? codes.find((c) => c === 'auth' || c === 'permission_denied')
    : undefined;
  return {
    status,
    messages,
    ...(credential === 'auth' || credential === 'permission_denied'
      ? { errorCode: credential }
      : {}),
  };
}

/** Builds the topology, model, and discovery health for one environment. */
export function buildDiscovery(input: BuildInput): Discovery {
  const { env } = input;
  const topo = env.resolvedTopology;
  const ownership = resolveOwnership(input);
  const schemas = buildSchemas(input, ownership.owned);
  const ingestId = topo.spokes.find((s) => s.role === 'ingest')?.id;
  const objects = buildObjects(input, schemas, ingestId);
  const schemaList = [...schemas.values()];
  const objectList = [...objects.values()];
  const hubMetastore = input.targets[0]?.metastore ?? 'primary';
  const spokes = topo.spokes.map((s) => buildSpoke(s, schemaList, objectList, input, hubMetastore));
  // Comets are opt-in: only `federation.foreignCatalogs.show: true` draws them (as in the mock).
  const foreignCatalogs =
    env.federation?.foreignCatalogs?.show === true
      ? ownership.foreign.map((c) => ({ id: foreignId(c.name), name: c.name }))
      : [];
  const topology: Topology = {
    envId: env.id,
    hub: { id: topo.hub.id, name: topo.hub.name, metastore: hubMetastore },
    spokes,
    sourceGroups: topo.sourceGroups.map((g) => ({
      id: g.id,
      name: g.name,
      utcOffset: g.utcOffset,
      sites: [{ id: `${g.id}-1`, name: g.name }],
    })),
    useCases: topo.useCases.map((u) => ({
      id: u.id,
      name: u.name,
      ...(u.site !== undefined ? { site: u.site } : {}),
      ...(u.utcOffset !== undefined ? { utcOffset: u.utcOffset } : {}),
      reads: spokes
        .filter((s) => schemaList.some((sc) => sc.spokeId === s.id && schemaMatches(u.match, sc)))
        .map((s) => s.id),
    })),
    shipyard: topo.shipyard
      ? { name: topo.shipyard.name, utcOffset: topo.shipyard.utcOffset }
      : DEFAULT_SHIPYARD,
    metastores: input.targets.map((t) => ({
      id: t.metastore,
      name: t.metastore,
      status:
        input.inventories.find((i) => i.metastore === t.metastore)?.available === false
          ? 'unavailable'
          : 'ok',
    })),
    foreignCatalogs,
  };
  const model: Model = {
    envId: env.id,
    hubId: topo.hub.id,
    ingestId,
    defaultGroupId: topo.sourceGroups[0]?.id,
    groupSites: new Map(topo.sourceGroups.map((g) => [g.id, `${g.id}-1`])),
    releaseTagKey: releaseTagKeyOf(input),
    spokes: new Map(
      topo.spokes.map((s) => [
        s.id,
        { id: s.id, role: s.role, targetMinutes: s.freshness.targetMinutes },
      ]),
    ),
    schemas,
    objects,
    useCases: topo.useCases.map((u) => ({ id: u.id, matcher: u.match })),
    foreign: new Map(foreignCatalogs.map((c) => [c.name.toLowerCase(), c.id])),
    scopedCatalogs: new Set(ownership.owned.keys()),
  };
  return {
    topology,
    model,
    health: { ...healthOf(input, ownership), unmatchedCatalogs: ownership.unmatched },
  };
}
