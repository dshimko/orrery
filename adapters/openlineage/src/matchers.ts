// SPDX-License-Identifier: Apache-2.0
// Config matchers evaluated against OpenLineage datasets and jobs.
//
//   catalog                    glob on the namespace (dataset or job)
//   schema                     glob on the name, or on its first dotted segment
//   tag                        the `tags` facet of the dataset (or job)
//   jobTag / pipelineTag       tags and jobType facets of the job (for a dataset: of its producers)
//
// All given clauses must match. `sqlPredicate` and `dashboardTag` cannot be evaluated from run
// events, so a matcher that uses either never matches (reported in health).
import { matchGlob, type Matcher } from '@orrery/core';
import type { DatasetRef, JobRef, Tags } from './types.js';

/** What a matcher looks at. */
export interface Subject {
  namespace: string;
  name: string;
  tags: Tags;
  /** Tag maps of the jobs behind the subject: its producers (dataset) or itself (job). */
  jobTags: readonly Tags[];
}

export function datasetSubject(ref: DatasetRef, producerTags: readonly Tags[]): Subject {
  return { namespace: ref.namespace, name: ref.name, tags: ref.tags, jobTags: producerTags };
}

export function jobSubject(job: JobRef): Subject {
  return { namespace: job.namespace, name: job.name, tags: job.tags, jobTags: [job.tags] };
}

/** Names of clauses this adapter cannot evaluate. */
export function unsupportedClauses(matcher: Matcher): string[] {
  const names: string[] = [];
  if (matcher.sqlPredicate !== undefined) names.push('sqlPredicate');
  if (matcher.dashboardTag !== undefined) names.push('dashboardTag');
  return names;
}

function lowered(tags: Tags): Map<string, string> {
  return new Map(
    Object.entries(tags).map(([key, value]) => [key.toLowerCase(), value.toLowerCase()]),
  );
}

/** Whether `tags` carry every wanted key with an equal value, ignoring case. */
export function tagsContain(tags: Tags, wanted: Readonly<Record<string, string>>): boolean {
  const have = lowered(tags);
  return Object.entries(wanted).every(
    ([key, value]) => have.get(key.toLowerCase()) === value.toLowerCase(),
  );
}

function nameMatches(glob: string, name: string): boolean {
  const first = name.split('.')[0] ?? name;
  return matchGlob(glob, name) || matchGlob(glob, first);
}

export function subjectMatches(matcher: Matcher, subject: Subject): boolean {
  if (unsupportedClauses(matcher).length > 0) return false;
  if (matcher.catalog !== undefined && !matchGlob(matcher.catalog, subject.namespace)) return false;
  if (matcher.schema !== undefined && !nameMatches(matcher.schema, subject.name)) return false;
  if (matcher.tag !== undefined && !tagsContain(subject.tags, matcher.tag)) return false;
  for (const wanted of [matcher.jobTag, matcher.pipelineTag]) {
    if (wanted !== undefined && !subject.jobTags.some((tags) => tagsContain(tags, wanted))) {
      return false;
    }
  }
  return true;
}
