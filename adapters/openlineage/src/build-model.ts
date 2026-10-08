// SPDX-License-Identifier: Apache-2.0
// Builds the Model and Topology of one environment from the runs seen so far.
import {
  hash32,
  type ResolvedEnvironment,
  type Spoke,
  type Topology,
  type UseCase,
} from '@orrery/core';
import { consumedSpokes } from './convert/classify.js';
import { subjectMatches, jobSubject } from './matchers.js';
import {
  MAX_SITES_PER_GROUP,
  isSinkRun,
  sourcesOf,
  spokeOf,
  type DatasetInfo,
  type GroupModel,
  type Model,
  type ModelCore,
  type SpokeLookup,
  type SpokeModel,
} from './model.js';
import type { Run } from './runs.js';
import { datasetKey, type DatasetRef } from './types.js';

const DEFAULT_METASTORE = 'main';
const MAX_COMPLEXITY = 5;
const PIPELINE_WEIGHT = 0.8;
const SCHEMA_WEIGHT = 0.4;
const BYTES_PER_TB = 1e12;
const VOLUME_DECIMALS = 1e6;
const DEFAULT_SHIPYARD = { name: 'Release shipyard', utcOffset: 0 };

type ResolvedTopology = ResolvedEnvironment['resolvedTopology'];

/** Complexity on a 0 to 5 scale: logarithmic in pipelines and schemas, so it grows slowly. */
export function complexityOf(pipelines: number, schemas: number): number {
  const raw = PIPELINE_WEIGHT * Math.log2(1 + pipelines) + SCHEMA_WEIGHT * Math.log2(1 + schemas);
  return Math.round(Math.min(MAX_COMPLEXITY, raw) * 10) / 10;
}

function discoverDatasets(runs: readonly Run[]): Map<string, DatasetInfo> {
  const datasets = new Map<string, DatasetInfo>();
  const touch = (ref: DatasetRef): DatasetInfo => {
    const key = datasetKey(ref);
    const known = datasets.get(key);
    if (known) {
      known.ref = { ...known.ref, tags: { ...known.ref.tags, ...ref.tags } };
      return known;
    }
    const created: DatasetInfo = {
      ref,
      producers: new Set<string>(),
      consumers: new Set<string>(),
      producerTags: [],
    };
    datasets.set(key, created);
    return created;
  };
  for (const run of runs) {
    for (const ref of run.inputs) touch(ref).consumers.add(run.jobKey);
    for (const ref of run.outputs) {
      const info = touch(ref);
      info.producers.add(run.jobKey);
      // Runs are ordered by end time, so the last one reporting a size is the latest.
      if (ref.stats?.sizeBytes !== undefined) info.sizeBytes = ref.stats.sizeBytes;
      const tags = JSON.stringify(run.job.tags);
      if (!info.producerTags.some((known) => JSON.stringify(known) === tags)) {
        info.producerTags.push(run.job.tags);
      }
    }
  }
  return datasets;
}

function buildGroups(
  topology: ResolvedTopology,
  datasets: ModelCore['datasets'],
  runs: readonly Run[],
): GroupModel[] {
  const draft = topology.sourceGroups.map((group) => ({ group, names: new Map<string, string>() }));
  for (const run of runs) {
    for (const source of sourcesOf({ datasets }, run)) {
      const hit = draft.find((entry) => subjectMatches(entry.group.match, source.subject));
      hit?.names.set(source.key, source.name);
    }
  }
  return draft.map(({ group, names }) => {
    const keys = [...names.keys()].sort().slice(0, MAX_SITES_PER_GROUP);
    const sites = keys.map((key) => ({
      key,
      id: `${group.id}-${hash32(key).toString(36)}`,
      name: names.get(key) as string,
    }));
    return {
      id: group.id,
      match: group.match,
      sites: sites.map(({ id, name }) => ({ id, name })),
      siteByKey: new Map(sites.map(({ key, id }) => [key, id])),
    };
  });
}

