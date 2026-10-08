// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { Id, strictObject } from './strict.js';

const TagMatch = z
  .record(z.string().min(1), z.string().min(1))
  .refine((tags) => Object.keys(tags).length > 0, 'List at least one tag key and value.');

/**
 * Identifies real platform objects without naming them in code. Every field is optional,
 * but at least one must be present; when several are given, all must match.
 */
export const Matcher = strictObject({
  catalog: z.string().min(1).optional(),
  schema: z.string().min(1).optional(),
  tag: TagMatch.optional(),
  pipelineTag: TagMatch.optional(),
  jobTag: TagMatch.optional(),
  dashboardTag: TagMatch.optional(),
  sqlPredicate: z.string().min(1).optional(),
}).refine((m) => Object.keys(m).length > 0, {
  message:
    'A matcher needs at least one of: catalog, schema, tag, pipelineTag, jobTag, dashboardTag, sqlPredicate.',
});

const Freshness = strictObject({
  cadenceMinutes: z.number().positive(),
  targetMinutes: z.number().positive(),
  offsetMinutes: z.number().min(0).default(0),
});

const SpokeFields = {
  name: z.string().min(1),
  role: z.enum(['ingest', 'domain']),
  match: Matcher,
  freshness: Freshness,
  metastore: Id.optional(),
};

const SourceGroupFields = {
  name: z.string().min(1),
  utcOffset: z.number().min(-12).max(14),
  match: Matcher,
};

const UseCaseFields = {
  name: z.string().min(1),
  match: Matcher,
};

const Medallion = strictObject({
  strategy: z.enum(['schema-suffix', 'catalog-prefix', 'tag']),
  bronze: z.array(z.string().min(1)).min(1),
  silver: z.array(z.string().min(1)).min(1),
  gold: z.array(z.string().min(1)).min(1),
});

const Hub = strictObject({ id: Id, name: z.string().min(1) });

/** A fully resolved topology, after `extends` and overrides are applied. */
export const Topology = strictObject({
  hub: Hub,
  spokes: z.array(strictObject({ id: Id, ...SpokeFields })).min(1),
  sourceGroups: z.array(strictObject({ id: Id, ...SourceGroupFields })).default([]),
  useCases: z.array(strictObject({ id: Id, ...UseCaseFields })).default([]),
  medallion: Medallion.optional(),
});

function partialItem<T extends z.ZodRawShape>(fields: T) {
  return strictObject({ id: Id, ...fields })
    .partial()
    .required({ id: true });
}

/**
 * A topology as written in config. It may extend another topology; list entries merge with the
 * base by `id`, and `exclude` drops inherited entries (for example spokes dev does not have).
 * Completeness is checked after resolution, against `Topology`.
 */
export const TopologyInput = strictObject({
  extends: Id.optional(),
  exclude: z.array(Id).optional(),
  hub: Hub.partial().optional(),
  spokes: z.array(partialItem(SpokeFields)).optional(),
  sourceGroups: z.array(partialItem(SourceGroupFields)).optional(),
  useCases: z.array(partialItem(UseCaseFields)).optional(),
  medallion: Medallion.optional(),
});

/** Overrides an environment applies on top of its named topology. */
export const TopologyOverrides = TopologyInput.omit({ extends: true });

export type Matcher = z.infer<typeof Matcher>;
export type Topology = z.infer<typeof Topology>;
export type TopologyInput = z.infer<typeof TopologyInput>;
export type TopologyOverrides = z.infer<typeof TopologyOverrides>;
