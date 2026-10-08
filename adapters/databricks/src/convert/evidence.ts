// SPDX-License-Identifier: Apache-2.0
// Parses raw statement rows into typed evidence records. Pure: the same rows give the same
// records, and rows that cannot be understood are skipped rather than guessed at.
import type { Row } from '../contracts.js';
import type { QueryName } from '../queries.js';
import { amount, integer, parseTags, schemaKey, text, time, type Tags } from '../rows.js';
import { objectKey, type ObjectKind } from '../discovery/types.js';

export type RunOutcome = 'success' | 'failed' | 'blocked' | 'running' | 'ignored';

export interface RunRecord {
  objectKey: string;
  kind: ObjectKind;
  runKey: string;
  startedMs: number;
  endedMs: number;
  outcome: RunOutcome;
  /** Raw result_state, for alert text. */
  state: string;
  /** Job that triggered a pipeline update, when the platform reports it. */
  triggerJobKey?: string;
}

export interface LineageWrite {
  minuteMs: number;
  entityType: string;
  targetKey: string;
}

export interface ReadRecord {
  minuteMs: number;
  catalog: string;
  schema: string;
  statements: number;
}

export interface GateRecord {
  objectKey: string;
  minuteMs: number;
  passed: number;
  failed: number;
}

export interface ChangeRecord {
  objectKey: string;
  name: string;
  tags: Tags;
  changedMs: number;
  deleted: boolean;
}

export interface QualityRecord {
  schemaKey: string;
  lastCommitMs: number;
  eventMs: number;
}

export interface LastWrite {
  schemaKey: string;
  lastMs: number;
}

export type RowSets = Partial<Readonly<Record<QueryName, readonly Row[]>>>;

export interface Evidence {
  runs: RunRecord[];
  writes: LineageWrite[];
  reads: ReadRecord[];
  gates: GateRecord[];
  changes: ChangeRecord[];
  quality: QualityRecord[];
  lastWrites: LastWrite[];
  /** Estimated list-price spend over the billing window, in the reporting currency. */
  spendTotal: number;
}

const JOB_FAILED = new Set(['FAILED', 'ERROR', 'TIMED_OUT']);

function jobOutcome(state: string | undefined): RunOutcome {
  const value = state?.toUpperCase();
  if (value === undefined) return 'running';
  if (value === 'SUCCEEDED') return 'success';
  if (JOB_FAILED.has(value)) return 'failed';
  return value === 'BLOCKED' ? 'blocked' : 'ignored';
}

function pipelineOutcome(state: string | undefined): RunOutcome {
  const value = state?.toUpperCase();
  if (value === undefined) return 'running';
  if (value === 'COMPLETED') return 'success';
  return value === 'FAILED' ? 'failed' : 'ignored';
}

function parseRun(row: Row, kind: ObjectKind): RunRecord | undefined {
  const workspace = text(row, 'workspace_id');
  const id = text(row, kind === 'job' ? 'job_id' : 'pipeline_id');
  const run = text(row, kind === 'job' ? 'run_id' : 'update_id');
  const endedMs = time(row, 'ended_at');
  if (!workspace || !id || !run || endedMs === undefined) return undefined;
  const state = text(row, 'result_state');
  const triggerJob = text(row, 'trigger_job_id');
  const key = objectKey(kind, workspace, id);
  return {
    objectKey: key,
    kind,
    runKey: `${key}:${run}`,
    startedMs: time(row, 'started_at') ?? endedMs,
    endedMs,
    outcome: kind === 'job' ? jobOutcome(state) : pipelineOutcome(state),
    state: state ?? 'RUNNING',
    ...(triggerJob ? { triggerJobKey: objectKey('job', workspace, triggerJob) } : {}),
  };
}

function parseRuns(jobs: readonly Row[], pipelines: readonly Row[]): RunRecord[] {
  const byKey = new Map<string, RunRecord>();
  const add = (record: RunRecord | undefined): void => {
    if (record) byKey.set(record.runKey, record);
  };
  for (const row of jobs) add(parseRun(row, 'job'));
  for (const row of pipelines) add(parseRun(row, 'pipeline'));
  return [...byKey.values()].sort(
    (a, b) => a.endedMs - b.endedMs || a.runKey.localeCompare(b.runKey),
  );
}

