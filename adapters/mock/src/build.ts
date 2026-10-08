// SPDX-License-Identifier: Apache-2.0
// Builds the immutable mock world for one environment: the runtime topology plus everything the
// time model needs (curves, facts, the resolved incident script).
import {
  hash32,
  parseRef,
  rand01,
  type ResolvedEnvironment,
  type ScriptedIncident,
  type Severity,
  type Spoke,
  type Topology,
  type UseCase,
} from '@orrery/core';
import { DOMAIN_CURVES, SHIFTS, type Curve } from './curves.js';
import {
  DEFAULT_SHIPYARD,
  DEFAULT_SITES,
  FOREIGN_CATALOGS,
  PROMOTES_TO_BY_TIER,
  SCRIPTS_BY_TIER,
  SOURCE_GROUPS,
  SPOKES,
  TRANSFERS_BY_TIER,
  USE_CASES,
  type UseCaseFacts,
} from './world.js';

export interface MockProfileValues {
  seed: number;
  scale: number;
  failureRate: number;
  deploysPerHour: number;
  agingFactor: number;
}

export interface ScriptEntry {
  id: string;
  kind: string;
  severity: Severity;
  title: string;
  text: string;
  targets: string[];
  /** Minute of the UTC day the entry starts. */
  startMinute: number;
  durationMinutes: number;
}

export interface World {
  envId: string;
  tier: string;
  profile: MockProfileValues;
  topology: Topology;
  ingestId: string | undefined;
  spokeCurves: ReadonlyMap<string, Curve>;
  groupShifts: ReadonlyMap<string, Curve>;
  useCaseFacts: ReadonlyMap<string, UseCaseFacts>;
  script: readonly ScriptEntry[];
  transferMinutes: readonly number[];
  promotesTo: string | undefined;
}

const PRIMARY_METASTORE = 'primary';
const CURVE_NAMES = Object.keys(DOMAIN_CURVES);
const ML_SHARE = 0.3;

/** MOCK_SEED overrides every environment's seed; otherwise the profile seed or a hash of the id. */
export function resolveSeed(env: ResolvedEnvironment, mockSeed: string | undefined): number {
  if (mockSeed !== undefined && mockSeed.trim() !== '') {
    const parsed = Number(mockSeed);
    if (!Number.isInteger(parsed))
      throw new Error(`MOCK_SEED must be an integer, got "${mockSeed}".`);
    return hash32(parsed, env.id);
  }
  return env.mock?.seed ?? hash32(env.id);
}

function scaled(value: number, scale: number, min: number): number {
  return Math.max(min, Math.round(value * scale));
}

function buildSpoke(
  spoke: ResolvedEnvironment['resolvedTopology']['spokes'][number],
  profile: MockProfileValues,
  metastoreIds: readonly string[],
): Spoke {
  const facts = SPOKES[spoke.id];
  const r = (key: string) => rand01(profile.seed, 'spoke', spoke.id, key);
  const base = facts?.metrics ?? {
    pipelines: 20 + Math.floor(r('pipelines') * 80),
    products: 10 + Math.floor(r('products') * 40),
    complexity: Math.round((2 + r('complexity') * 3) * 10) / 10,
    volume: 100 + Math.floor(r('volume') * 1000),
  };
  return {
    id: spoke.id,
    name: spoke.name,
    role: spoke.role,
    metastore:
      spoke.metastore && metastoreIds.includes(spoke.metastore)
        ? spoke.metastore
        : (metastoreIds[0] ?? PRIMARY_METASTORE),
    freshness: { ...spoke.freshness },
    metrics: {
      pipelines: scaled(base.pipelines, profile.scale, 2),
      products: scaled(base.products, profile.scale, 2),
      complexity: base.complexity,
      volume: scaled(base.volume, profile.scale, 5),
    },
    hasMl: facts ? Boolean(facts.hasMl) : r('ml') < ML_SHARE,
    isShared: Boolean(facts?.isShared),
  };
}

function buildUseCases(
  env: ResolvedEnvironment,
  spokeIds: readonly string[],
  seed: number,
): UseCase[] {
  return env.resolvedTopology.useCases.flatMap((uc) => {
    const known = USE_CASES[uc.id]?.reads;
    const fallback = spokeIds.filter((_, i) => rand01(seed, 'reads', uc.id, i) < 0.5);
    const reads = (known ?? (fallback.length > 0 ? fallback : spokeIds.slice(0, 1))).filter((id) =>
      spokeIds.includes(id),
    );
    if (reads.length === 0) return [];
    return [
      {
        id: uc.id,
        name: uc.name,
        ...(uc.site !== undefined ? { site: uc.site } : {}),
        ...(uc.utcOffset !== undefined ? { utcOffset: uc.utcOffset } : {}),
        reads,
      },
    ];
  });
}

