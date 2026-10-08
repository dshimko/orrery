// SPDX-License-Identifier: Apache-2.0
import type { ResolvedEnvironment } from '../config/load.js';
import type { PlatformEvent } from './events.js';
import type { Snapshot } from './snapshot.js';
import type { Topology } from './topology.js';

/** Source of "now". Tests and replays inject a fixed or scaled clock. */
export interface Clock {
  now(): Date;
  /** Resolves after `ms` of clock time, or rejects when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface AdapterContext {
  clock: Clock;
  logger: Logger;
  /** Process environment, injected so adapters never read `process.env` directly. */
  env: Readonly<Record<string, string | undefined>>;
  /** Aborts long-running work such as live event streams on shutdown. */
  signal?: AbortSignal;
  /** Every configured environment, so an adapter can detect catalogs claimed twice. */
  peers?: readonly ResolvedEnvironment[];
  /**
   * The current viewer's forwarded access token, when the server runs in on-behalf-of-user
   * mode. Adapters call it per query; it returns undefined outside a user request.
   */
  userToken?: () => string | undefined;
}

export interface AdapterHealth {
  status: 'ok' | 'degraded' | 'error';
  message?: string;
  /** ISO timestamp of the last successful read. */
  checkedAt: string;
  /** Catalogs in scope of no environment, reported for the home page health check. */
  unmatchedCatalogs?: string[];
}

/** The single interface every data source implements. Adapters never know about visuals. */
export interface OrreryAdapter {
  readonly id: string;
  init(env: ResolvedEnvironment, ctx: AdapterContext): Promise<void>;
  /** Hub, spokes, sources, use cases, metastores, foreign catalogs. */
  topology(): Promise<Topology>;
  /** Activity, freshness, counts, and open alerts at `at` (default: now). */
  snapshot(at?: Date): Promise<Snapshot>;
  /**
   * Events with `since <= ts < until`, in timestamp order. Without `until` the stream is live:
   * it follows the clock until `ctx.signal` or `signal` aborts. `signal` lets a caller (for
   * example a disconnected client) stop the work promptly.
   */
  events(since: Date, until?: Date, signal?: AbortSignal): AsyncIterable<PlatformEvent>;
  health(): Promise<AdapterHealth>;
  dispose(): Promise<void>;
}

export type AdapterFactory = () => OrreryAdapter;