function parseWrites(rows: readonly Row[]): LineageWrite[] {
  return rows.flatMap((row) => {
    const minuteMs = time(row, 'event_minute');
    const catalog = text(row, 'target_table_catalog');
    const schema = text(row, 'target_table_schema');
    if (minuteMs === undefined || !catalog || !schema) return [];
    return [
      {
        minuteMs,
        entityType: text(row, 'entity_type') ?? 'UNKNOWN',
        targetKey: schemaKey(catalog, schema),
      },
    ];
  });
}

function parseReads(rows: readonly Row[]): ReadRecord[] {
  return rows.flatMap((row) => {
    const minuteMs = time(row, 'read_minute');
    const catalog = text(row, 'source_table_catalog');
    const schema = text(row, 'source_table_schema');
    if (minuteMs === undefined || !catalog || !schema) return [];
    return [{ minuteMs, catalog, schema, statements: Math.max(1, integer(row, 'statements')) }];
  });
}

function parseGates(rows: readonly Row[]): GateRecord[] {
  return rows.flatMap((row) => {
    const workspace = text(row, 'workspace_id');
    const pipeline = text(row, 'pipeline_id');
    const minuteMs = time(row, 'event_minute');
    if (!workspace || !pipeline || minuteMs === undefined) return [];
    return [
      {
        objectKey: objectKey('pipeline', workspace, pipeline),
        minuteMs,
        passed: integer(row, 'passed'),
        failed: integer(row, 'failed'),
      },
    ];
  });
}

function parseChanges(rows: readonly Row[]): ChangeRecord[] {
  return rows.flatMap((row) => {
    const workspace = text(row, 'workspace_id');
    const job = text(row, 'job_id');
    const changedMs = time(row, 'change_time');
    if (!workspace || !job || changedMs === undefined) return [];
    return [
      {
        objectKey: objectKey('job', workspace, job),
        name: text(row, 'name') ?? job,
        tags: parseTags(row['tags_json']),
        changedMs,
        deleted: time(row, 'delete_time') !== undefined,
      },
    ];
  });
}

function parseQuality(rows: readonly Row[]): QualityRecord[] {
  return rows.flatMap((row) => {
    const catalog = text(row, 'catalog_name');
    const schema = text(row, 'schema_name');
    const lastCommitMs = time(row, 'last_commit');
    if (!catalog || !schema || lastCommitMs === undefined) return [];
    return [
      {
        schemaKey: schemaKey(catalog, schema),
        lastCommitMs,
        eventMs: time(row, 'event_time') ?? lastCommitMs,
      },
    ];
  });
}

function parseLastWrites(rows: readonly Row[]): LastWrite[] {
  return rows.flatMap((row) => {
    const catalog = text(row, 'target_table_catalog');
    const schema = text(row, 'target_table_schema');
    const lastMs = time(row, 'last_write');
    return catalog && schema && lastMs !== undefined
      ? [{ schemaKey: schemaKey(catalog, schema), lastMs }]
      : [];
  });
}

/** Turns whatever row sets were fetched into evidence. Missing sets are simply empty. */
export function parseEvidence(rows: RowSets): Evidence {
  const get = (name: QueryName): readonly Row[] => rows[name] ?? [];
  return {
    runs: parseRuns(get('job_runs'), get('pipeline_updates')),
    writes: parseWrites(get('lineage_writes')),
    reads: parseReads(get('station_reads')),
    gates: parseGates(get('pipeline_expectations')),
    changes: parseChanges(get('job_changes')),
    quality: parseQuality(get('table_freshness')),
    lastWrites: parseLastWrites(get('lineage_last_writes')),
    spendTotal: get('billing_usage').reduce((sum, row) => sum + amount(row, 'est_cost'), 0),
  };
}

/** The release tag value of a change, when the job carries the configured release tag. */
export function releaseOf(change: ChangeRecord, tagKey: string): string | undefined {
  if (change.deleted) return undefined;
  const wanted = tagKey.toLowerCase();
  for (const [key, value] of Object.entries(change.tags)) {
    if (key.toLowerCase() === wanted && value !== '') return value;
  }
  return undefined;
}
