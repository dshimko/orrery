// SPDX-License-Identifier: Apache-2.0
// The allowlisted query names the adapter uses, with their polling class, parameters, and row
// limits. The SQL itself lives in `sql/<name>.sql`; a fork can override any file by path.
import { MS_PER_HOUR, MS_PER_MINUTE } from './time.js';

/** Polling classes (spec: topology hourly, freshness every 5 min, run timelines every 30 s). */
export type QueryClass = 'topology' | 'freshness' | 'timeline';

export const CLASS_INTERVAL_MS: Readonly<Record<QueryClass, number>> = {
  topology: MS_PER_HOUR,
  freshness: 5 * MS_PER_MINUTE,
  timeline: 30_000,
};

export type ParamKey = 'since' | 'until';

export interface QuerySpec {
  cls: QueryClass;
  params: readonly ParamKey[];
  /** Hard cap enforced by the client; at least the LIMIT in the SQL file. */
  rowLimit: number;
}

const LIST = 5_000;
const WINDOW = 50_000;
const NONE: readonly ParamKey[] = [];
const RANGE: readonly ParamKey[] = ['since', 'until'];

export const QUERY_SPECS = {
  catalogs: { cls: 'topology', params: NONE, rowLimit: LIST },
  catalog_tags: { cls: 'topology', params: NONE, rowLimit: 20_000 },
  schemas: { cls: 'topology', params: NONE, rowLimit: 20_000 },
  schema_tags: { cls: 'topology', params: NONE, rowLimit: WINDOW },
  schema_tables: { cls: 'topology', params: NONE, rowLimit: 20_000 },
  foreign_catalogs: { cls: 'topology', params: NONE, rowLimit: 1_000 },
  pipelines: { cls: 'topology', params: NONE, rowLimit: 20_000 },
  jobs: { cls: 'topology', params: NONE, rowLimit: 20_000 },
  lineage_entities: { cls: 'topology', params: RANGE, rowLimit: WINDOW },
  lineage_last_writes: { cls: 'freshness', params: RANGE, rowLimit: 20_000 },
  table_freshness: { cls: 'freshness', params: RANGE, rowLimit: 20_000 },
  job_changes: { cls: 'freshness', params: RANGE, rowLimit: WINDOW },
  billing_usage: { cls: 'freshness', params: RANGE, rowLimit: LIST },
  job_runs: { cls: 'timeline', params: RANGE, rowLimit: WINDOW },
  pipeline_updates: { cls: 'timeline', params: RANGE, rowLimit: WINDOW },
  lineage_writes: { cls: 'timeline', params: RANGE, rowLimit: WINDOW },
  station_reads: { cls: 'timeline', params: RANGE, rowLimit: WINDOW },
  pipeline_expectations: { cls: 'timeline', params: RANGE, rowLimit: WINDOW },
} as const satisfies Record<string, QuerySpec>;

export type QueryName = keyof typeof QUERY_SPECS;

export const QUERY_NAMES = Object.keys(QUERY_SPECS) as QueryName[];

/** Per-statement timeout; the hardening rule caps it at 30 s. */
export const QUERY_TIMEOUT_MS = 30_000;
/** At most this many statements in flight per environment. */
export const MAX_CONCURRENT_QUERIES = 4;
