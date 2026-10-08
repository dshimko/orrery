// SPDX-License-Identifier: Apache-2.0
// Fetches query results across the environment's metastore targets and tracks which optional
// queries degraded, so health can report them without failing the environment.
import { SqlError, type Row, type Target } from './contracts.js';
import type { Priority, QueryPoller } from './poller.js';
import type { QueryName } from './queries.js';
import type { TimeWindow } from './time.js';
import { MAX_VIEWERS, ViewerMap } from './viewers.js';

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

/**
 * Optional queries that failed on the last attempt, per viewer, keyed `name@metastore`. Unity
 * Catalog permissions differ per viewer in on-behalf-of-user mode, so one viewer's missing access
 * must not mark another viewer's health degraded. Viewers are bounded (least recently used).
 */
export class Degradations {
  private readonly byViewer: ViewerMap<Map<string, string>>;

  constructor(maxViewers: number = MAX_VIEWERS) {
    this.byViewer = new ViewerMap(maxViewers);
  }

  record(viewer: string, name: string, metastore: string, reason: string): void {
    this.byViewer.getOrCreate(viewer, () => new Map()).set(`${name}@${metastore}`, reason);
  }

  resolve(viewer: string, name: string, metastore: string): void {
    const notes = this.byViewer.get(viewer);
    if (!notes) return;
    notes.delete(`${name}@${metastore}`);
    if (notes.size === 0) this.byViewer.delete(viewer);
  }

  /** Names of the queries that failed on the last attempt on any target, for this viewer. */
  names(viewer: string): Set<QueryName> {
    const keys = [...(this.byViewer.get(viewer)?.keys() ?? [])];
    return new Set(keys.map((key) => key.slice(0, key.indexOf('@')) as QueryName));
  }

  messages(viewer: string): string[] {
    return [...(this.byViewer.get(viewer)?.entries() ?? [])]
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

  /** The current viewer's key (the first target's token cache key). */
  viewer(): string {
    const [first] = this.targets;
    return first ? this.poller.viewerKey(first) : '';
  }

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
    const viewer = this.poller.viewerKey(target);
    try {
      const rows = await this.poller.run(target, name, window, signal, priority);
      this.degraded.resolve(viewer, name, target.metastore);
      return rows;
    } catch (error) {
      rethrowIfAborted(error, signal);
      this.degraded.record(viewer, name, target.metastore, describeFailure(error));
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
