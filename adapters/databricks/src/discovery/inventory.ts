// SPDX-License-Identifier: Apache-2.0
// Reads one metastore target's catalogs, schemas, tags, pipelines, jobs, and lineage attribution.
// A target whose catalog list cannot be read is reported unavailable instead of failing.
import type { CatalogInfo } from '@orrery/core';
import { SqlError, type Row, type Target } from '../contracts.js';
import { CLASS_INTERVAL_MS, type QueryName } from '../queries.js';
import { integer, parseTags, schemaKey, slug, text, type Tags } from '../rows.js';
import { describeFailure, type Sources } from '../sources.js';
import { MS_PER_DAY, windowEndingAt } from '../time.js';
import {
  type EntityWrite,
  type ObjectKind,
  type PlatformObject,
  type SchemaInfo,
  type TargetInventory,
} from './types.js';

/** How far back lineage looks for which schemas a job or pipeline writes to. */
export const ENTITY_LOOKBACK_MS = 7 * MS_PER_DAY;

function tagMaps(rows: readonly Row[], keyOf: (row: Row) => string | undefined): Map<string, Tags> {
  const grouped = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const key = keyOf(row);
    const name = text(row, 'tag_name');
    if (key === undefined || name === undefined) continue;
    const tags = grouped.get(key) ?? {};
    tags[name] = text(row, 'tag_value') ?? '';
    grouped.set(key, tags);
  }
  return grouped;
}

function toObjects(rows: readonly Row[], kind: ObjectKind): PlatformObject[] {
  const idColumn = kind === 'job' ? 'job_id' : 'pipeline_id';
  return rows.flatMap((row) => {
    const id = text(row, idColumn);
    const workspaceId = text(row, 'workspace_id');
    if (id === undefined || workspaceId === undefined) return [];
    return [
      {
        kind,
        workspaceId,
        id,
        name: text(row, 'name') ?? id,
        tags: parseTags(row['tags_json']),
        streaming: kind === 'pipeline' && text(row, 'continuous')?.toLowerCase() === 'true',
      },
    ];
  });
}

function toWrites(rows: readonly Row[]): EntityWrite[] {
  return rows.flatMap((row) => {
    const type = text(row, 'entity_type')?.toUpperCase();
    const id = text(row, 'entity_id');
    const workspaceId = text(row, 'workspace_id');
    const catalog = text(row, 'target_table_catalog');
    const schema = text(row, 'target_table_schema');
    if (!id || !workspaceId || !catalog || !schema) return [];
    if (type !== 'JOB' && type !== 'PIPELINE') return [];
    return [
      {
        kind: type === 'JOB' ? ('job' as const) : ('pipeline' as const),
        workspaceId,
        id,
        catalog,
        schema,
      },
    ];
  });
}

function toSchemas(
  rows: readonly Row[],
  metastore: string,
  schemaTags: ReadonlyMap<string, Tags>,
): SchemaInfo[] {
  return rows.flatMap((row) => {
    const catalog = text(row, 'catalog_name');
    const schema = text(row, 'schema_name');
    if (!catalog || !schema) return [];
    return [{ catalog, schema, metastore, tags: schemaTags.get(schemaKey(catalog, schema)) ?? {} }];
  });
}

/** Loads one target. Only the catalog list is required; everything else degrades. */
export async function loadInventory(
  sources: Sources,
  target: Target,
  nowMs: number,
  signal?: AbortSignal,
): Promise<TargetInventory> {
  const { metastore } = target;
  let catalogRows: Row[];
  try {
    catalogRows = await sources.required(target, 'catalogs', undefined, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      metastore,
      available: false,
      error: describeFailure(error),
      ...(error instanceof SqlError ? { errorCode: error.code } : {}),
      catalogs: [],
      schemas: [],
      tableCounts: new Map(),
      foreign: [],
      objects: [],
      writes: [],
    };
  }
  const lineage = windowEndingAt(nowMs, ENTITY_LOOKBACK_MS, CLASS_INTERVAL_MS.topology);
  const get = (name: QueryName, window?: typeof lineage) =>
    sources.optional(target, name, window, signal);
  const [
    catalogTagRows,
    schemaRows,
    schemaTagRows,
    tableRows,
    foreignRows,
    pipelines,
    jobs,
    writes,
  ] = await Promise.all([
    sources.attempt(target, 'catalog_tags', undefined, signal),
    get('schemas'),
    get('schema_tags'),
    get('schema_tables'),
    get('foreign_catalogs'),
    get('pipelines'),
    get('jobs'),
    get('lineage_entities', lineage),
  ]);
  const tagsByCatalog = tagMaps(catalogTagRows ?? [], (row) =>
    text(row, 'catalog_name')?.toLowerCase(),
  );
  const tagsBySchema = tagMaps(schemaTagRows, (row) => {
    const catalog = text(row, 'catalog_name');
    const schema = text(row, 'schema_name');
    return catalog && schema ? schemaKey(catalog, schema) : undefined;
  });
  const catalogs: CatalogInfo[] = catalogRows.flatMap((row) => {
    const name = text(row, 'catalog_name');
    return name ? [{ name, tags: tagsByCatalog.get(name.toLowerCase()) ?? {} }] : [];
  });
  const tableCounts = new Map<string, number>();
  for (const row of tableRows) {
    const catalog = text(row, 'table_catalog');
    const schema = text(row, 'table_schema');
    if (catalog && schema) tableCounts.set(schemaKey(catalog, schema), integer(row, 'table_count'));
  }
  return {
    metastore,
    available: true,
    ...(catalogTagRows === undefined ? { tagsUnavailable: true } : {}),
    catalogs,
    schemas: toSchemas(schemaRows, metastore, tagsBySchema),
    tableCounts,
    foreign: foreignRows.flatMap((row) => text(row, 'table_catalog') ?? []),
    objects: [...toObjects(pipelines, 'pipeline'), ...toObjects(jobs, 'job')],
    writes: toWrites(writes),
  };
}

/** Topology id of a foreign catalog. */
export function foreignId(catalog: string): string {
  return slug(catalog);
}
