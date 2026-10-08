// SPDX-License-Identifier: Apache-2.0
// Fetches query results across the environment's metastore targets and tracks which optional
// queries degraded, so health can report them without failing the environment.
import { SqlError, type Row, type Target } from './contracts.js';
import type { Priority, QueryPoller } from './poller.js';
import type { QueryName } from './queries.js';
import type { TimeWindow } from './time.js';

/** Safe, short description of a query failure (never contains SQL text or tokens). */
export function describeFailure(error: unknown): string {
  if (error instanceof SqlError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : 'unknown error';
}

/**
 * Rethrows when the work itself was aborted, so cancellations are not mistaken for outages, and
 * on authentication failures (an expired token fails every query; callers must see it).
 */
function rethrowIfAborted(error: unknown, signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw error;
  if (error instanceof SqlError && (error.code === 'canceled' || error.code === 'auth'))
    throw error;
}

/** Optional queries that failed on the last attempt, keyed `name@metastore`. */
export class Degradations {
  private readonly notes = new Map<string, string>();

  record(name: string, metastore: string, reason: string): void {
    this.notes.set(`${name}@${metastore}`, reason);
  }

  resolve(name: string, metastore: string): void {
    this.notes.delete(`${name}@${metastore}`);
  }

  messages(): string[] {
    return [...this.notes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, reason]) => `Optional query ${key} unavailable (${reason}).`);
  }
}

export class Sources {
  constructor(
    private readonly poller: QueryPoller,
    readonly targets: readonly Target[],
    readonly degraded: Degradations,
  ) {}

  /** One query on one target; failures propagate. */
  required(
    target: Target,
    name: QueryName,
    window?: TimeWindow,
    signal?: AbortSignal,
    priority?: Priority,
  ): Promise<Row[]> {
    return this.poller.run(target, name, window, signal, priority);
  }

  /** One query on one target; a failure degrades health and yields no rows. */
  async optional(
    target: Target,
    name: QueryName,
    window?: TimeWindow,
    signal?: AbortSignal,
    priority?: Priority,
  ): Promise<Row[]> {
    return (await this.attempt(target, name, window, signal, priority)) ?? [];
  }

  /** Like `optional`, but returns undefined when the query failed, so callers can tell. */
  async attempt(
    target: Target,
    name: QueryName,
    window?: TimeWindow,
    signal?: AbortSignal,
    priority?: Priority,
  ): Promise<Row[] | undefined> {
    try {
      const rows = await this.poller.run(target, name, window, signal, priority);
      this.degraded.resolve(name, target.metastore);
      return rows;
    } catch (error) {
      rethrowIfAborted(error, signal);
      this.degraded.record(name, target.metastore, describeFailure(error));
      return undefined;
    }
  }

  /** The query on every target in parallel, rows concatenated in target order. */
  async everywhere(
    name: QueryName,
    window?: TimeWindow,
    signal?: AbortSignal,
    priority?: Priority,
  ): Promise<Row[]> {
    const parts = await Promise.all(
      this.targets.map((target) => this.optional(target, name, window, signal, priority)),
    );
    return parts.flat();
  }
}
