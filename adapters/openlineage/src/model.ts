// SPDX-License-Identifier: Apache-2.0
// The environment's topology as seen through OpenLineage: datasets matched to spokes, external
// sources matched to source groups, sink jobs matched to use cases. Built from a set of runs, so
// it is deterministic for a given set of events.
import { hash32, type Matcher, type Site, type SpokeRole, type Topology } from '@orrery/core';
import { datasetSubject, jobSubject, subjectMatches, type Subject } from './matchers.js';
import type { Run } from './runs.js';
import { datasetKey, type DatasetRef, type Tags } from './types.js';

/** Sites listed per source group. */
export const MAX_SITES_PER_GROUP = 8;

export interface DatasetInfo {
  ref: DatasetRef;
  producers: Set<string>;
  consumers: Set<string>;
  /** Tag maps of the producing jobs, for `jobTag` and `pipelineTag` matchers. */
  producerTags: Tags[];
}

export interface SpokeModel {
  id: string;
  role: SpokeRole;
  match: Matcher;
  targetMinutes: number;
}

export interface GroupModel {
  id: string;
  match: Matcher;
  sites: Site[];
  /** Source key to site id, for sources seen during discovery. */
  siteByKey: Map<string, string>;
}

export interface UseCaseModel {
  id: string;
  match: Matcher;
}

/** An upstream thing a run reads from outside the observed pipelines. */
export interface SourceRef {
  /** Stable identity: a dataset or a job. */
  key: string;
  name: string;
  subject: Subject;
}

export interface ModelCore {
  envId: string;
  hubId: string;
  /** In config order. */
  spokes: SpokeModel[];
  /** Spokes in matching order: domain spokes first, then ingest spokes (the catch-all). */
  matchOrder: SpokeModel[];
  datasets: Map<string, DatasetInfo>;
  groups: GroupModel[];
  useCases: UseCaseModel[];
  /** Longest freshness target, so lookbacks can cover a crossing. */
  maxTargetMinutes: number;
  spokeCache: Map<string, string | undefined>;
}

/** A model with its topology and health notes. */
export interface Model extends ModelCore {
  topology: Topology;
  /** Configuration problems and gaps, for the health check. */
  notes: string[];
}

/** What matching needs: the discovered datasets and the spokes to match them against. */
export type SpokeLookup = Pick<ModelCore, 'datasets' | 'matchOrder' | 'spokeCache'>;

/** The spoke a dataset belongs to: the first match, domain spokes before ingest spokes. */
export function spokeOf(model: SpokeLookup, ref: DatasetRef): string | undefined {
  const key = datasetKey(ref);
  if (model.spokeCache.has(key)) return model.spokeCache.get(key);
  const info = model.datasets.get(key);
  const subject = datasetSubject(info?.ref ?? ref, info?.producerTags ?? []);
  const spoke = model.matchOrder.find((candidate) => subjectMatches(candidate.match, subject));
  model.spokeCache.set(key, spoke?.id);
  return spoke?.id;
}

/** Whether a dataset has no known producing job: it comes from outside the observed pipelines. */
export function isExternal(model: Pick<ModelCore, 'datasets'>, ref: DatasetRef): boolean {
  return (model.datasets.get(datasetKey(ref))?.producers.size ?? 0) === 0;
}

/** What a run reads from outside: its unproduced inputs, or the job itself when it reads nothing. */
export function sourcesOf(model: Pick<ModelCore, 'datasets'>, run: Run): SourceRef[] {
  if (run.inputs.length === 0) {
    return [{ key: `job:${run.jobKey}`, name: run.job.name, subject: jobSubject(run.job) }];
  }
  return run.inputs
    .filter((ref) => (model.datasets.get(datasetKey(ref))?.producers.size ?? 0) === 0)
    .map((ref) => ({
      key: `dataset:${datasetKey(ref)}`,
      name: ref.name,
      subject: datasetSubject(ref, []),
    }));
}

export function groupOf(groups: readonly GroupModel[], source: SourceRef): GroupModel | undefined {
  return groups.find((group) => subjectMatches(group.match, source.subject));
}

/** The site of a source in its group; unseen sources map onto the listed sites by hash. */
export function siteOf(group: GroupModel, sourceKey: string): string | undefined {
  const known = group.siteByKey.get(sourceKey);
  if (known !== undefined) return known;
  if (group.sites.length === 0) return undefined;
  return group.sites[hash32(sourceKey) % group.sites.length]?.id;
}

/** Whether none of the run's outputs is read by any known job. */
export function isSinkRun(model: Pick<ModelCore, 'datasets'>, run: Run): boolean {
  return run.outputs.every(
    (ref) => (model.datasets.get(datasetKey(ref))?.consumers.size ?? 0) === 0,
  );
}

/** Use cases whose matcher accepts the sink job of a run. */
export function useCasesOf(
  model: Pick<ModelCore, 'useCases' | 'datasets'>,
  run: Run,
): UseCaseModel[] {
  if (!isSinkRun(model, run)) return [];
  const subject = jobSubject(run.job);
  return model.useCases.filter((useCase) => subjectMatches(useCase.match, subject));
}