export function buildTopology(env: ResolvedEnvironment, profile: MockProfileValues): Topology {
  const configured = env.federation?.metastores ?? [];
  const metastores =
    configured.length > 0
      ? configured.map((m) => ({ id: m.id, name: m.name ?? m.id, status: 'ok' as const }))
      : [{ id: PRIMARY_METASTORE, name: 'Primary metastore', status: 'ok' as const }];
  const metastoreIds = metastores.map((m) => m.id);
  const spokes = env.resolvedTopology.spokes.map((s) => buildSpoke(s, profile, metastoreIds));
  let siteNumber = 0;
  const sourceGroups = env.resolvedTopology.sourceGroups.map((group) => {
    const count = SOURCE_GROUPS[group.id]?.sites ?? DEFAULT_SITES;
    const sites = Array.from({ length: count }, (_, i) => {
      siteNumber += 1;
      return { id: `${group.id}-${i + 1}`, name: `Site ${String(siteNumber).padStart(2, '0')}` };
    });
    return { id: group.id, name: group.name, utcOffset: group.utcOffset, sites };
  });
  const shipyard = env.resolvedTopology.shipyard ?? DEFAULT_SHIPYARD;
  return {
    envId: env.id,
    hub: { ...env.resolvedTopology.hub, metastore: metastoreIds[0] ?? PRIMARY_METASTORE },
    spokes,
    sourceGroups,
    useCases: buildUseCases(
      env,
      spokes.map((s) => s.id),
      profile.seed,
    ),
    shipyard: { name: shipyard.name, utcOffset: shipyard.utcOffset },
    metastores,
    foreignCatalogs: env.federation?.foreignCatalogs?.show
      ? FOREIGN_CATALOGS.map((f) => ({ ...f }))
      : [],
  };
}

function knownRefs(topology: Topology): Set<string> {
  return new Set([
    'shipyard',
    `hub:${topology.hub.id}`,
    ...topology.spokes.map((s) => `spoke:${s.id}`),
    ...topology.sourceGroups.map((g) => `sourceGroup:${g.id}`),
    ...topology.sourceGroups.flatMap((g) => g.sites.map((s) => `site:${s.id}`)),
    ...topology.useCases.map((u) => `useCase:${u.id}`),
    ...topology.foreignCatalogs.map((f) => `foreign:${f.id}`),
    ...topology.metastores.map((m) => `metastore:${m.id}`),
  ]);
}

function toMinute(at: string): number {
  const [h, m] = at.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Keeps only targets that exist in this environment; drops entries left with none. */
export function resolveScript(
  incidents: readonly ScriptedIncident[],
  topology: Topology,
): ScriptEntry[] {
  const known = knownRefs(topology);
  return incidents.flatMap((incident) => {
    const targets = incident.targets.filter((t) => parseRef(t) !== undefined && known.has(t));
    if (targets.length === 0) return [];
    return [
      {
        id: incident.id,
        kind: incident.kind,
        severity: incident.severity,
        title: incident.title,
        text: incident.text,
        targets,
        startMinute: toMinute(incident.at),
        durationMinutes: incident.durationMinutes,
      },
    ];
  });
}

export function buildWorld(env: ResolvedEnvironment, mockSeed: string | undefined): World {
  const profile: MockProfileValues = {
    seed: resolveSeed(env, mockSeed),
    scale: env.mock?.scale ?? 1,
    failureRate: env.mock?.failureRate ?? 0.05,
    deploysPerHour: env.mock?.deploysPerHour ?? 1,
    agingFactor: env.mock?.agingFactor ?? 1,
  };
  const topology = buildTopology(env, profile);
  const spokeCurves = new Map(
    topology.spokes.map((s) => {
      const name =
        SPOKES[s.id]?.curve ??
        CURVE_NAMES[hash32(profile.seed, 'curve', s.id) % CURVE_NAMES.length] ??
        'operations';
      return [s.id, DOMAIN_CURVES[name] ?? SHIFTS.two] as const;
    }),
  );
  const groupShifts = new Map(
    topology.sourceGroups.map((g) => [g.id, SHIFTS[SOURCE_GROUPS[g.id]?.shifts ?? 'two']] as const),
  );
  const useCaseFacts = new Map(
    topology.useCases.flatMap((u) => {
      const facts = USE_CASES[u.id];
      return facts ? [[u.id, facts] as const] : [];
    }),
  );
  return {
    envId: env.id,
    tier: env.tier,
    profile,
    topology,
    ingestId: topology.spokes.find((s) => s.role === 'ingest')?.id,
    spokeCurves,
    groupShifts,
    useCaseFacts,
    script: resolveScript(env.mock?.incidents ?? SCRIPTS_BY_TIER[env.tier] ?? [], topology),
    transferMinutes: TRANSFERS_BY_TIER[env.tier] ?? [],
    promotesTo: env.mock?.promotesTo ?? PROMOTES_TO_BY_TIER[env.tier],
  };
}
