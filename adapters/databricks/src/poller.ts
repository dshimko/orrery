// SPDX-License-Identifier: Apache-2.0
// Runs allowlisted queries with an in-memory TTL cache, request de-duplication, a per-environment
// concurrency cap, and row/time limits. Cache keys include the token provider's cacheKey(), so
// on-behalf-of viewers never share results.
import {
  SqlError,
  type QuerySource,
  type Row,
  type SqlClient,
  type SqlParam,
  type Target,
  type TokenProvider,
} from './contracts.js';
import {
  CLASS_INTERVAL_MS,
  MAX_CONCURRENT_QUERIES,
  QUERY_SPECS,
  QUERY_TIMEOUT_MS,
  type QueryName,
} from './queries.js';
import type { TimeWindow } from './time.js';

const MAX_CACHE_ENTRIES = 256;
/** Estimated memory bound: the cache never holds more rows than this across all entries. */
const MAX_CACHE_ROWS = 200_000;
/** How long a task may wait for a statement slot before it fails with a timeout. */
export const QUEUE_TIMEOUT_MS = 30_000;
/** A failed query is remembered briefly so a down metastore is not hammered by every request. */
const FAILURE_TTL_MS = 15_000;

export interface PollerDeps {
  queries: QuerySource;
  clientFor: (target: Target, tokens: TokenProvider) => SqlClient;
  tokensFor: (target: Target) => TokenProvider;
  now: () => Date;
  /** Shutdown signal: aborts in-flight statements. */
  signal?: AbortSignal;
  /** Longest wait for a statement slot (default 30 s). */
  queueTimeoutMs?: number;
}

/** `snapshot` (snapshots and topology) is served before `events` (event-window) queries. */
export type Priority = 'snapshot' | 'events';

interface Entry {
  expiresAt: number;
  promise: Promise<Row[]>;
  /** Rows held once the query settles; 0 while in flight or after a failure. */
  rows: number;
}

interface Waiter {
  priority: Priority;
  grant: () => void;
}

class Semaphore {
  private active = 0;
  private readonly waiting: Waiter[] = [];

  constructor(
    private readonly limit: number,
    private readonly maxWaitMs: number,
  ) {}

  async use<T>(task: () => Promise<T>, priority: Priority): Promise<T> {
    if (this.active < this.limit) this.active += 1;
    else await this.acquire(priority);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  /** Hands the slot to the next waiter (snapshot first, then oldest), or frees it. */
  private release(): void {
    const index = this.waiting.findIndex((w) => w.priority === 'snapshot');
    const [next] = this.waiting.splice(index === -1 ? 0 : index, 1);
    if (next) next.grant();
    else this.active -= 1;
  }

  private acquire(priority: Priority): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        priority,
        grant: () => {
          clearTimeout(timer);
          resolve();
        },
      };
      const timer = setTimeout(() => {
        const at = this.waiting.indexOf(waiter);
        if (at !== -1) this.waiting.splice(at, 1);
        reject(new SqlError('timeout', 'Timed out waiting for a free statement slot.'));
      }, this.maxWaitMs);
      this.waiting.push(waiter);
    });
  }
}

function paramValues(spec: (typeof QUERY_SPECS)[QueryName], window?: TimeWindow): SqlParam[] {
  return spec.params.map((key) => {
    if (!window) throw new Error(`Query needs a ${key} parameter but no window was given.`);
    const date = key === 'since' ? window.since : window.until;
    return { name: key, value: date.toISOString(), type: 'TIMESTAMP' as const };
  });
}

/** Resolves with `promise`, or rejects when `signal` aborts (the shared work keeps running). */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('The request was aborted.');
}

export class QueryPoller {
  private readonly cache = new Map<string, Entry>();
  private readonly clients = new Map<string, SqlClient>();
  private readonly tokens = new Map<string, TokenProvider>();
  private readonly gate: Semaphore;
  private cachedRows = 0;
  private readonly truncatedNames = new Set<string>();

