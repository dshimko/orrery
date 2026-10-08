// SPDX-License-Identifier: Apache-2.0
// Test double for the Statement API client: serves recorded rows from
// test/fixtures/<scenario>/<query>.json, records every call, and can fail chosen queries.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SqlError,
  type AllowedQuery,
  type QueryOptions,
  type Row,
  type SqlClient,
  type SqlParam,
  type Target,
  type TokenProvider,
} from '../../src/contracts.js';

const FIXTURES = resolve(import.meta.dirname, '../fixtures');

export interface RecordedCall {
  metastore: string;
  query: string;
  params: readonly SqlParam[];
  rowLimit: number;
}

type Failure = { metastore: string; query: string; error: SqlError };

/** Shared state for every FixtureClient of one test: scenarios per metastore, calls, failures. */
export class FixtureWorld {
  readonly calls: RecordedCall[] = [];
  private readonly failures: Failure[] = [];

  /** `scenarios` maps a metastore id (target) to a directory name under test/fixtures. */
  constructor(private readonly scenarios: Readonly<Record<string, string>>) {}

  /** Makes `query` fail on `metastore`; use '*' for either to match any. */
  failQuery(metastore: string, query: string, error: SqlError): void {
    this.failures.push({ metastore, query, error });
  }

  clearFailures(): void {
    this.failures.length = 0;
  }

  failureFor(metastore: string, query: string): SqlError | undefined {
    return this.failures.find(
      (f) =>
        (f.metastore === '*' || f.metastore === metastore) &&
        (f.query === '*' || f.query === query),
    )?.error;
  }

  rowsFor(metastore: string, query: string): Row[] {
    const scenario = this.scenarios[metastore];
    if (scenario === undefined)
      throw new Error(`No fixture scenario for metastore "${metastore}".`);
    try {
      return JSON.parse(
        readFileSync(resolve(FIXTURES, scenario, `${query}.json`), 'utf8'),
      ) as Row[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  callsTo(query: string): RecordedCall[] {
    return this.calls.filter((call) => call.query === query);
  }

  readonly clientFor = (target: Target, _tokens: TokenProvider): SqlClient =>
    new FixtureClient(this, target.metastore);

  /** A token provider with a fixed cache key (service-principal style). */
  readonly tokensFor = (_target: Target): TokenProvider => staticTokens('fixture');
}

export function staticTokens(cacheKey: string): TokenProvider {
  return { token: async () => 'fixture-token', cacheKey: () => cacheKey };
}

const PLACEHOLDER = /:(since|until)\b/g;

/** Mirrors the real API: every supplied parameter is referenced, every reference is supplied. */
function checkParams(query: AllowedQuery, params: readonly SqlParam[]): void {
  const referenced = new Set([...query.sql.matchAll(PLACEHOLDER)].map((m) => m[1]));
  const supplied = new Set(params.map((p) => p.name));
  for (const name of supplied) {
    if (!referenced.has(name)) throw new Error(`Query ${query.name} does not use :${name}.`);
  }
  for (const name of referenced) {
    if (!supplied.has(name ?? '')) throw new Error(`Query ${query.name} needs :${name}.`);
  }
}

export class FixtureClient implements SqlClient {
  constructor(
    private readonly world: FixtureWorld,
    private readonly metastore: string,
  ) {}

  async execute(
    query: AllowedQuery,
    params: readonly SqlParam[],
    options: QueryOptions,
  ): Promise<Row[]> {
    this.world.calls.push({
      metastore: this.metastore,
      query: query.name,
      params,
      rowLimit: options.rowLimit,
    });
    checkParams(query, params);
    const failure = this.world.failureFor(this.metastore, query.name);
    if (failure) throw failure;
    return this.world.rowsFor(this.metastore, query.name).slice(0, options.rowLimit);
  }
}
