// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUERY_NAMES, QUERY_SPECS } from '../src/queries.js';
import { loadQueryRegistry } from '../src/registry.js';

const SQL_DIR = resolve(import.meta.dirname, '../sql');
const read = (name: string): string => readFileSync(resolve(SQL_DIR, `${name}.sql`), 'utf8');
const placeholders = (sql: string): string[] =>
  [
    ...new Set([...sql.matchAll(/(?<![A-Za-z0-9_]):(since|until)\b/g)].map((m) => m[1] ?? '')),
  ].sort();

describe('shipped SQL files', () => {
  it('has exactly one file per allowlisted query name', () => {
    const files = readdirSync(SQL_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.slice(0, -4))
      .sort();

    expect(files).toEqual([...QUERY_NAMES].sort());
  });

  it('passes the read-only allowlist guard and loads into the registry', async () => {
    const registry = await loadQueryRegistry();

    for (const name of QUERY_NAMES) expect(registry.get(name).name).toBe(name);
  });

  describe.each(QUERY_NAMES)('%s', (name) => {
    const sql = read(name);
    const lines = sql.split('\n');

    it('starts with its documentation URL and carries the SPDX header', () => {
      expect(lines[0]).toMatch(/^-- Doc: https:\/\/docs\.databricks\.com\/\S+$/);
      expect(lines.slice(0, 5).join('\n')).toContain('SPDX-License-Identifier: Apache-2.0');
    });

    it('is ordered, limited within its row cap, and uses only its declared parameters', () => {
      const limit = Number(/\bLIMIT (\d+)\s*$/.exec(sql.trim())?.[1]);

      expect(sql).toMatch(/\bORDER BY\b/);
      expect(limit).toBeGreaterThan(0);
      expect(limit).toBeLessThanOrEqual(QUERY_SPECS[name].rowLimit);
      expect(placeholders(sql)).toEqual([...QUERY_SPECS[name].params].sort());
    });
  });

  it('dedupes SCD2 history before filtering deleted rows', () => {
    for (const name of ['pipelines', 'jobs']) {
      const sql = read(name);
      expect(sql).toMatch(
        /ROW_NUMBER\(\) OVER \(PARTITION BY workspace_id, \w+ ORDER BY change_time DESC\)/,
      );
      expect(sql).toMatch(/WHERE rn = 1 AND delete_time IS NULL/);
    }
  });

  it('bounds every time-series query by time', () => {
    const bounded = QUERY_NAMES.filter((n) => QUERY_SPECS[n].params.length === 2);

    expect(bounded).toEqual(
      expect.arrayContaining([
        'job_runs',
        'pipeline_updates',
        'lineage_writes',
        'station_reads',
        'billing_usage',
      ]),
    );
    for (const name of bounded) expect(read(name)).toMatch(/:since/);
  });
});

describe('date partition filters', () => {
  const WIDENED = [
    'lineage_entities',
    'lineage_last_writes',
    'lineage_writes',
    'station_reads',
    'billing_usage',
  ] as const;

  it.each(WIDENED)('%s widens date bounds by a day while keeping exact timestamps', (name) => {
    const sql = read(name).replace(/\s+/g, ' ');

    expect(sql).toContain('DATE_SUB(CAST(:since AS DATE), 1)');
    expect(sql).toContain('DATE_ADD(CAST(:until AS DATE), 1)');
    expect(sql).not.toMatch(/_date >= CAST\(:since AS DATE\)/);
    expect(sql).not.toMatch(/_date <= CAST\(:until AS DATE\)/);
    expect(sql).toMatch(/(event_time|start_time|usage_end_time) >= :since/);
  });
});
