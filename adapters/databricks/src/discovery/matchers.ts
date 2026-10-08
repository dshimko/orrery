// SPDX-License-Identifier: Apache-2.0
// Spoke, source-group, and use-case matchers evaluated against discovered objects.
//
// Clauses split in two kinds. Schema clauses (`catalog`, `schema`, `tag`) describe where data
// lives and are evaluated against schemas, with the catalog's environment tag stripped.
// Workload clauses (`pipelineTag`, `jobTag`) describe pipelines and jobs.
import { matchGlob, type Matcher } from '@orrery/core';
import { tagsContain, type Tags } from '../rows.js';
import type { ObjectKind } from './types.js';

/** What a schema looks like to a matcher. */
export interface SchemaFacts {
  /** Catalog name without the environment tag. */
  base: string;
  schema: string;
  /** Catalog tags overlaid with schema tags. */
  tags: Tags;
}

export function hasSchemaClauses(matcher: Matcher): boolean {
  return matcher.catalog !== undefined || matcher.schema !== undefined || matcher.tag !== undefined;
}

function hasWorkloadClauses(matcher: Matcher): boolean {
  return matcher.pipelineTag !== undefined || matcher.jobTag !== undefined;
}

/** Whether the schema satisfies every schema clause. False when the matcher has none. */
export function schemaMatches(matcher: Matcher, facts: SchemaFacts): boolean {
  if (!hasSchemaClauses(matcher)) return false;
  if (matcher.catalog !== undefined && !matchGlob(matcher.catalog, facts.base)) return false;
  if (matcher.schema !== undefined && !matchGlob(matcher.schema, facts.schema)) return false;
  return matcher.tag === undefined || tagsContain(facts.tags, matcher.tag);
}

/**
 * Whether a pipeline or job belongs to the matcher. Workload clauses must match its own tags.
 * Schema clauses must match at least one schema it writes to; when its writes are unknown they
 * cannot be checked, and the workload clauses decide alone.
 */
export function objectMatches(
  matcher: Matcher,
  kind: ObjectKind,
  tags: Tags,
  written: readonly SchemaFacts[],
): boolean {
  const workload = kind === 'pipeline' ? matcher.pipelineTag : matcher.jobTag;
  if (hasWorkloadClauses(matcher)) {
    if (workload === undefined || !tagsContain(tags, workload)) return false;
    if (!hasSchemaClauses(matcher) || written.length === 0) return true;
    return written.some((facts) => schemaMatches(matcher, facts));
  }
  return written.some((facts) => schemaMatches(matcher, facts));
}