function buildSpokes(
  topology: ResolvedTopology,
  base: SpokeLookup,
): { spokes: Spoke[]; counts: Map<string, number> } {
  const datasetsBySpoke = new Map<string, Set<string>>();
  const jobsBySpoke = new Map<string, Set<string>>();
  for (const info of base.datasets.values()) {
    const spokeId = spokeOf(base, info.ref);
    if (spokeId === undefined) continue;
    datasetsBySpoke.set(
      spokeId,
      (datasetsBySpoke.get(spokeId) ?? new Set()).add(datasetKey(info.ref)),
    );
    for (const producer of info.producers) {
      jobsBySpoke.set(spokeId, (jobsBySpoke.get(spokeId) ?? new Set()).add(producer));
    }
  }
  const counts = new Map([...datasetsBySpoke].map(([id, set]) => [id, set.size]));
  const spokes = topology.spokes.map((spoke) => {
    const datasets = datasetsBySpoke.get(spoke.id) ?? new Set<string>();
    const pipelines = jobsBySpoke.get(spoke.id)?.size ?? 0;
    const bytes = [...datasets].reduce(
      (sum, key) => sum + (base.datasets.get(key)?.sizeBytes ?? 0),
      0,
    );
    const schemas = new Set(
      [...datasets].map((key) => (key.split('\u0000')[1] ?? '').split('.')[0] ?? ''),
    ).size;
    return {
      id: spoke.id,
      name: spoke.name,
      role: spoke.role,
      metastore: spoke.metastore ?? DEFAULT_METASTORE,
      freshness: { ...spoke.freshness },
      metrics: {
        pipelines,
        products: datasets.size,
        complexity: complexityOf(pipelines, schemas),
        // Terabytes written by each dataset's latest run: an estimate of what is stored.
        volume: Math.round((bytes / BYTES_PER_TB) * VOLUME_DECIMALS) / VOLUME_DECIMALS,
      },
      hasMl: false,
      isShared: false,
    };
  });
  return { spokes, counts };
}

function readsOf(model: ModelCore, jobs: readonly Run[]): string[] {
  const ids = new Set(jobs.flatMap((run) => consumedSpokes(model, run)));
  return model.spokes.map((spoke) => spoke.id).filter((id) => ids.has(id));
}

function buildUseCases(
  topology: ResolvedTopology,
  model: ModelCore,
  runs: readonly Run[],
): UseCase[] {
  const sinks = runs.filter((run) => isSinkRun(model, run));
  return topology.useCases.map((useCase) => {
    const matching = sinks.filter((run) => subjectMatches(useCase.match, jobSubject(run.job)));
    return {
      id: useCase.id,
      name: useCase.name,
      ...(useCase.site !== undefined ? { site: useCase.site } : {}),
      ...(useCase.utcOffset !== undefined ? { utcOffset: useCase.utcOffset } : {}),
      reads: readsOf(model, matching),
    };
  });
}

function gapNotes(
  topology: Topology,
  model: ModelCore,
  counts: ReadonlyMap<string, number>,
): string[] {
  return [
    ...topology.spokes
      .filter((spoke) => (counts.get(spoke.id) ?? 0) === 0)
      .map((spoke) => `Spoke "${spoke.id}" matches no dataset.`),
    ...model.groups
      .filter((group) => group.sites.length === 0)
      .map((group) => `Source group "${group.id}" matches no source.`),
    ...topology.useCases
      .filter((useCase) => useCase.reads.length === 0)
      .map(
        (useCase) =>
          `Use case "${useCase.id}" reads no spoke (no matching sink job); it keeps reads: [].`,
      ),
  ];
}

/** Builds the model from every run seen so far. Pure and deterministic. */
export function buildModel(env: ResolvedEnvironment, runs: readonly Run[]): Model {
  const topology = env.resolvedTopology;
  const spokes: SpokeModel[] = topology.spokes.map((spoke) => ({
    id: spoke.id,
    role: spoke.role,
    match: spoke.match,
    targetMinutes: spoke.freshness.targetMinutes,
  }));
  const matchOrder = [
    ...spokes.filter((spoke) => spoke.role === 'domain'),
    ...spokes.filter((spoke) => spoke.role === 'ingest'),
  ];
  const datasets = discoverDatasets(runs);
  const spokeCache = new Map<string, string | undefined>();
  const groups = buildGroups(topology, datasets, runs);
  const built = buildSpokes(topology, { datasets, matchOrder, spokeCache });
  const metastores = [
    ...new Set([DEFAULT_METASTORE, ...built.spokes.map((spoke) => spoke.metastore)]),
  ];
  const core: ModelCore = {
    envId: env.id,
    hubId: topology.hub.id,
    spokes,
    matchOrder,
    datasets,
    groups,
    useCases: topology.useCases.map((useCase) => ({ id: useCase.id, match: useCase.match })),
    maxTargetMinutes: Math.max(0, ...spokes.map((spoke) => spoke.targetMinutes)),
    spokeCache,
  };
  const result: Topology = {
    envId: env.id,
    hub: { id: topology.hub.id, name: topology.hub.name, metastore: DEFAULT_METASTORE },
    spokes: built.spokes,
    sourceGroups: topology.sourceGroups.map((group, index) => ({
      id: group.id,
      name: group.name,
      utcOffset: group.utcOffset,
      sites: groups[index]?.sites ?? [],
    })),
    useCases: buildUseCases(topology, core, runs),
    shipyard: topology.shipyard
      ? { name: topology.shipyard.name, utcOffset: topology.shipyard.utcOffset }
      : DEFAULT_SHIPYARD,
    metastores: metastores.map((id) => ({ id, name: id, status: 'ok' as const })),
    foreignCatalogs: [],
  };
  return {
    ...core,
    topology: result,
    notes: gapNotes(result, core, built.counts),
  };
}
