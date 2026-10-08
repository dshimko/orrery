// SPDX-License-Identifier: Apache-2.0
// Internal contracts of the Databricks adapter. Everything that talks to Databricks goes
// through `SqlClient`, so tests swap in recorded fixtures and the browser never sees a token.

/** A named statement parameter (SQL Statement Execution API `parameters`). */
export interface SqlParam {
  name: string;
  value: string | null;
  type: 'STRING' | 'INT' | 'BIGINT' | 'DOUBLE' | 'BOOLEAN' | 'TIMESTAMP' | 'DATE';
}

export interface QueryOptions {
  /** Hard cap on returned rows; every query has one (hardening). */
  rowLimit: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** One result row keyed by column name. JSON_ARRAY results arrive as strings or null. */
export type Row = Readonly<Record<string, string | null>>;

/** A query from the allowlist: shipped `.sql` files plus fork-registered overrides. */
export interface AllowedQuery {
  name: string;
  sql: string;
  /** Where it came from, for logs and docs. */
  source: string;
}

export interface SqlClient {
  /** Runs one allowlisted query. Implementations never accept free-form SQL from callers. */
  execute(query: AllowedQuery, params: readonly SqlParam[], options: QueryOptions): Promise<Row[]>;
}

/** Supplies a bearer token per request (service principal, PAT, or the forwarded user). */
export interface TokenProvider {
  token(signal?: AbortSignal): Promise<string>;
  /** Stable key for caches: results must never be shared across viewers in OBO mode. */
  cacheKey(): string;
}

/** Connection target for one metastore (or the single workspace). */
export interface Target {
  /** Metastore id from config, or 'primary'. */
  metastore: string;
  host: string;
  warehouseId: string;
}

/** The query allowlist an adapter reads from. */
export interface QuerySource {
  /** Throws when the name is not allowlisted. */
  get(name: string): AllowedQuery;
  names(): readonly string[];
}

/** Raised by clients; `code` is safe to log, `message` never contains tokens or SQL text. */
export class SqlError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'permission_denied'
      | 'timeout'
      | 'canceled'
      | 'rate_limited'
      | 'too_large'
      | 'failed'
      | 'auth',
    message: string,
    readonly query?: string,
  ) {
    super(message);
    this.name = 'SqlError';
  }
}