  constructor(private readonly deps: PollerDeps) {
    this.gate = new Semaphore(MAX_CONCURRENT_QUERIES, deps.queueTimeoutMs ?? QUEUE_TIMEOUT_MS);
  }

  /** Names of queries whose last result hit its row limit (the view may be incomplete). */
  truncated(): string[] {
    return [...this.truncatedNames].sort();
  }

  private tokensOf(target: Target): TokenProvider {
    const existing = this.tokens.get(target.metastore);
    if (existing) return existing;
    const created = this.deps.tokensFor(target);
    this.tokens.set(target.metastore, created);
    return created;
  }

  private clientOf(target: Target, tokens: TokenProvider): SqlClient {
    const existing = this.clients.get(target.metastore);
    if (existing) return existing;
    const created = this.deps.clientFor(target, tokens);
    this.clients.set(target.metastore, created);
    return created;
  }

  /** Runs `name` against `target`, serving a fresh cached result when there is one. */
  run(
    target: Target,
    name: QueryName,
    window?: TimeWindow,
    signal?: AbortSignal,
    priority: Priority = 'snapshot',
  ): Promise<Row[]> {
    const spec = QUERY_SPECS[name];
    const params = paramValues(spec, window);
    const tokens = this.tokensOf(target);
    const key = [
      tokens.cacheKey(),
      target.host,
      target.warehouseId,
      name,
      ...params.map((p) => p.value),
    ].join('|');
    const nowMs = this.deps.now().getTime();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > nowMs) return abortable(hit.promise, signal);

    const entry: Entry = {
      expiresAt: nowMs + CLASS_INTERVAL_MS[spec.cls],
      promise: this.execute(target, tokens, name, params, priority),
      rows: 0,
    };
    entry.promise.then(
      (rows) => {
        if (this.cache.get(key) !== entry) return;
        entry.rows = rows.length;
        this.cachedRows += rows.length;
        this.enforceBounds(this.deps.now().getTime());
      },
      () => {
        entry.expiresAt = this.deps.now().getTime() + FAILURE_TTL_MS;
      },
    );
    this.store(key, entry, nowMs);
    return abortable(entry.promise, signal);
  }

  private execute(
    target: Target,
    tokens: TokenProvider,
    name: QueryName,
    params: SqlParam[],
    priority: Priority,
  ): Promise<Row[]> {
    const spec = QUERY_SPECS[name];
    return this.gate.use(async () => {
      const query = this.deps.queries.get(name);
      const rows = await this.clientOf(target, tokens).execute(query, params, {
        rowLimit: spec.rowLimit,
        timeoutMs: QUERY_TIMEOUT_MS,
        ...(this.deps.signal ? { signal: this.deps.signal } : {}),
      });
      const flag = `${name}@${target.metastore}`;
      if (rows.length >= spec.rowLimit) this.truncatedNames.add(flag);
      else this.truncatedNames.delete(flag);
      return rows;
    }, priority);
  }

  private drop(key: string): void {
    const old = this.cache.get(key);
    if (!old) return;
    this.cachedRows -= old.rows;
    this.cache.delete(key);
  }

  private store(key: string, entry: Entry, nowMs: number): void {
    this.drop(key);
    this.cache.set(key, entry);
    this.enforceBounds(nowMs);
  }

  /** Drops expired entries, then the oldest ones while the entry or row bound is exceeded. */
  private enforceBounds(nowMs: number): void {
    for (const [key, entry] of [...this.cache]) {
      if (entry.expiresAt <= nowMs) this.drop(key);
    }
    for (const key of [...this.cache.keys()]) {
      if (this.cache.size <= MAX_CACHE_ENTRIES && this.cachedRows <= MAX_CACHE_ROWS) break;
      if (this.cache.size <= 1) break;
      this.drop(key);
    }
  }

  /** Number of cached entries (for tests and diagnostics). */
  size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
    this.cachedRows = 0;
  }
}
